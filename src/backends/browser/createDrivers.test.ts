import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import {
  createRuntimeBrowserDrivers,
  resolvePlaywrightDriverConfig,
} from './createDrivers.js';

function createEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    HOME: '/tmp/cats-runtime-browser-drivers',
    USERPROFILE: '/tmp/cats-runtime-browser-drivers',
    CATS_RUNTIME_API_KEY: '',
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_CONFIG_PATH: '__missing__',
    ...overrides,
  };
}

describe('browser driver creation', () => {
  it('returns only the manual driver by default', () => {
    const config = loadConfig(createEnv(), { skipProviderFile: true });
    const drivers = createRuntimeBrowserDrivers(config);
    expect(drivers.map((driver) => driver.descriptor.id)).toEqual(['manual']);
  });

  it('adds the opt-in Playwright driver when enabled by env', () => {
    const config = loadConfig(createEnv({
      CATS_RUNTIME_BROWSER_PLAYWRIGHT_ENABLED: 'true',
      CATS_RUNTIME_BROWSER_PLAYWRIGHT_CHANNEL: 'chrome',
    }), { skipProviderFile: true });
    const drivers = createRuntimeBrowserDrivers(config);
    expect(drivers.map((driver) => driver.descriptor.id)).toEqual(['manual', 'playwright']);
    expect(drivers[1]?.descriptor).toEqual(expect.objectContaining({
      id: 'playwright',
      kind: 'playwright',
      capabilities: expect.objectContaining({
        liveAutomation: true,
      }),
    }));
  });

  it('parses Playwright browser env overrides with sane defaults', () => {
    expect(resolvePlaywrightDriverConfig(createEnv({
      CATS_RUNTIME_BROWSER_PLAYWRIGHT_CHANNEL: 'chrome',
      CATS_RUNTIME_BROWSER_PLAYWRIGHT_HEADLESS: 'false',
      CATS_RUNTIME_BROWSER_PLAYWRIGHT_ARGS: '--start-maximized,--disable-gpu',
      CATS_RUNTIME_BROWSER_PLAYWRIGHT_NAVIGATION_TIMEOUT_MS: '25000',
    }))).toEqual({
      enabled: true,
      channel: 'chrome',
      headless: false,
      launchArgs: ['--start-maximized', '--disable-gpu'],
      navigationTimeoutMs: 25_000,
    });
  });
});
