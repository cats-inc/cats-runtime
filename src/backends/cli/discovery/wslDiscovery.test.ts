import { describe, expect, it, vi } from 'vitest';
import { SessionRegistry } from '../pool/SessionRegistry.js';
import {
  WslDiscoveryStatusStore,
  createDiscoveryStatusPayload,
  isWslDistroRunning,
  runWslAwareNativeDiscovery,
} from './wslDiscovery.js';

describe('WslDiscoveryStatusStore', () => {
  it('reports native runtimes as not applicable', () => {
    const payload = createDiscoveryStatusPayload({
      cursorRuntime: { mode: 'native' },
      kiroRuntime: { mode: 'native' },
      nativeDiscoveryIntervalMs: 5000,
      wslDiscoveryPolicy: 'always',
    });

    expect(payload.wsl.summary).toEqual({
      state: 'not_applicable',
      message: 'Cursor and Kiro are not using WSL runtime',
    });
    expect(payload.wsl.providers.cursor.state).toBe('not_applicable');
    expect(payload.wsl.providers.kiro.state).toBe('not_applicable');
  });

  it('starts WSL-backed providers in disabled state when policy is manual_only', () => {
    const store = new WslDiscoveryStatusStore({
      cursorRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      kiroRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      nativeDiscoveryIntervalMs: 5000,
      wslDiscoveryPolicy: 'manual_only',
    });

    expect(store.snapshot().summary).toEqual({
      state: 'disabled',
      message: 'Background WSL discovery is disabled by policy',
    });
  });
});

describe('runWslAwareNativeDiscovery', () => {
  it('skips WSL scans when policy requires a running distro and none is running', async () => {
    const registry = new SessionRegistry();
    const store = new WslDiscoveryStatusStore({
      cursorRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      kiroRuntime: { mode: 'native' },
      nativeDiscoveryIntervalMs: 5000,
      wslDiscoveryPolicy: 'if_running',
    });

    const result = await runWslAwareNativeDiscovery({
      provider: 'cursor',
      listAllSessions: vi.fn(),
      registry,
      runtime: { mode: 'wsl', distro: 'Ubuntu' },
      policy: 'if_running',
      statusStore: store,
      inspector: vi.fn(async () => false),
    });

    expect(result).toEqual({
      outcome: 'skipped',
      newCount: 0,
      syncedCount: 0,
    });
    expect(store.snapshot().providers.cursor.state).toBe('skipped');
  });

  it('imports sessions and marks WSL discovery as active when scanning succeeds', async () => {
    const registry = new SessionRegistry();
    const store = new WslDiscoveryStatusStore({
      cursorRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      kiroRuntime: { mode: 'native' },
      nativeDiscoveryIntervalMs: 5000,
      wslDiscoveryPolicy: 'always',
    });

    const result = await runWslAwareNativeDiscovery({
      provider: 'cursor',
      listAllSessions: vi.fn(async () => [
        {
          providerSessionId: 'cursor-1',
          cwd: 'C:/repo',
          summary: 'Imported',
          messageCount: 1,
        },
      ]),
      registry,
      runtime: { mode: 'wsl', distro: 'Ubuntu' },
      policy: 'always',
      statusStore: store,
    });

    expect(result).toEqual({
      outcome: 'scanned',
      newCount: 1,
      syncedCount: 1,
    });
    expect(store.snapshot().providers.cursor.state).toBe('active');
    expect(registry.list({ provider: 'cursor' })).toHaveLength(1);
  });
});

describe('isWslDistroRunning', () => {
  it('parses running distros from wsl output', async () => {
    await expect(isWslDistroRunning(
      'Ubuntu',
      vi.fn(async () => ({
        code: 0,
        stdout: 'Ubuntu\nDebian\n',
        stderr: '',
      })),
    )).resolves.toBe(true);
  });
});
