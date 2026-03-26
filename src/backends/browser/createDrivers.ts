import type { RuntimeBrowserDriver } from '../../core/browser/driver.js';
import { getRuntimeConfigEnv, type RuntimeConfig } from '../../core/config.js';
import { ManualBrowserDriver } from './manualDriver.js';
import { PlaywrightBrowserDriver } from './playwrightDriver.js';

const DEFAULT_PLAYWRIGHT_NAVIGATION_TIMEOUT_MS = 15_000;

export function createRuntimeBrowserDrivers(config: RuntimeConfig): RuntimeBrowserDriver[] {
  const env = getRuntimeConfigEnv(config);
  const drivers: RuntimeBrowserDriver[] = [
    new ManualBrowserDriver(),
  ];
  const playwright = resolvePlaywrightDriverConfig(env);
  if (playwright.enabled) {
    drivers.push(new PlaywrightBrowserDriver(playwright));
  }
  return drivers;
}

export interface PlaywrightBrowserDriverConfig {
  enabled: boolean;
  executablePath?: string;
  channel?: string;
  headless: boolean;
  launchArgs: string[];
  navigationTimeoutMs: number;
}

export function resolvePlaywrightDriverConfig(
  env: Readonly<NodeJS.ProcessEnv>,
): PlaywrightBrowserDriverConfig {
  const executablePath = sanitizeString(env.CATS_RUNTIME_BROWSER_PLAYWRIGHT_EXECUTABLE_PATH);
  const channel = sanitizeString(env.CATS_RUNTIME_BROWSER_PLAYWRIGHT_CHANNEL);
  return {
    enabled: parseBoolean(
      env.CATS_RUNTIME_BROWSER_PLAYWRIGHT_ENABLED,
      Boolean(executablePath || channel),
    ),
    ...(executablePath ? { executablePath } : {}),
    ...(channel ? { channel } : {}),
    headless: parseBoolean(env.CATS_RUNTIME_BROWSER_PLAYWRIGHT_HEADLESS, true),
    launchArgs: parseStringList(env.CATS_RUNTIME_BROWSER_PLAYWRIGHT_ARGS),
    navigationTimeoutMs: parsePositiveInteger(
      env.CATS_RUNTIME_BROWSER_PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
      DEFAULT_PLAYWRIGHT_NAVIGATION_TIMEOUT_MS,
    ),
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStringList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function sanitizeString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
