import { pathToFileURL } from 'node:url';
import type {
  RuntimeBrowserDriver,
  RuntimeBrowserDriverCreateSessionInput,
  RuntimeBrowserDriverOpenPageInput,
  RuntimeBrowserDriverCloseSessionInput,
} from '../../core/browser/driver.js';
import { RuntimeBrowserValidationError } from '../../core/browser/errors.js';
import type { RuntimeBrowserDriverDescriptor } from '../../core/types.js';

interface PlaywrightPageLike {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  title(): Promise<string>;
  close?(): Promise<void>;
}

interface PlaywrightBrowserContextLike {
  newPage(): Promise<PlaywrightPageLike>;
  close(): Promise<void>;
}

interface PlaywrightBrowserLike {
  newContext(options?: Record<string, unknown>): Promise<PlaywrightBrowserContextLike>;
  close(): Promise<void>;
}

interface PlaywrightChromiumLike {
  launch(options?: Record<string, unknown>): Promise<PlaywrightBrowserLike>;
}

interface PlaywrightModuleLike {
  chromium: PlaywrightChromiumLike;
}

interface PlaywrightBrowserDriverSession {
  browser: PlaywrightBrowserLike;
  context: PlaywrightBrowserContextLike;
}

export interface PlaywrightBrowserDriverOptions {
  executablePath?: string;
  channel?: string;
  headless?: boolean;
  launchArgs?: string[];
  navigationTimeoutMs?: number;
  moduleLoader?: () => Promise<PlaywrightModuleLike>;
}

const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;

export class PlaywrightBrowserDriver implements RuntimeBrowserDriver {
  readonly descriptor: RuntimeBrowserDriverDescriptor;

  private readonly sessions = new Map<string, PlaywrightBrowserDriverSession>();
  private readonly headless: boolean;
  private readonly launchArgs: string[];
  private readonly navigationTimeoutMs: number;
  private modulePromise: Promise<PlaywrightModuleLike> | null = null;

  constructor(private readonly options: PlaywrightBrowserDriverOptions = {}) {
    this.headless = options.headless ?? true;
    this.launchArgs = [...(options.launchArgs || [])];
    this.navigationTimeoutMs = Math.max(1, options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS);
    this.descriptor = {
      id: 'playwright',
      kind: 'playwright',
      status: 'ready',
      title: 'Playwright Browser Driver',
      summary: 'Launches a runtime-owned Chromium session for preview and automation-ready browser workflows.',
      capabilities: {
        persistentSessions: false,
        manualUrlEntry: true,
        serviceBindings: true,
        artifactBindings: true,
        liveAutomation: true,
      },
      warnings: buildWarnings(options),
      metadata: {
        browserEngine: 'chromium',
        headless: this.headless,
        ...(options.channel ? { channel: options.channel } : {}),
        ...(options.executablePath ? { executablePath: options.executablePath } : {}),
      },
    };
  }

  async createSession(
    input: RuntimeBrowserDriverCreateSessionInput,
  ): Promise<{ driverSessionId?: string; metadata?: Record<string, unknown> }> {
    const module = await this.getPlaywrightModule();
    const launchOptions: Record<string, unknown> = {
      headless: this.headless,
    };
    if (this.options.executablePath) {
      launchOptions.executablePath = this.options.executablePath;
    }
    if (this.options.channel) {
      launchOptions.channel = this.options.channel;
    }
    if (this.launchArgs.length > 0) {
      launchOptions.args = [...this.launchArgs];
    }

    let browser: PlaywrightBrowserLike;
    try {
      browser = await module.chromium.launch(launchOptions);
    } catch (error) {
      throw toPlaywrightValidationError('launch a Chromium browser session', error);
    }

    let context: PlaywrightBrowserContextLike;
    try {
      context = await browser.newContext();
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw toPlaywrightValidationError('create a browser context', error);
    }

    this.sessions.set(input.browserSessionId, {
      browser,
      context,
    });

    return {
      driverSessionId: input.browserSessionId,
      metadata: {
        mode: 'playwright',
        headless: this.headless,
        ...(input.runtimeSessionId ? { runtimeSessionId: input.runtimeSessionId } : {}),
        ...(input.label ? { label: input.label } : {}),
        ...(this.options.channel ? { channel: this.options.channel } : {}),
      },
    };
  }

  async openPage(
    input: RuntimeBrowserDriverOpenPageInput,
  ): Promise<{ driverPageId?: string; title?: string; metadata?: Record<string, unknown> }> {
    const session = this.sessions.get(input.browserSessionId);
    if (!session) {
      throw new RuntimeBrowserValidationError(
        `Playwright browser session '${input.browserSessionId}' is not active.`,
      );
    }

    const pageUrl = resolveNavigationTarget(input);
    let page: PlaywrightPageLike | undefined;
    try {
      page = await session.context.newPage();
      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.navigationTimeoutMs,
      });
      const pageTitle = await page.title().catch(() => input.target.title || undefined);
      return {
        driverPageId: input.browserPageId,
        ...(pageTitle ? { title: pageTitle } : {}),
        metadata: {
          mode: 'playwright',
          navigatedUrl: pageUrl,
          bindingKind: input.target.binding.kind,
        },
      };
    } catch (error) {
      if (page?.close) {
        await page.close().catch(() => undefined);
      }
      throw toPlaywrightValidationError(`open '${pageUrl}'`, error);
    }
  }

  async closeSession(input: RuntimeBrowserDriverCloseSessionInput): Promise<void> {
    const session = this.sessions.get(input.browserSessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(input.browserSessionId);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
  }

  private async getPlaywrightModule(): Promise<PlaywrightModuleLike> {
    if (!this.modulePromise) {
      this.modulePromise = (this.options.moduleLoader || defaultModuleLoader)();
    }
    return this.modulePromise;
  }
}

async function defaultModuleLoader(): Promise<PlaywrightModuleLike> {
  return await import('playwright-core');
}

function resolveNavigationTarget(input: RuntimeBrowserDriverOpenPageInput): string {
  if (input.target.url) {
    return input.target.url;
  }
  if (input.target.path) {
    return pathToFileURL(input.target.path).href;
  }
  throw new RuntimeBrowserValidationError('Playwright browser pages require a url or path.');
}

function toPlaywrightValidationError(action: string, error: unknown): RuntimeBrowserValidationError {
  const message = error instanceof Error ? error.message : 'Unknown Playwright error.';
  return new RuntimeBrowserValidationError(
    `Playwright browser driver could not ${action}: ${message}`,
  );
}

function buildWarnings(options: PlaywrightBrowserDriverOptions): string[] {
  const warnings = [
    'Ready browser sessions from this driver are not restart-safe yet; they are recovered as closed after runtime restarts.',
    'Playwright launch requires a local Chromium-compatible browser to be available. Set executablePath or channel if auto-resolution is insufficient.',
  ];
  if (!options.executablePath && !options.channel) {
    warnings.push(
      'No explicit Playwright browser executable/channel is configured; runtime will rely on the local Playwright/Chromium resolution path.',
    );
  }
  return warnings;
}
