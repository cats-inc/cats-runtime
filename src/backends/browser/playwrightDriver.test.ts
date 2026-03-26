import { describe, expect, it, vi } from 'vitest';
import { PlaywrightBrowserDriver } from './playwrightDriver.js';

describe('PlaywrightBrowserDriver', () => {
  it('launches a browser session, opens URLs and local files, then closes resources', async () => {
    const goto = vi.fn(async () => undefined);
    const title = vi.fn(async () => 'Preview Title');
    const pageClose = vi.fn(async () => undefined);
    const newPage = vi.fn(async () => ({
      goto,
      title,
      close: pageClose,
    }));
    const contextClose = vi.fn(async () => undefined);
    const browserClose = vi.fn(async () => undefined);
    const newContext = vi.fn(async () => ({
      newPage,
      close: contextClose,
    }));
    const launch = vi.fn(async () => ({
      newContext,
      close: browserClose,
    }));

    const driver = new PlaywrightBrowserDriver({
      channel: 'chrome',
      headless: false,
      launchArgs: ['--start-maximized'],
      moduleLoader: async () => ({
        chromium: {
          launch,
        },
      }),
    });

    const session = await driver.createSession({
      browserSessionId: 'browser-session-1',
      runtimeSessionId: 'runtime-session-1',
      label: 'Preview Browser',
    });
    expect(session).toEqual(expect.objectContaining({
      driverSessionId: 'browser-session-1',
      metadata: expect.objectContaining({
        mode: 'playwright',
        channel: 'chrome',
        headless: false,
      }),
    }));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      headless: false,
      channel: 'chrome',
      args: ['--start-maximized'],
    }));

    const openedUrl = await driver.openPage({
      browserSessionId: 'browser-session-1',
      browserPageId: 'browser-page-1',
      target: {
        url: 'http://127.0.0.1:4173',
        binding: {
          kind: 'manual_url',
        },
      },
    });
    expect(openedUrl).toEqual(expect.objectContaining({
      driverPageId: 'browser-page-1',
      title: 'Preview Title',
      metadata: expect.objectContaining({
        mode: 'playwright',
        navigatedUrl: 'http://127.0.0.1:4173',
        bindingKind: 'manual_url',
      }),
    }));
    expect(goto).toHaveBeenCalledWith('http://127.0.0.1:4173', expect.objectContaining({
      waitUntil: 'domcontentloaded',
    }));

    await driver.openPage({
      browserSessionId: 'browser-session-1',
      browserPageId: 'browser-page-2',
      target: {
        path: 'C:/temp/preview.html',
        binding: {
          kind: 'session_artifact',
          runtimeSessionId: 'runtime-session-1',
          artifactId: 'artifact-1',
        },
      },
    });
    expect(goto).toHaveBeenLastCalledWith(
      'file:///C:/temp/preview.html',
      expect.objectContaining({
        waitUntil: 'domcontentloaded',
      }),
    );

    await driver.closePage({
      browserSessionId: 'browser-session-1',
      browserPageId: 'browser-page-1',
    });
    expect(pageClose).toHaveBeenCalledTimes(1);

    await driver.closeSession({
      browserSessionId: 'browser-session-1',
    });
    expect(pageClose).toHaveBeenCalledTimes(2);
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces launch failures as validation errors', async () => {
    const driver = new PlaywrightBrowserDriver({
      moduleLoader: async () => ({
        chromium: {
          launch: vi.fn(async () => {
            throw new Error('missing browser executable');
          }),
        },
      }),
    });

    await expect(driver.createSession({
      browserSessionId: 'browser-session-1',
    })).rejects.toThrow(
      'Playwright browser driver could not launch a Chromium browser session: missing browser executable',
    );
  });
});
