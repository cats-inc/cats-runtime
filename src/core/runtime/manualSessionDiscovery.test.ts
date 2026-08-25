import { describe, expect, it } from 'vitest';
import { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import {
  importAgentSessions,
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

describe('runManualSessionDiscovery with agent targets', () => {
  it('counts only new agent sessions and prunes stale discovered records', () => {
    const registry = new SessionRegistry();
    registry.upsertDiscovered('stale-session', {
      providerName: 'devin',
      providerBackend: 'agent',
      providerInstanceId: 'acp',
      cwd: '/workspace/stale',
    });

    const target = { provider: 'devin', instanceId: 'acp' };
    const sessions = [{ providerSessionId: 'current-session', cwd: '/workspace/current' }];

    expect(importAgentSessions(registry, target, sessions)).toBe(1);
    expect(importAgentSessions(registry, target, sessions)).toBe(0);
    expect(registry.list({ provider: 'devin' }).map((session) => session.providerSessionId))
      .toEqual(['current-session']);
  });

  it('imports agent sessions alongside CLI targets and counts both', async () => {
    const registry = new SessionRegistry(
      undefined,
      undefined,
      createConfig().providerDefaultInstances,
    );

    const result = await runManualSessionDiscovery({
      config: createConfig(),
      registry,
      runner: { listSessions: async () => [] },
      agentRunner: {
        listTargets: () => [{ provider: 'devin', instanceId: 'acp' }],
        listSessions: async () => ({
          supported: true,
          summary: "ACP target 'devin/acp' reported 2 session(s).",
          sessions: [
            {
              providerSessionId: 'sage-origin',
              cwd: '/workspace',
              summary: 'History of Terminal Emulators',
              lastActivity: '2026-08-08T15:56:14+00:00',
            },
            { providerSessionId: 'swanky-fighter' },
          ],
        }),
      },
    });

    expect(result.agentTargets).toEqual([{
      provider: 'devin',
      instanceId: 'acp',
      status: 'scanned',
      discoveredCount: 2,
      importedCount: 2,
      message: "ACP target 'devin/acp' reported 2 session(s).",
    }]);
    expect(result.summary.discoveredCount).toBe(2);
    expect(result.summary.importedCount).toBe(2);
    expect(registry.list({ provider: 'devin' })).toHaveLength(2);
  });

  it('keeps a scan green when an agent cannot enumerate', async () => {
    const registry = new SessionRegistry(
      undefined,
      undefined,
      createConfig().providerDefaultInstances,
    );

    const result = await runManualSessionDiscovery({
      config: createConfig(),
      registry,
      runner: { listSessions: async () => [] },
      agentRunner: {
        listTargets: () => [{ provider: 'openclaw', instanceId: 'gateway' }],
        listSessions: async () => ({
          supported: false,
          summary: "ACP target 'openclaw/gateway' does not advertise session enumeration.",
          sessions: [],
        }),
      },
    });

    // Not a capability every agent has, so it must not read as an error.
    expect(result.agentTargets[0].status).toBe('unsupported');
    expect(result.summary.failedTargets).toBe(0);
    expect(result.summary.status).toBe('completed');
  });

  it('reports an agent that throws without losing the CLI results', async () => {
    const registry = new SessionRegistry(
      undefined,
      undefined,
      createConfig().providerDefaultInstances,
    );

    const result = await runManualSessionDiscovery({
      config: createConfig(),
      registry,
      runner: { listSessions: async () => [] },
      agentRunner: {
        listTargets: () => [{ provider: 'devin', instanceId: 'acp' }],
        listSessions: async () => {
          throw new Error('spawn devin ENOENT');
        },
      },
    });

    expect(result.agentTargets[0]).toMatchObject({
      status: 'failed',
      message: 'spawn devin ENOENT',
    });
    expect(result.summary.failedTargets).toBe(1);
    expect(result.summary.status).toBe('completed_with_errors');
    expect(result.targets.every((target) => target.status === 'scanned')).toBe(true);
  });
});
