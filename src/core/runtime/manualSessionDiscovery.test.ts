import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import {
  listManualSessionDiscoveryTargets,
  runManualSessionDiscovery,
  type ManualSessionDiscoveryTarget,
} from './manualSessionDiscovery.js';

function createConfig() {
  return {
    providerCommands: {} as never,
    providerDefaultTargets: {
      cursor: { backend: 'cli', instance: 'default' },
      goose: { backend: 'cli', instance: 'docker-lab' },
      kiro: { backend: 'cli', instance: 'default' },
      opencode: { backend: 'cli', instance: 'default' },
    },
    providerDefaultInstances: {
      cursor: 'default',
      goose: 'docker-lab',
      kiro: 'default',
      kilo: 'default',
      opencode: 'default',
    },
    providerInstances: {
      cursor: {
        default: {
          id: 'default',
          providerName: 'cursor',
          commandConfig: {
            path: 'cursor-agent',
            runtime: { mode: 'native' },
          },
        },
        ubuntu: {
          id: 'ubuntu',
          providerName: 'cursor',
          commandConfig: {
            path: 'cursor-agent',
            runtime: { mode: 'wsl', distro: 'Ubuntu' },
          },
        },
      },
      goose: {
        'docker-lab': {
          id: 'docker-lab',
          providerName: 'goose',
          commandConfig: {
            path: 'goose',
            runtime: { mode: 'docker', container: 'cats-goose' },
          },
        },
      },
      kiro: {
        default: {
          id: 'default',
          providerName: 'kiro',
          commandConfig: {
            path: 'kiro-cli',
            runtime: { mode: 'wsl', distro: 'Ubuntu' },
          },
        },
      },
      kilo: {},
      opencode: {
        default: {
          id: 'default',
          providerName: 'opencode',
          commandConfig: {
            path: 'opencode',
            runtime: { mode: 'native' },
          },
        },
      },
    },
    auggieSessionsDir: '',
    claudeProjectsDir: '',
    codexSessionsDir: '',
    copilotSessionsDir: '',
    cursorChatsDir: '',
    geminiSessionsDir: '',
    kiroDbPath: '',
    kiloServerHost: '',
    kiloServerPort: 0,
    kiloServerStartupTimeoutMs: 0,
    opencodeServerHost: '',
    opencodeServerPort: 0,
    opencodeServerStartupTimeoutMs: 0,
    piSessionsDir: '',
    remoteProviderCatalog: {},
  } as Parameters<typeof listManualSessionDiscoveryTargets>[0];
}

describe('manualSessionDiscovery', () => {
  it('lists only configured WSL and Docker targets', () => {
    expect(listManualSessionDiscoveryTargets(createConfig())).toEqual([
      {
        provider: 'cursor',
        instanceId: 'ubuntu',
        runtime: { mode: 'wsl', distro: 'Ubuntu' },
      },
      {
        provider: 'goose',
        instanceId: 'docker-lab',
        runtime: { mode: 'docker', container: 'cats-goose' },
      },
      {
        provider: 'kiro',
        instanceId: 'default',
        runtime: { mode: 'wsl', distro: 'Ubuntu' },
      },
    ]);
  });

  it('continues after target failures without pruning failed targets', async () => {
    const registry = new SessionRegistry(
      undefined,
      undefined,
      createConfig().providerDefaultInstances,
    );
    registry.upsertDiscovered('goose-stale', {
      providerName: 'goose',
      providerInstanceId: 'docker-lab',
      cwd: '/repo/stale',
    });

    const result = await runManualSessionDiscovery({
      config: createConfig(),
      registry,
      runner: {
        listSessions: async (target: ManualSessionDiscoveryTarget) => {
          if (target.provider === 'cursor') {
            return [{
              providerSessionId: 'cursor-1',
              cwd: '/repo/cursor',
              messageCount: 4,
            }];
          }
          if (target.provider === 'goose') {
            throw new Error('container unavailable');
          }
          return [];
        },
      },
    });

    expect(result.summary).toEqual({
      status: 'completed_with_errors',
      totalTargets: 3,
      scannedTargets: 2,
      failedTargets: 1,
      discoveredCount: 1,
      importedCount: 1,
      syncedCount: 1,
    });
    expect(
      registry.list({ provider: 'cursor' }).some((session) => session.providerSessionId === 'cursor-1'),
    ).toBe(true);
    expect(
      registry.list({ provider: 'goose' }).some((session) => session.providerSessionId === 'goose-stale'),
    ).toBe(true);
  });

  it('prunes stale discovered sessions for targets that scan successfully', async () => {
    const registry = new SessionRegistry(
      undefined,
      undefined,
      createConfig().providerDefaultInstances,
    );
    registry.upsertDiscovered('cursor-stale', {
      providerName: 'cursor',
      providerInstanceId: 'ubuntu',
      cwd: '/repo/old',
    });

    const result = await runManualSessionDiscovery({
      config: createConfig(),
      registry,
      runner: {
        listSessions: async () => [],
      },
    });

    expect(result.summary.status).toBe('completed');
    expect(registry.list({ provider: 'cursor' })).toHaveLength(0);
  });
});
