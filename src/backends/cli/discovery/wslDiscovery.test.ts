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
      dockerDiscoveryPolicy: 'if_running',
      wslDiscoveryPolicy: 'always',
    });

    expect(payload.wsl.summary).toEqual({
      state: 'not_applicable',
      message: 'Cursor and Kiro are not using WSL runtime',
    });
    expect(payload.wsl.providers.cursor.state).toBe('not_applicable');
    expect(payload.wsl.providers.kiro.state).toBe('not_applicable');
    expect(payload.docker.summary).toEqual({
      state: 'not_applicable',
      message: 'No Docker-backed native discovery targets configured',
    });
  });

  it('reports configured Docker-backed native discovery targets', () => {
    const payload = createDiscoveryStatusPayload({
      cursorRuntime: { mode: 'native' },
      kiroRuntime: { mode: 'native' },
      nativeDiscoveryIntervalMs: 5000,
      dockerDiscoveryPolicy: 'if_running',
      wslDiscoveryPolicy: 'always',
      providerInstances: {
        opencode: {
          'docker-dev': {
            id: 'docker-dev',
            providerName: 'opencode',
            commandConfig: {
              path: 'opencode',
              runner: 'auto',
              runtime: {
                mode: 'docker',
                container: 'cats-cli-test',
              },
            },
          },
        },
      } as never,
    });

    expect(payload.docker.policy).toBe('if_running');
    expect(payload.docker.configuredTargets).toBe(1);
    expect(payload.docker.summary).toEqual({
      state: 'active',
      message: 'Background Docker discovery scans when containers are running',
    });
  });

  it('starts WSL-backed providers in idle state when policy allows background scans', () => {
    const store = new WslDiscoveryStatusStore({
      cursorRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      kiroRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      nativeDiscoveryIntervalMs: 5000,
      wslDiscoveryPolicy: 'always',
    });

    expect(store.snapshot().summary).toEqual({
      state: 'idle',
      message: 'Background WSL discovery is waiting for the first scan',
    });
    expect(store.snapshot().providers.cursor.state).toBe('idle');
    expect(store.snapshot().providers.kiro.state).toBe('idle');
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
  it('returns disabled without scanning when policy is manual_only', async () => {
    const registry = new SessionRegistry();
    const store = new WslDiscoveryStatusStore({
      cursorRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      kiroRuntime: { mode: 'native' },
      nativeDiscoveryIntervalMs: 5000,
      wslDiscoveryPolicy: 'manual_only',
    });
    const listAllSessions = vi.fn();

    const result = await runWslAwareNativeDiscovery({
      provider: 'cursor',
      listAllSessions,
      registry,
      runtime: { mode: 'wsl', distro: 'Ubuntu' },
      policy: 'manual_only',
      statusStore: store,
    });

    expect(result).toEqual({
      outcome: 'disabled',
      newCount: 0,
      syncedCount: 0,
    });
    expect(listAllSessions).not.toHaveBeenCalled();
    expect(store.snapshot().providers.cursor.state).toBe('disabled');
  });

  it('passes through directly for non-WSL runtimes', async () => {
    const registry = new SessionRegistry();
    const store = new WslDiscoveryStatusStore({
      cursorRuntime: { mode: 'native' },
      kiroRuntime: { mode: 'native' },
      nativeDiscoveryIntervalMs: 5000,
      wslDiscoveryPolicy: 'always',
    });

    const result = await runWslAwareNativeDiscovery({
      provider: 'cursor',
      listAllSessions: vi.fn(async () => [
        {
          providerSessionId: 'cursor-native-1',
          cwd: '/tmp/repo',
          summary: 'Native session',
          messageCount: 1,
        },
      ]),
      registry,
      runtime: { mode: 'native' },
      policy: 'always',
      statusStore: store,
    });

    expect(result).toEqual({
      outcome: 'scanned',
      newCount: 1,
      syncedCount: 1,
    });
    expect(registry.list({ provider: 'cursor' })).toHaveLength(1);
  });

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

  it('marks provider state as failed when scanning throws', async () => {
    const registry = new SessionRegistry();
    const store = new WslDiscoveryStatusStore({
      cursorRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      kiroRuntime: { mode: 'native' },
      nativeDiscoveryIntervalMs: 5000,
      wslDiscoveryPolicy: 'always',
    });

    await expect(runWslAwareNativeDiscovery({
      provider: 'cursor',
      listAllSessions: vi.fn(async () => {
        throw new Error('scan exploded');
      }),
      registry,
      runtime: { mode: 'wsl', distro: 'Ubuntu' },
      policy: 'always',
      statusStore: store,
    })).rejects.toThrow('scan exploded');

    expect(store.snapshot().providers.cursor).toEqual(expect.objectContaining({
      state: 'failed',
      message: 'scan exploded',
    }));
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

  it('returns false when the distro is not in the running list', async () => {
    await expect(isWslDistroRunning(
      'Ubuntu',
      vi.fn(async () => ({
        code: 0,
        stdout: 'Debian\nArch\n',
        stderr: '',
      })),
    )).resolves.toBe(false);
  });

  it('throws when the wsl command fails', async () => {
    await expect(isWslDistroRunning(
      'Ubuntu',
      vi.fn(async () => ({
        code: 1,
        stdout: '',
        stderr: 'WSL not available',
      })),
    )).rejects.toThrow('WSL not available');
  });
});
