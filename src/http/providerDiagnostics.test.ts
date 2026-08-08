import { join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { createRuntimeStartupState } from '../startup.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { RuntimeMode } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import { getRuntimeResolvedPaths } from '../core/config.js';
import { ProviderCompatibilityService } from '../core/compatibility/ProviderCompatibilityService.js';
import { CompatibilityEvidenceService } from '../core/compatibility/compatibilityEvidence.js';
import { RuntimeMeteringService } from '../core/usage/RuntimeMeteringService.js';
import {
  ProviderEvolutionProbeService,
  PROVIDER_EVOLUTION_PROBE_PROFILES,
} from '../core/compatibility/providerEvolutionProbe.js';
import { ProviderModelCatalogService } from '../core/models/providerModelCatalog.js';
import type { ProviderInstallCheckRunner } from '../core/provider-install/ProviderInstallCheckRunner.js';

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function writeCompatibilityEvidenceArtifact(
  root: string,
  provider: string,
  artifactId: string,
  overrides: Partial<{
    instanceId: string;
    classification: 'degraded' | 'unsupported_version' | 'unrecognized_protocol' | 'probe_failed';
    summary: string;
    capturedAt: string;
    parserId: string;
    profileId: string;
    runtimeMode: RuntimeMode;
  }> = {},
): string {
  const providerDir = join(root, provider);
  mkdirSync(providerDir, { recursive: true });
  const artifactPath = join(providerDir, `${artifactId}.json`);
  writeFileSync(artifactPath, `${JSON.stringify({
    schemaVersion: 3,
    id: artifactId,
    capturedAt: overrides.capturedAt || '2026-03-27T00:00:00.000Z',
    classification: overrides.classification || 'probe_failed',
    summary: overrides.summary || 'Compatibility probe failed while checking the provider.',
    target: {
      provider,
      instanceId: overrides.instanceId || 'default',
    },
    profile: {
      id: overrides.profileId || `${provider}-cli-best-fit`,
      label: `${provider} best fit`,
      protocolFamily: provider,
      parserId: overrides.parserId || `${provider}-json`,
      confidence: 'fallback',
    },
    fingerprint: {
      provider,
      instanceId: overrides.instanceId || 'default',
      command: provider,
      runner: 'auto',
      runtime: { mode: overrides.runtimeMode || 'native' },
      version: {
        detected: true,
        source: 'command',
      },
      features: [],
      checkedAt: overrides.capturedAt || '2026-03-27T00:00:00.000Z',
    },
    warnings: [],
    setup: {
      status: 'ready',
      summary: 'ready',
      install: null,
      auth: null,
      remediation: [],
    },
    probes: {},
    checks: [],
  }, null, 2)}\n`, 'utf8');
  return artifactPath;
}

describe('provider diagnostics HTTP contract', () => {
  let rootDir: string;
  let sessionBaseDir: string;
  let dataDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;

  function makeConfig(overrides: Partial<CliRuntimeConfig> = {}): CliRuntimeConfig {
    const config = {
      host: '127.0.0.1',
      port: 3110,
      apiKey: '',
      dataDir,
      sessionBaseDir,
      auggieMaxTurns: 10,
      auggiePath: 'auggie',
      claudePath: 'claude',
      codexPath: 'codex',
      copilotPath: 'copilot',
      cursorPath: 'cursor-agent',
      antigravityPath: 'agy',
      goosePath: 'goose',
      juniePath: 'junie',
      kiroPath: 'kiro-cli',
      kiloPath: 'kilo',
      opencodePath: 'opencode',
      piPath: 'pi',
      kiloServerHost: '127.0.0.1',
      kiloServerPort: 4313,
      kiloServerStartupTimeoutMs: 10_000,
      opencodeServerHost: '127.0.0.1',
      opencodeServerPort: 4097,
      opencodeServerStartupTimeoutMs: 10_000,
      auggieSessionsDir: join(rootDir, '.augment', 'sessions'),
      claudeProjectsDir: join(rootDir, '.claude', 'projects'),
      codexSessionsDir: join(rootDir, '.codex', 'sessions'),
      copilotSessionsDir: join(rootDir, '.copilot', 'session-state'),
      cursorChatsDir: join(rootDir, '.cursor', 'chats'),
      cursorRuntime: { mode: 'native' },
      kiroDbPath: join(rootDir, '.kiro', 'data.sqlite3'),
      kiroRuntime: { mode: 'native' },
      piSessionsDir: join(rootDir, '.pi', 'sessions'),
      nativeDiscoveryIntervalMs: 0,
      externalSessionLiveWindowMs: 0,
      maxSessions: 10,
      spawnRetries: 1,
      spawnTimeoutMs: 30_000,
      providerCommands: {
        claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
      },
      providerDefaultInstances: {
        claude: 'default',
      },
      providerInstances: {
        auggie: {},
        claude: {
          default: {
            id: 'default',
            providerName: 'claude',
            commandConfig: {
              path: 'claude',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
        },
        codex: {},
        copilot: {},
        cursor: {},
        antigravity: {},
        goose: {},
        junie: {},
        kiro: {},
        kilo: {},
        opencode: {},
        pi: {},
        grok: {},
        cline: {},
      },
    } as unknown as CliRuntimeConfig;

    return {
      ...config,
      ...overrides,
      providerCommands: {
        ...config.providerCommands,
        ...(overrides.providerCommands as CliRuntimeConfig['providerCommands'] | undefined),
      },
      providerDefaultInstances: {
        ...(config.providerDefaultInstances || {}),
        ...(overrides.providerDefaultInstances as CliRuntimeConfig['providerDefaultInstances'] | undefined),
      },
      providerInstances: {
        ...config.providerInstances,
        ...(overrides.providerInstances as CliRuntimeConfig['providerInstances'] | undefined),
      },
      providerDefaultTargets: {
        ...(config.providerDefaultTargets || {}),
        ...(overrides.providerDefaultTargets as CliRuntimeConfig['providerDefaultTargets'] | undefined),
      },
    };
  }

  function createInstallCheckRunner(): ProviderInstallCheckRunner {
    return {
      lookupCommand: vi.fn(async (command: string) => ({
        available: true,
        resolvedPath: `/runtime/bin/${command}`,
        timedOut: false,
      })),
      checkPath: vi.fn(async () => ({
        exists: false,
        timedOut: false,
      })),
      checkNpmPackage: vi.fn(async () => ({
        exists: false,
        timedOut: false,
      })),
      checkShellRcEntry: vi.fn(async () => ({
        exists: false,
        timedOut: false,
      })),
      getNpmPrefix: vi.fn(async () => ({
        value: undefined,
        timedOut: false,
      })),
    };
  }

  function createTestApp(
    config: CliRuntimeConfig = makeConfig(),
    options: {
      metering?: RuntimeMeteringService;
      installCheckRunner?: ProviderInstallCheckRunner;
    } = {},
  ) {
    const compatibility = new ProviderCompatibilityService(config, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => {
          if (args[0] === '--version') {
            return {
              exitCode: 0,
              stdout: 'claude 1.2.3\n',
              stderr: '',
              timedOut: false,
              durationMs: 3,
            };
          }

          return {
            exitCode: 0,
            stdout: 'Usage: claude --input-format --output-format --include-partial-messages --resume\n',
            stderr: '',
            timedOut: false,
            durationMs: 3,
          };
        }),
      },
      installCheckRunner: options.installCheckRunner || createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:02:00.000Z'),
    });
    const providerModelCatalog = new ProviderModelCatalogService(config, {
      fetch: globalThis.fetch,
      env: process.env,
    });

    return createApp({
      config,
      startup: createRuntimeStartupState(),
      registry,
      pool,
      compatibility,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      kiloNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog,
      metering: options.metering,
    });
  }

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-provider-diagnostics-'));
    sessionBaseDir = join(rootDir, 'sessions');
    dataDir = join(rootDir, 'data');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(rootDir, '.claude', 'projects'), { recursive: true });
    registry = new SessionRegistry();
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => undefined),
      spawn: vi.fn(),
      kill: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
    } as unknown as WorkerPool;
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('redacts CLI launch args in provider config responses', async () => {
    const config = makeConfig({
      providerDefaultInstances: {
        claude: 'native-chrome',
      },
      providerInstances: {
        claude: {
          'native-chrome': {
            id: 'native-chrome',
            providerName: 'claude',
            commandConfig: {
              path: 'claude',
              args: ['--api-key', 'secret-token'],
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
          'native-empty': {
            id: 'native-empty',
            providerName: 'claude',
            commandConfig: {
              path: 'claude',
              args: [],
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
        },
      },
    });
    const app = createTestApp(config);

    const response = await app.request('/providers/config');
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      providers: {
        claude: {
          instances: Array<{
            id: string;
            args?: string[];
            argsRedacted?: boolean;
          }>;
        };
      };
    };
    const instance = payload.providers.claude.instances.find((entry) => (
      entry.id === 'native-chrome'
    ));
    const emptyInstance = payload.providers.claude.instances.find((entry) => (
      entry.id === 'native-empty'
    ));

    expect(JSON.stringify(payload)).not.toContain('secret-token');
    expect(instance).toMatchObject({
      args: ['<redacted>'],
      argsRedacted: true,
    });
    expect(emptyInstance).toMatchObject({
      args: [],
    });
    expect(emptyInstance?.argsRedacted).toBeUndefined();
  });

  it('limits health diagnostics probes to default provider targets', async () => {
    const config = makeConfig({
      providerCommands: {
        claude: { path: 'claude-default', runner: 'auto', runtime: { mode: 'native' } },
      } as CliRuntimeConfig['providerCommands'],
      providerDefaultInstances: {
        claude: 'default',
      },
      providerInstances: {
        auggie: {},
        claude: {
          default: {
            id: 'default',
            providerName: 'claude',
            commandConfig: {
              path: 'claude-default',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
          mirror: {
            id: 'mirror',
            providerName: 'claude',
            commandConfig: {
              path: 'claude-mirror',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
        },
        codex: {},
        copilot: {},
        cursor: {},
        antigravity: {},
        goose: {},
        junie: {},
        kiro: {},
        opencode: {},
        pi: {},
      },
    });
    const runner = {
      run: vi.fn(async (_providerName, commandConfig: { path: string }, args: string[]) => ({
        exitCode: 0,
        stdout: args[0] === '--version'
          ? `${commandConfig.path} 1.2.3\n`
          : 'Usage: claude --input-format --output-format --include-partial-messages\n',
        stderr: '',
        timedOut: false,
        durationMs: 3,
      })),
    };
    const compatibility = new ProviderCompatibilityService(config, {
      runner,
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:02:00.000Z'),
    });
    const providerModelCatalog = new ProviderModelCatalogService(config, {
      fetch: globalThis.fetch,
      env: process.env,
    });
    const app = createApp({
      config,
      startup: createRuntimeStartupState(),
      registry,
      pool,
      compatibility,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      kiloNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog,
    });

    const response = await app.request('/diagnostics/health?force=1');
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      providers: {
        defaults: Array<{
          instance: string;
        }>;
      };
    };

    expect(payload.providers.defaults).toEqual([
      expect.objectContaining({
        instance: 'default',
      }),
    ]);
    expect(runner.run.mock.calls.map(([, commandConfig, args]) => `${commandConfig.path}:${args[0]}`))
      .toEqual([
        'claude-default:--version',
        'claude-default:--help',
      ]);
  });

  it('surfaces runtime ACP coexistence diagnostics on runtime and health snapshots', async () => {
    const app = createTestApp();

    const runtimeResponse = await app.request('/diagnostics/runtime');
    expect(runtimeResponse.status).toBe(200);
    const runtimePayload = await runtimeResponse.json() as {
      runtime: {
        acp: {
          protocolVersion: number;
          clientToRuntime: {
            http: {
              path: string;
              promptCarrier: string;
              supportedMethods: string[];
            };
            stdio: {
              entrypoints: string[];
              defaultMode: string;
              directRuntimeFlag: string;
              inspectProxyFlag: string;
              promptTurns: boolean;
            };
            routingSupport: {
              requestedVia: string;
              supportedModes: string[];
              shareWorkspaceFlag: string;
              requiresRuntimeSessionOrigin: boolean;
              peerModePolicyGate: boolean;
              peerModeAvailable: boolean;
              summary: string;
            };
          };
          runtimeToProvider: {
            transport: string;
            diagnosticsPath: string;
            summary: string;
          };
          runtimeToPeer: {
            transport: string;
            diagnosticsPath: string;
            executionPath: string;
            summary: string;
          };
        };
      };
    };

    expect(runtimePayload.runtime.acp.protocolVersion).toBe(1);
    expect(runtimePayload.runtime.acp.summary).toContain('client-to-runtime');
    expect(runtimePayload.runtime.acp.summary).toContain('A2A');
    expect(runtimePayload.runtime.acp.clientToRuntime).toEqual({
      http: {
        enabled: true,
        path: '/acp',
        promptCarrier: 'application/x-ndjson',
        notifications: ['session/update'],
        supportedMethods: [
          'initialize',
          'ping',
          'session/new',
          'session/list',
          'session/load',
          'session/cancel',
          'session/prompt',
        ],
      },
      stdio: {
        enabled: true,
        entrypoints: ['cats-runtime acp', 'node build/runtime/bin/acp.js'],
        defaultMode: 'proxy',
        directRuntimeFlag: '--serve-runtime',
        inspectProxyFlag: '--inspect-proxy',
        promptTurns: true,
        notifications: ['session/update'],
      },
      routingSupport: {
        requestedVia: '_meta.catsRuntime.routing',
        supportedModes: ['local', 'peer'],
        shareWorkspaceFlag: 'shareWorkspace',
        requiresRuntimeSessionOrigin: true,
        peerModePolicyGate: true,
        peerModeAvailable: false,
        summary: expect.stringContaining('policy-gated'),
      },
    });
    expect(runtimePayload.runtime.acp.runtimeToProvider.transport).toBe('agent/acp');
    expect(runtimePayload.runtime.acp.runtimeToProvider.diagnosticsPath).toBe('/diagnostics/providers');
    expect(runtimePayload.runtime.acp.runtimeToProvider.summary)
      .toContain('Provider-side ACP targets stay under the agent backend family');
    expect(runtimePayload.runtime.acp.runtimeToPeer).toEqual({
      transport: 'a2a',
      diagnosticsPath: '/diagnostics/peers',
      executionPath: '/peer/executions',
      summary: expect.stringContaining('runtime-to-runtime A2A/peer execution layer'),
    });

    const healthResponse = await app.request('/diagnostics/health');
    expect(healthResponse.status).toBe(200);
    const healthPayload = await healthResponse.json() as {
      acp: {
        summary: {
          protocolVersion: number;
          httpPath: string;
          httpPromptCarrier: string;
          stdioDefaultMode: string;
          stdioDirectRuntimeFlag: string;
          stdioInspectProxyFlag: string;
          routingMetaPath: string;
          peerModeAvailable: boolean;
          providerTransport: string;
          peerTransport: string;
          peerDiagnosticsPath: string;
          summary: string;
        };
      };
    };

    expect(healthPayload.acp).toEqual({
      summary: {
        protocolVersion: 1,
        httpPath: '/acp',
        httpPromptCarrier: 'application/x-ndjson',
        stdioDefaultMode: 'proxy',
        stdioDirectRuntimeFlag: '--serve-runtime',
        stdioInspectProxyFlag: '--inspect-proxy',
        routingMetaPath: '_meta.catsRuntime.routing',
        peerModeAvailable: false,
        providerTransport: 'agent/acp',
        peerTransport: 'a2a',
        peerDiagnosticsPath: '/diagnostics/peers',
        summary: expect.stringContaining('runtime-policy-gated'),
      },
    });
  });

  it('surfaces background discovery summaries on runtime and health snapshots', async () => {
    const config = makeConfig({
      nativeDiscoveryIntervalMs: 5_000,
      wslDiscoveryPolicy: 'if_running',
      dockerDiscoveryPolicy: 'manual_only',
      providerDefaultInstances: {
        claude: 'default',
        cursor: 'ubuntu',
        goose: 'docker',
      },
      providerInstances: {
        auggie: {},
        claude: makeConfig().providerInstances?.claude || {},
        codex: {},
        copilot: {},
        cursor: {
          ubuntu: {
            id: 'ubuntu',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Ubuntu' },
            },
          },
        },
        antigravity: {},
        goose: {
          docker: {
            id: 'docker',
            providerName: 'goose',
            commandConfig: {
              path: 'goose',
              runner: 'auto',
              runtime: { mode: 'docker', container: 'goose-dev' },
            },
          },
        },
        junie: {},
        kiro: {},
        kilo: {},
        opencode: {},
        pi: {},
      },
    });
    const app = createTestApp(config);

    const runtimeResponse = await app.request('/diagnostics/runtime');
    expect(runtimeResponse.status).toBe(200);
    const runtimePayload = await runtimeResponse.json() as {
      runtime: {
        discovery: {
          statusPath: string;
          wsl: {
            policy: string;
            summary: {
              state: string;
              message: string;
            };
            providers: Record<string, {
              runtimeMode: string;
              state: string;
              distro?: string;
            }>;
          };
          docker: {
            policy: string;
            summary: {
              state: string;
              message: string;
            };
            configuredTargets: number;
          };
        };
      };
    };

    expect(runtimePayload.runtime.discovery).toMatchObject({
      statusPath: '/discovery/status',
      wsl: {
        backgroundEnabled: true,
        nativeDiscoveryIntervalMs: 5_000,
        policy: 'if_running',
        summary: {
          state: 'idle',
          message: 'Background WSL discovery is waiting for the first scan',
        },
        providers: {
          cursor: {
            provider: 'cursor',
            instanceId: 'ubuntu',
            runtimeMode: 'wsl',
            distro: 'Ubuntu',
            state: 'idle',
            message: 'Waiting to scan when the WSL distro is already running',
          },
        },
      },
      docker: {
        backgroundEnabled: true,
        nativeDiscoveryIntervalMs: 5_000,
        policy: 'manual_only',
        summary: {
          state: 'disabled',
          message: 'Background Docker discovery is disabled by policy',
        },
        configuredTargets: 1,
      },
    });

    const healthResponse = await app.request('/diagnostics/health');
    expect(healthResponse.status).toBe(200);
    const healthPayload = await healthResponse.json() as {
      discovery: {
        summary: {
          statusPath: string;
          wslPolicy: string;
          wslState: string;
          wslConfiguredTargets: number;
          dockerPolicy: string;
          dockerState: string;
          dockerConfiguredTargets: number;
          summary: string;
        };
      };
    };

    expect(healthPayload.discovery).toEqual({
      summary: {
        statusPath: '/discovery/status',
        wslPolicy: 'if_running',
        wslState: 'idle',
        wslConfiguredTargets: 1,
        dockerPolicy: 'manual_only',
        dockerState: 'disabled',
        dockerConfiguredTargets: 1,
        summary: 'Background discovery: WSL idle (1 configured target(s)); Docker disabled (1 configured target(s)).',
      },
    });
  });

  it('skips retained artifact reads on health diagnostics', async () => {
    const evidenceSpy = vi.spyOn(
      CompatibilityEvidenceService.prototype,
      'readLatestArtifact',
    ).mockImplementation(async () => {
      throw new Error('health diagnostics should not read retained compatibility evidence');
    });
    const probeSpy = vi.spyOn(
      ProviderEvolutionProbeService.prototype,
      'readLatestArtifact',
    ).mockImplementation(async () => {
      throw new Error('health diagnostics should not read retained provider-evolution artifacts');
    });

    try {
      const app = createTestApp();
      const response = await app.request('/diagnostics/health?force=1');
      expect(response.status).toBe(200);
      expect(evidenceSpy).not.toHaveBeenCalled();
      expect(probeSpy).not.toHaveBeenCalled();
    } finally {
      evidenceSpy.mockRestore();
      probeSpy.mockRestore();
    }
  });

  it('supports availability-only provider diagnostics payloads without retained artifact reads', async () => {
    const evidenceSpy = vi.spyOn(
      CompatibilityEvidenceService.prototype,
      'readLatestArtifact',
    ).mockImplementation(async () => {
      throw new Error('availability diagnostics should not read retained compatibility evidence');
    });
    const probeSpy = vi.spyOn(
      ProviderEvolutionProbeService.prototype,
      'readLatestArtifact',
    ).mockImplementation(async () => {
      throw new Error('availability diagnostics should not read retained provider-evolution artifacts');
    });

    try {
      const app = createTestApp();
      const response = await app.request(
        '/diagnostics/providers?scope=availability&provider=claude&backend=cli&instance=default',
      );
      expect(response.status).toBe(200);

      const payload = await response.json() as {
        probe: string;
        summary: {
          configuredProviders: number;
          targets: number;
        };
        providers: Array<Record<string, unknown>>;
      };

      expect(payload.probe).toBe('light');
      expect(payload.summary).toEqual(expect.objectContaining({
        configuredProviders: 1,
        targets: 1,
      }));
      expect(payload.providers).toEqual([
        {
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          defaultTarget: true,
          availability: expect.objectContaining({
            status: 'ok',
            probe: 'light',
          }),
        },
      ]);
      expect(payload.providers[0]).not.toHaveProperty('config');
      expect(payload.providers[0]).not.toHaveProperty('checks');
      expect(payload.providers[0]).not.toHaveProperty('setup');
      expect(payload.providers[0]).not.toHaveProperty('compatibility');
      expect(payload.providers[0]).not.toHaveProperty('metering');
      expect(payload.providers[0]).not.toHaveProperty('compatibilityEvidence');
      expect(payload.providers[0]).not.toHaveProperty('providerEvolution');
      expect(payload.providers[0]).not.toHaveProperty('reprobe');
      expect(evidenceSpy).not.toHaveBeenCalled();
      expect(probeSpy).not.toHaveBeenCalled();
    } finally {
      evidenceSpy.mockRestore();
      probeSpy.mockRestore();
    }
  });

  it('uses the lightweight compatibility path on availability-scoped provider diagnostics', async () => {
    const installCheckRunner = createInstallCheckRunner();
    const app = createTestApp(makeConfig(), {
      installCheckRunner,
    });

    const response = await app.request(
      '/diagnostics/providers?scope=availability&provider=claude&backend=cli&instance=default&force=1',
    );
    expect(response.status).toBe(200);
    expect(installCheckRunner.lookupCommand).not.toHaveBeenCalled();
    expect(installCheckRunner.checkPath).not.toHaveBeenCalled();
    expect(installCheckRunner.checkNpmPackage).not.toHaveBeenCalled();
    expect(installCheckRunner.checkShellRcEntry).not.toHaveBeenCalled();
    expect(installCheckRunner.getNpmPrefix).not.toHaveBeenCalled();
  });

  it('reuses cached availability diagnostics snapshots for repeated non-force reads', async () => {
    const assessSpy = vi.spyOn(ProviderCompatibilityService.prototype, 'assessCliTarget');

    try {
      const app = createTestApp();

      const first = await app.request(
        '/diagnostics/providers?scope=availability&provider=claude&backend=cli&instance=default',
      );
      expect(first.status).toBe(200);

      const second = await app.request(
        '/diagnostics/providers?scope=availability&provider=claude&backend=cli&instance=default',
      );
      expect(second.status).toBe(200);

      expect(assessSpy).toHaveBeenCalledTimes(1);
    } finally {
      assessSpy.mockRestore();
    }
  });

  it('bypasses cached availability diagnostics snapshots when force=1 is requested', async () => {
    const assessSpy = vi.spyOn(ProviderCompatibilityService.prototype, 'assessCliTarget');

    try {
      const app = createTestApp();

      const first = await app.request(
        '/diagnostics/providers?scope=availability&provider=claude&backend=cli&instance=default',
      );
      expect(first.status).toBe(200);

      const refreshed = await app.request(
        '/diagnostics/providers?scope=availability&provider=claude&backend=cli&instance=default&force=1',
      );
      expect(refreshed.status).toBe(200);

      expect(assessSpy).toHaveBeenCalledTimes(2);
    } finally {
      assessSpy.mockRestore();
    }
  });

  it('serves stale availability diagnostics snapshots while refreshing in the background', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T00:00:00.000Z'));
    const assessSpy = vi.spyOn(ProviderCompatibilityService.prototype, 'assessCliTarget');

    try {
      const app = createTestApp();
      const path = '/diagnostics/providers?scope=availability&provider=claude&backend=cli&instance=default';

      const first = await app.request(path);
      expect(first.status).toBe(200);
      expect(assessSpy).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date('2026-03-23T00:00:31.000Z'));
      assessSpy.mockRejectedValueOnce(new Error('background refresh failed'));

      const second = await app.request(path);
      expect(second.status).toBe(200);
      const payload = await second.json() as {
        providers: Array<{
          availability: {
            status: string;
            probe: string;
          };
        }>;
      };

      expect(payload.providers).toEqual([
        expect.objectContaining({
          availability: expect.objectContaining({
            status: 'ok',
            probe: 'light',
          }),
        }),
      ]);
      expect(assessSpy).toHaveBeenCalledTimes(2);
    } finally {
      assessSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('uses the lightweight compatibility path on health diagnostics', async () => {
    const installCheckRunner = createInstallCheckRunner();
    const app = createTestApp(makeConfig(), {
      installCheckRunner,
    });

    const response = await app.request('/diagnostics/health?force=1');
    expect(response.status).toBe(200);
    expect(installCheckRunner.lookupCommand).not.toHaveBeenCalled();
    expect(installCheckRunner.checkPath).not.toHaveBeenCalled();
    expect(installCheckRunner.checkNpmPackage).not.toHaveBeenCalled();
    expect(installCheckRunner.checkShellRcEntry).not.toHaveBeenCalled();
    expect(installCheckRunner.getNpmPrefix).not.toHaveBeenCalled();
  });

  it('returns machine-readable reprobe and compatibility cache metadata', async () => {
    const app = createTestApp();

    const diagnosticsResponse = await app.request('/diagnostics/providers?probe=live&force=1');
    expect(diagnosticsResponse.status).toBe(200);
    const diagnostics = await diagnosticsResponse.json() as {
      providers: Array<{
        provider: string;
        availability: {
          probe: string;
          attentionCodes: string[];
        };
        compatibility: {
          attentionCodes: string[];
          probe: {
            mode: string;
            supportsLive: boolean;
            liveValidated: boolean;
          };
          cache: {
            stale: boolean;
            ttlMs: number;
          };
        };
        reprobe: {
          forceSupported: boolean;
          liveSupported: boolean;
        };
      }>;
    };

    expect(diagnostics.providers).toEqual([
      expect.objectContaining({
        provider: 'claude',
        availability: expect.objectContaining({
          probe: 'live',
          attentionCodes: [],
        }),
        compatibility: expect.objectContaining({
          attentionCodes: [],
          probe: {
            mode: 'live',
            supportsLive: true,
            liveValidated: true,
          },
          cache: expect.objectContaining({
            stale: false,
            ttlMs: 300_000,
          }),
        }),
        reprobe: {
          forceSupported: true,
          liveSupported: true,
        },
      }),
    ]);

    const configResponse = await app.request('/providers/config');
    expect(configResponse.status).toBe(200);
    const configBody = await configResponse.json() as {
      providers: {
        claude: {
          instances: Array<{
            compatibility: {
              probe: { mode: string; liveValidated: boolean };
              cache: { stale: boolean };
              attentionCodes: string[];
            } | null;
            eventCapabilities?: {
              normalizedStream?: {
                text?: {
                  mode?: string;
                  stepwise?: boolean;
                };
                toolUse?: string;
                toolResult?: string;
                progress?: string;
              };
              transcript?: {
                contentBlocks?: string;
              };
              presentation?: {
                recommended?: string;
              };
            };
          }>;
        };
      };
    };

    expect(configBody.providers.claude.instances[0]?.compatibility).toEqual(expect.objectContaining({
      probe: expect.objectContaining({
        mode: 'live',
        liveValidated: true,
      }),
      cache: expect.objectContaining({
        stale: false,
      }),
      attentionCodes: [],
    }));
    expect(configBody.providers.claude.instances[0]?.eventCapabilities).toEqual(expect.objectContaining({
      normalizedStream: expect.objectContaining({
        text: expect.objectContaining({
          mode: 'token',
          stepwise: true,
        }),
        toolUse: 'native',
        toolResult: 'native',
        progress: 'derived',
      }),
      transcript: {
        contentBlocks: 'native',
      },
      presentation: {
        recommended: 'content_blocks',
      },
    }));
  });

  it('surfaces the latest provider-evolution probe artifact summary', async () => {
    const config = makeConfig();
    let now = Date.parse('2026-03-27T00:00:00.000Z');
    const probeService = new ProviderEvolutionProbeService({
      rootDir: join(
        getRuntimeResolvedPaths(config).compatibilityEvidenceDir,
        'provider-evolution',
      ),
      now: () => now,
    });

    const request = {
      target: {
        provider: 'claude',
        instance: 'default',
        parserId: 'claude-stream-json',
        probeProfile: 'manual_text',
        transport: 'cli' as const,
        version: '1.2.3',
      },
      profile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text,
    };

    await probeService.run({
      ...request,
      run: async ({ observer }) => {
        observer.recordNormalized({
          rawEventType: 'assistant',
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'result',
          events: { type: 'result' },
        });
        return {
          status: 'completed' as const,
          turnsCompleted: 1,
          emittedEventCount: 2,
        };
      },
    });

    now += 1000;

    const current = await probeService.run({
      ...request,
      run: async ({ observer }) => {
        observer.recordNormalized({
          rawEventType: 'assistant',
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'result',
          events: { type: 'result' },
        });
        observer.recordUnknown({
          rawEventType: 'future.event',
          rawSample: { type: 'future.event' },
        });
        return {
          status: 'completed' as const,
          turnsCompleted: 1,
          emittedEventCount: 3,
        };
      },
    });

    const app = createTestApp(config);
    const response = await app.request(
      '/diagnostics/providers?provider=claude&backend=cli&instance=default',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      providers: [
        expect.objectContaining({
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          providerEvolution: {
            latestArtifact: expect.objectContaining({
              artifactId: current.artifact.id,
              probeProfile: 'manual_text',
              transport: 'cli',
              version: '1.2.3',
              relativePath: expect.stringContaining('claude'),
              capabilitySnapshot: expect.objectContaining({
                incrementalText: expect.objectContaining({
                  observed: true,
                  count: 1,
                }),
                finalResult: expect.objectContaining({
                  observed: true,
                  count: 1,
                }),
              }),
              compare: expect.objectContaining({
                addedEventTypeCount: 1,
                removedEventTypeCount: 0,
                frequencyDropCount: 0,
                schemaChangeCount: 0,
                semanticDriftSuspected: false,
              }),
              review: expect.objectContaining({
                classifications: ['upgrade'],
              }),
            }),
          },
        }),
      ],
    }));

    const configResponse = await app.request('/providers/config');
    expect(configResponse.status).toBe(200);
    await expect(configResponse.json()).resolves.toEqual(expect.objectContaining({
      providers: expect.objectContaining({
        claude: expect.objectContaining({
          instances: expect.arrayContaining([
            expect.objectContaining({
              id: 'default',
              eventCapabilities: expect.objectContaining({
                validation: expect.objectContaining({
                  artifactId: current.artifact.id,
                  transport: 'cli',
                  executionStatus: 'completed',
                  observed: expect.objectContaining({
                    incrementalText: true,
                    finalResult: true,
                  }),
                }),
              }),
            }),
          ]),
        }),
      }),
    }));
  });

  it('surfaces additive provider-target metering snapshots on diagnostics', async () => {
    const metering = new RuntimeMeteringService({
      rateLimitCooldownMs: 5_000,
    });
    const session = {
      id: 'metering-session-1',
      providerName: 'claude',
      providerBackend: 'cli' as const,
      providerInstanceId: 'default',
      cwd: sessionBaseDir,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };

    metering.observeEvent(session as never, {
      type: 'error',
      text: '429 Too Many Requests. Retry after 2s.',
    }, {
      turnStartedAt: Date.now() - 20,
    });

    const app = createTestApp(makeConfig(), { metering });
    const response = await app.request(
      '/diagnostics/providers?provider=claude&backend=cli&instance=default',
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      providers: Array<{
        provider: string;
        backend: string;
        instance: string;
        metering: {
          summary: {
            status: string;
            incidents: number;
            activeGuardrails: number;
            activeCooldowns: number;
          };
          recentIncidents: Array<{
            classification: string;
          }>;
          activeGuardrails: Array<{
            outcome: string;
          }>;
        };
      }>;
    };
    expect(payload.providers).toEqual([
      expect.objectContaining({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        metering: expect.objectContaining({
          summary: expect.objectContaining({
            status: 'degraded',
            incidents: 1,
            activeGuardrails: 1,
            activeCooldowns: 1,
          }),
          recentIncidents: expect.arrayContaining([
            expect.objectContaining({
              classification: 'rate_limited',
            }),
          ]),
          activeGuardrails: expect.arrayContaining([
            expect.objectContaining({
              outcome: 'cooldown',
            }),
          ]),
        }),
      }),
    ]);
  });

  it('surfaces the latest retained compatibility evidence summary on diagnostics and provider config', async () => {
    const config = makeConfig();
    writeCompatibilityEvidenceArtifact(
      getRuntimeResolvedPaths(config).compatibilityEvidenceDir,
      'claude',
      'compat-artifact-1',
      {
        instanceId: 'default',
        classification: 'probe_failed',
        summary: 'Compatibility probe failed while checking the provider.',
        parserId: 'claude-stream-json',
        profileId: 'claude-cli-best-fit',
      },
    );

    const app = createTestApp(config);

    const diagnosticsResponse = await app.request(
      '/diagnostics/providers?provider=claude&backend=cli&instance=default',
    );
    expect(diagnosticsResponse.status).toBe(200);
    await expect(diagnosticsResponse.json()).resolves.toEqual(expect.objectContaining({
      providers: [
        expect.objectContaining({
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          compatibilityEvidence: {
            latestArtifact: expect.objectContaining({
              artifactId: 'compat-artifact-1',
              classification: 'probe_failed',
              summary: 'Compatibility probe failed while checking the provider.',
              parserId: 'claude-stream-json',
              profileId: 'claude-cli-best-fit',
              relativePath: expect.stringContaining('claude/compat-artifact-1.json'),
            }),
          },
        }),
      ],
    }));

    const configResponse = await app.request('/providers/config');
    expect(configResponse.status).toBe(200);
    await expect(configResponse.json()).resolves.toEqual(expect.objectContaining({
      providers: expect.objectContaining({
        claude: expect.objectContaining({
          instances: expect.arrayContaining([
            expect.objectContaining({
              id: 'default',
              compatibilityEvidence: {
                latestArtifact: expect.objectContaining({
                  artifactId: 'compat-artifact-1',
                  classification: 'probe_failed',
                  parserId: 'claude-stream-json',
                  profileId: 'claude-cli-best-fit',
                }),
              },
            }),
          ]),
        }),
      }),
    }));
  });

  it('lists retained compatibility evidence artifacts through diagnostics routes', async () => {
    const config = makeConfig();
    const root = getRuntimeResolvedPaths(config).compatibilityEvidenceDir;
    writeCompatibilityEvidenceArtifact(root, 'claude', 'compat-artifact-1', {
      instanceId: 'default',
      classification: 'probe_failed',
      parserId: 'claude-stream-json',
      profileId: 'claude-cli-best-fit',
      runtimeMode: 'native',
    });
    writeCompatibilityEvidenceArtifact(root, 'claude', 'compat-artifact-2', {
      instanceId: 'default',
      classification: 'degraded',
      parserId: 'claude-stream-json',
      profileId: 'claude-cli-fallback',
      capturedAt: '2026-03-28T00:00:00.000Z',
      runtimeMode: 'docker',
    });

    const app = createTestApp(config);
    const response = await app.request(
      '/diagnostics/providers/evidence?provider=claude&classification=degraded&runtimeMode=docker&limit=5',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: {
        provider: 'claude',
        classifications: ['degraded'],
        runtimeMode: 'docker',
        limit: 5,
      },
      artifacts: [
        expect.objectContaining({
          artifactId: 'compat-artifact-2',
          provider: 'claude',
          instance: 'default',
          classification: 'degraded',
          parserId: 'claude-stream-json',
          profileId: 'claude-cli-fallback',
          runtimeMode: 'docker',
          relativePath: 'claude/compat-artifact-2.json',
        }),
      ],
    });
  });

  it('reads retained compatibility evidence artifacts by id through diagnostics routes', async () => {
    const config = makeConfig();
    const root = getRuntimeResolvedPaths(config).compatibilityEvidenceDir;
    writeCompatibilityEvidenceArtifact(root, 'claude', 'compat-artifact-read', {
      instanceId: 'default',
      classification: 'probe_failed',
      parserId: 'claude-stream-json',
      profileId: 'claude-cli-best-fit',
    });

    const app = createTestApp(config);
    const response = await app.request('/diagnostics/providers/evidence/compat-artifact-read');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      relativePath: 'claude/compat-artifact-read.json',
      artifact: expect.objectContaining({
        id: 'compat-artifact-read',
        classification: 'probe_failed',
        target: {
          provider: 'claude',
          instanceId: 'default',
        },
        profile: expect.objectContaining({
          id: 'claude-cli-best-fit',
          parserId: 'claude-stream-json',
        }),
      }),
    });

    const missing = await app.request('/diagnostics/providers/evidence/missing-artifact');
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: 'compatibility_evidence_not_found',
    });
  });

  it('filters provider diagnostics by provider/backend/instance and echoes the applied query', async () => {
    const app = createTestApp(makeConfig({
      providerInstances: {
        auggie: {},
        claude: {
          default: {
            id: 'default',
            providerName: 'claude',
            commandConfig: {
              path: 'claude',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
          mirror: {
            id: 'mirror',
            providerName: 'claude',
            commandConfig: {
              path: 'claude',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
        },
        codex: {},
        copilot: {},
        cursor: {},
        antigravity: {},
        goose: {},
        junie: {},
        kiro: {},
        opencode: {},
        pi: {},
      },
    }));

    const response = await app.request(
      '/diagnostics/providers?provider=claude&backend=cli&instance=mirror&defaultOnly=false',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      query: {
        hasFilters: true,
        filters: {
          provider: 'claude',
          backend: 'cli',
          instance: 'mirror',
        },
      },
      summary: expect.objectContaining({
        configuredProviders: 1,
        targets: 1,
      }),
      providers: [
        expect.objectContaining({
          provider: 'claude',
          backend: 'cli',
          instance: 'mirror',
          defaultTarget: false,
        }),
      ],
    }));
  });

  it('runs transport-native live probes for Anthropic and Ollama targets', async () => {
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'https://api.anthropic.test/v1/models') {
        const headers = new Headers(init?.headers);
        expect(headers.get('anthropic-version')).toBe('2023-06-01');
        expect(headers.has('x-api-key')).toBe(false);
        return new Response('', { status: 401 });
      }
      if (url === 'http://127.0.0.1:11434/api/tags') {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'http://127.0.0.1:11434/api/ps') {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected live probe URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    try {
      const app = createTestApp(makeConfig({
        providerDefaultTargets: {
          claude: { backend: 'api', instance: 'sonnet' },
          ollama: { backend: 'local', instance: 'local' },
        },
        remoteProviderCatalog: {
          api: {
            claude: {
              sonnet: {
                id: 'sonnet',
                providerName: 'claude',
                backend: 'api',
                transport: 'anthropic',
                baseUrl: 'https://api.anthropic.test/v1',
                apiKeyEnv: 'ANTHROPIC_API_KEY',
                model: 'claude-sonnet-4-5',
              },
            },
          },
          local: {
            ollama: {
              local: {
                id: 'local',
                providerName: 'ollama',
                backend: 'local',
                transport: 'ollama',
                baseUrl: 'http://127.0.0.1:11434',
                model: 'qwen2.5-coder:7b',
              },
            },
          },
          agent: {},
        },
      }));

      const apiResponse = await app.request(
        '/diagnostics/providers?probe=live&provider=claude&backend=api&instance=sonnet',
      );
      expect(apiResponse.status).toBe(200);
      await expect(apiResponse.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'claude',
            backend: 'api',
            instance: 'sonnet',
            availability: expect.objectContaining({
              probe: 'live',
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'api_key_present',
                status: 'unavailable',
              }),
              expect.objectContaining({
                code: 'live_probe_unauthenticated',
                status: 'degraded',
                details: expect.objectContaining({
                  url: 'https://api.anthropic.test/v1/models',
                  target: 'models',
                  headerNames: ['anthropic-version'],
                  authentication: expect.objectContaining({
                    mode: 'x-api-key',
                    required: true,
                    applied: false,
                  }),
                }),
              }),
              expect.objectContaining({
                code: 'endpoint_reachable',
                status: 'ok',
                details: expect.objectContaining({
                  url: 'https://api.anthropic.test/v1/models',
                  target: 'models',
                  authenticated: false,
                  headerNames: ['anthropic-version'],
                  statusCode: 401,
                }),
              }),
              expect.objectContaining({
                code: 'endpoint_auth_required',
                status: 'unavailable',
                details: expect.objectContaining({
                  url: 'https://api.anthropic.test/v1/models',
                  target: 'models',
                  authenticated: false,
                  headerNames: ['anthropic-version'],
                  statusCode: 401,
                }),
              }),
            ]),
            config: expect.objectContaining({
              apiRuntime: expect.objectContaining({
                family: 'api_runtime',
                transport: 'anthropic',
                continuation: expect.objectContaining({
                  strategy: 'runtime_transcript',
                }),
                caching: expect.objectContaining({
                  strategy: 'prompt_cache',
                  active: true,
                }),
              }),
              continuity: expect.objectContaining({
                source: 'runtime_stateful',
                providerManagedSessions: false,
                providerSessionState: true,
              }),
              tooling: expect.objectContaining({
                source: 'runtime_local',
                discoverable: true,
                sessionScopedOverrides: true,
                observability: {
                  catalog: 'runtime_enumerated',
                  toolCallEvents: true,
                  runtimeServices: false,
                },
                summary: expect.stringContaining(`'standard' profile`),
                policy: expect.objectContaining({
                  profile: 'standard',
                  counts: expect.objectContaining({
                    total: expect.any(Number),
                    fullAccess: expect.any(Number),
                  }),
                }),
              }),
              liveProbe: expect.objectContaining({
                url: 'https://api.anthropic.test/v1/models',
                target: 'models',
                headerNames: ['anthropic-version'],
                authentication: expect.objectContaining({
                  mode: 'x-api-key',
                  required: true,
                  applied: false,
                }),
                reachable: true,
                statusCode: 401,
                classification: 'auth_required',
              }),
              modelCatalog: expect.objectContaining({
                source: 'config',
                defaultModel: 'claude-sonnet-4-5',
                defaultModelStatus: 'configured',
                modelCount: 1,
                warnings: [
                  "Dynamic model discovery skipped for claude/api/sonnet: required x-api-key credentials are not configured via 'ANTHROPIC_API_KEY'.",
                ],
              }),
            }),
            reprobe: expect.objectContaining({
              liveSupported: true,
            }),
          }),
        ],
      }));

      const localResponse = await app.request(
        '/diagnostics/providers?probe=live&provider=ollama&backend=local&instance=local',
      );
      expect(localResponse.status).toBe(200);
      await expect(localResponse.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'ollama',
            backend: 'local',
            instance: 'local',
            availability: expect.objectContaining({
              status: 'degraded',
              attentionCodes: expect.arrayContaining([
                'model_catalog_warning',
                'configured_model_fallback_only',
              ]),
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'endpoint_reachable',
                status: 'ok',
                details: expect.objectContaining({
                  url: 'http://127.0.0.1:11434/api/tags',
                  target: 'model_tags',
                  authenticated: false,
                  headerNames: [],
                  statusCode: 200,
                }),
              }),
              expect.objectContaining({
                code: 'model_catalog_loaded',
                status: 'ok',
                details: expect.objectContaining({
                  source: 'dynamic',
                  modelCount: 1,
                  defaultModel: 'qwen2.5-coder:7b',
                }),
              }),
              expect.objectContaining({
                code: 'model_catalog_warning',
                status: 'degraded',
              }),
              expect.objectContaining({
                code: 'configured_model_fallback_only',
                status: 'degraded',
                details: expect.objectContaining({
                  model: 'qwen2.5-coder:7b',
                  source: 'dynamic',
                }),
              }),
            ]),
            config: expect.objectContaining({
              apiRuntime: expect.objectContaining({
                family: 'api_runtime',
                transport: 'ollama',
                continuation: expect.objectContaining({
                  strategy: 'runtime_transcript',
                }),
                caching: expect.objectContaining({
                  strategy: 'keep_alive',
                  active: false,
                }),
                localModelLifecycle: expect.objectContaining({
                  source: 'runtime_model_catalog',
                  installedModels: 'dynamic',
                  runningModels: 'dynamic',
                  management: 'deferred',
                }),
              }),
              continuity: expect.objectContaining({
                source: 'runtime_stateful',
                providerManagedSessions: false,
                providerSessionState: true,
              }),
              liveProbe: expect.objectContaining({
                url: 'http://127.0.0.1:11434/api/tags',
                target: 'model_tags',
                headerNames: [],
                authentication: expect.objectContaining({
                  mode: 'none',
                  required: false,
                  applied: false,
                }),
                reachable: true,
                statusCode: 200,
                classification: 'http_ok',
              }),
              modelCatalog: expect.objectContaining({
                source: 'dynamic',
                defaultModel: 'qwen2.5-coder:7b',
                defaultModelStatus: 'configured',
                modelCount: 1,
                statusCounts: {
                  configured: 1,
                  available: 0,
                  running: 0,
                  unknown: 0,
                },
                warnings: expect.arrayContaining([
                  expect.stringContaining("Configured default model 'qwen2.5-coder:7b'"),
                ]),
              }),
            }),
            reprobe: expect.objectContaining({
              liveSupported: true,
            }),
          }),
        ],
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses a bounded light probe for loopback Ollama local targets', async () => {
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
    ) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'http://127.0.0.1:11434/api/tags') {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected light probe URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    try {
      const app = createTestApp(makeConfig({
        providerDefaultTargets: {
          ollama: { backend: 'local', instance: 'local' },
        },
        remoteProviderCatalog: {
          api: {},
          local: {
            ollama: {
              local: {
                id: 'local',
                providerName: 'ollama',
                backend: 'local',
                transport: 'ollama',
                baseUrl: 'http://127.0.0.1:11434',
                model: 'qwen2.5-coder:7b',
              },
            },
          },
          agent: {},
        },
      }));

      const response = await app.request(
        '/diagnostics/providers?provider=ollama&backend=local&instance=local',
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        probe: 'light',
        summary: expect.objectContaining({
          status: 'ok',
          ok: 1,
          degraded: 0,
          unavailable: 0,
        }),
        providers: [
          expect.objectContaining({
            provider: 'ollama',
            backend: 'local',
            instance: 'local',
            availability: expect.objectContaining({
              status: 'ok',
              probe: 'light',
              summary: 'Light probe reached ollama/local endpoint',
              attentionCodes: [],
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'endpoint_reachable',
                status: 'ok',
                message: 'Light probe reached ollama/local endpoint',
                details: expect.objectContaining({
                  url: 'http://127.0.0.1:11434/api/tags',
                  target: 'model_tags',
                  authenticated: false,
                  headerNames: [],
                  statusCode: 200,
                }),
              }),
            ]),
          }),
        ],
      }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps non-loopback Ollama light diagnostics config-only', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('non-loopback light diagnostics should not fetch remote endpoints');
    });

    vi.stubGlobal('fetch', fetchMock);
    try {
      const app = createTestApp(makeConfig({
        providerDefaultTargets: {
          ollama: { backend: 'local', instance: 'remote' },
        },
        remoteProviderCatalog: {
          api: {},
          local: {
            ollama: {
              remote: {
                id: 'remote',
                providerName: 'ollama',
                backend: 'local',
                transport: 'ollama',
                baseUrl: 'http://192.168.1.50:11434',
                model: 'qwen2.5-coder:7b',
              },
            },
          },
          agent: {},
        },
      }));

      const response = await app.request(
        '/diagnostics/providers?provider=ollama&backend=local&instance=remote',
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        probe: 'light',
        summary: expect.objectContaining({
          status: 'degraded',
          ok: 0,
          degraded: 1,
          unavailable: 0,
        }),
        providers: [
          expect.objectContaining({
            provider: 'ollama',
            backend: 'local',
            instance: 'remote',
            availability: expect.objectContaining({
              status: 'degraded',
              probe: 'light',
              attentionCodes: ['live_probe_unimplemented'],
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'live_probe_unimplemented',
                status: 'degraded',
                message: "Transport 'ollama' is configured, but this contract only exposes light diagnostics for local targets",
              }),
            ]),
          }),
        ],
      }));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('classifies OpenAI live probes with transport-native auth headers', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-secret');
    vi.stubEnv('OPENAI_ORG_ID', 'test-openai-org');
    vi.stubEnv('OPENAI_PROJECT_ID', 'test-openai-project');
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'https://api.openai.test/v1/models') {
        const headers = new Headers(init?.headers);
        expect(headers.get('authorization')).toBe('Bearer test-openai-secret');
        expect(headers.get('OpenAI-Organization')).toBe('test-openai-org');
        expect(headers.get('OpenAI-Project')).toBe('test-openai-project');
        return new Response('', { status: 429 });
      }
      throw new Error(`Unexpected live probe URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    try {
      const app = createTestApp(makeConfig({
        providerDefaultTargets: {
          codex: { backend: 'api', instance: 'default' },
        },
        remoteProviderCatalog: {
          api: {
            codex: {
              default: {
                id: 'default',
                providerName: 'codex',
                backend: 'api',
                transport: 'openai',
                baseUrl: 'https://api.openai.test/v1',
                apiKeyEnv: 'OPENAI_API_KEY',
                organizationEnv: 'OPENAI_ORG_ID',
                projectEnv: 'OPENAI_PROJECT_ID',
                model: 'gpt-5.4',
              },
            },
          },
          local: {},
          agent: {},
        },
      }));

      const response = await app.request(
        '/diagnostics/providers?probe=live&provider=codex&backend=api&instance=default',
      );
      expect(response.status).toBe(200);
      const responseText = await response.text();
      expect(responseText).not.toContain('test-openai-secret');
      expect(responseText).not.toContain('test-openai-org');
      expect(responseText).not.toContain('test-openai-project');
      expect(JSON.parse(responseText)).toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'codex',
            backend: 'api',
            instance: 'default',
            availability: expect.objectContaining({
              status: 'degraded',
              attentionCodes: expect.arrayContaining([
                'endpoint_rate_limited',
              ]),
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'api_key_present',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'live_probe_authenticated',
                status: 'ok',
                details: expect.objectContaining({
                  url: 'https://api.openai.test/v1/models',
                  target: 'models',
                  headerNames: ['OpenAI-Organization', 'OpenAI-Project', 'authorization'],
                  authentication: expect.objectContaining({
                    mode: 'bearer',
                    required: true,
                    applied: true,
                  }),
                }),
              }),
              expect.objectContaining({
                code: 'endpoint_reachable',
                status: 'ok',
                details: expect.objectContaining({
                  url: 'https://api.openai.test/v1/models',
                  target: 'models',
                  authenticated: true,
                  headerNames: ['OpenAI-Organization', 'OpenAI-Project', 'authorization'],
                  statusCode: 429,
                }),
              }),
              expect.objectContaining({
                code: 'endpoint_rate_limited',
                status: 'degraded',
                details: expect.objectContaining({
                  url: 'https://api.openai.test/v1/models',
                  target: 'models',
                  authenticated: true,
                  headerNames: ['OpenAI-Organization', 'OpenAI-Project', 'authorization'],
                  statusCode: 429,
                }),
              }),
            ]),
            config: expect.objectContaining({
              continuity: expect.objectContaining({
                source: 'runtime_stateful',
                providerManagedSessions: false,
                providerSessionState: true,
              }),
              credentials: expect.objectContaining({
                apiKeyEnv: expect.objectContaining({
                  name: 'OPENAI_API_KEY',
                  present: true,
                }),
                organizationEnv: expect.objectContaining({
                  name: 'OPENAI_ORG_ID',
                  present: true,
                }),
                projectEnv: expect.objectContaining({
                  name: 'OPENAI_PROJECT_ID',
                  present: true,
                }),
              }),
              liveProbe: expect.objectContaining({
                url: 'https://api.openai.test/v1/models',
                target: 'models',
                headerNames: ['OpenAI-Organization', 'OpenAI-Project', 'authorization'],
                authentication: expect.objectContaining({
                  mode: 'bearer',
                  required: true,
                  applied: true,
                }),
                reachable: true,
                statusCode: 429,
                classification: 'rate_limited',
              }),
            }),
          }),
        ],
      }));
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('times out remote live probes and degrades model discovery into warnings', async () => {
    vi.useFakeTimers();
    vi.stubEnv('OPENAI_API_KEY', 'test-openai-secret');
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }
      signal?.addEventListener('abort', () => reject(createAbortError()), { once: true });
    }));

    vi.stubGlobal('fetch', fetchMock);
    try {
      const app = createTestApp(makeConfig({
        providerDefaultTargets: {
          codex: { backend: 'api', instance: 'default' },
        },
        remoteProviderCatalog: {
          api: {
            codex: {
              default: {
                id: 'default',
                providerName: 'codex',
                backend: 'api',
                transport: 'openai',
                baseUrl: 'https://api.openai.test/v1',
                apiKeyEnv: 'OPENAI_API_KEY',
                model: 'gpt-5.4',
              },
            },
          },
          local: {},
          agent: {},
        },
      }));

      const responsePromise = app.request(
        '/diagnostics/providers?probe=live&provider=codex&backend=api&instance=default',
      );
      await vi.advanceTimersByTimeAsync(10_100);
      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'codex',
            backend: 'api',
            instance: 'default',
            availability: expect.objectContaining({
              status: 'unavailable',
              attentionCodes: expect.arrayContaining([
                'endpoint_probe_failed',
                'model_catalog_warning',
              ]),
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'api_key_present',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'live_probe_authenticated',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'endpoint_probe_failed',
                status: 'unavailable',
                message: "Timed out while probing 'https://api.openai.test/v1/models'.",
                details: expect.objectContaining({
                  url: 'https://api.openai.test/v1/models',
                  target: 'models',
                  authenticated: true,
                  headerNames: ['authorization'],
                  timedOut: true,
                }),
              }),
              expect.objectContaining({
                code: 'model_catalog_warning',
                status: 'degraded',
                details: expect.objectContaining({
                  warnings: expect.arrayContaining([
                    "Dynamic model discovery failed for codex/api/default: Timed out while listing models from 'https://api.openai.test/v1/models'",
                  ]),
                }),
              }),
            ]),
            config: expect.objectContaining({
              continuity: expect.objectContaining({
                source: 'runtime_stateful',
                providerManagedSessions: false,
                providerSessionState: true,
              }),
              liveProbe: expect.objectContaining({
                url: 'https://api.openai.test/v1/models',
                target: 'models',
                headerNames: ['authorization'],
                reachable: false,
                classification: 'timeout',
                timedOut: true,
              }),
              modelCatalog: expect.objectContaining({
                source: 'config',
                defaultModel: 'gpt-5.4',
                defaultModelStatus: 'configured',
                modelCount: 1,
                warnings: expect.arrayContaining([
                  "Dynamic model discovery failed for codex/api/default: Timed out while listing models from 'https://api.openai.test/v1/models'",
                ]),
              }),
            }),
          }),
        ],
      }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('uses transport-native Gemini model probes without leaking api keys', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-gemini-secret');
    vi.stubEnv('GEMINI_BASE_URL', 'https://generativelanguage.test');
    const fetchMock = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'https://generativelanguage.test/v1beta/models') {
        const headers = new Headers(init?.headers);
        expect(headers.get('x-goog-api-key')).toBe('test-gemini-secret');
        return new Response(JSON.stringify({
          models: [
            {
              name: 'models/gemini-2.5-pro',
              displayName: 'Gemini 2.5 Pro',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected live probe URL: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    try {
      const app = createTestApp(makeConfig({
        providerDefaultTargets: {
          gemini: { backend: 'api', instance: 'default' },
        },
        remoteProviderCatalog: {
          api: {
            gemini: {
              default: {
                id: 'default',
                providerName: 'gemini',
                backend: 'api',
                transport: 'gemini',
                baseUrlEnv: 'GEMINI_BASE_URL',
                apiKeyEnv: 'GEMINI_API_KEY',
                model: 'gemini-2.5-pro',
              },
            },
          },
          local: {},
          agent: {},
        },
      }));

      const response = await app.request(
        '/diagnostics/providers?probe=live&provider=gemini&backend=api&instance=default',
      );
      expect(response.status).toBe(200);
      const responseText = await response.text();
      expect(responseText).not.toContain('test-gemini-secret');
      const payload = JSON.parse(responseText) as {
        providers: Array<Record<string, unknown>>;
      };
      expect(payload).toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'gemini',
            backend: 'api',
            instance: 'default',
            availability: expect.objectContaining({
              status: 'ok',
              probe: 'live',
            }),
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'api_key_present',
                status: 'ok',
              }),
              expect.objectContaining({
                code: 'live_probe_authenticated',
                status: 'ok',
                details: expect.objectContaining({
                  url: 'https://generativelanguage.test/v1beta/models',
                  target: 'models',
                  headerNames: ['x-goog-api-key'],
                }),
              }),
              expect.objectContaining({
                code: 'endpoint_reachable',
                status: 'ok',
                details: expect.objectContaining({
                  url: 'https://generativelanguage.test/v1beta/models',
                  target: 'models',
                  authenticated: true,
                  headerNames: ['x-goog-api-key'],
                  statusCode: 200,
                }),
              }),
            ]),
            config: expect.objectContaining({
              endpoint: 'https://generativelanguage.test',
              credentials: expect.objectContaining({
                baseUrlEnv: expect.objectContaining({
                  name: 'GEMINI_BASE_URL',
                  present: true,
                }),
              }),
              liveProbe: expect.objectContaining({
                url: 'https://generativelanguage.test/v1beta/models',
                target: 'models',
                headerNames: ['x-goog-api-key'],
                authentication: expect.objectContaining({
                  mode: 'x-goog-api-key',
                  required: true,
                  applied: true,
                }),
                reachable: true,
                statusCode: 200,
                classification: 'http_ok',
              }),
              modelCatalog: expect.objectContaining({
                source: 'dynamic',
                defaultModel: 'gemini-2.5-pro',
                defaultModelStatus: 'available',
                modelCount: 1,
                warnings: [],
              }),
            }),
          }),
        ],
      }));
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('surfaces configured provider-native tool posture on diagnostics routes', async () => {
    const app = createTestApp(makeConfig({
      providerDefaultTargets: {
        claude: { backend: 'api', instance: 'sonnet' },
        codex: { backend: 'api', instance: 'default' },
      },
      remoteProviderCatalog: {
        api: {
          claude: {
            sonnet: {
              id: 'sonnet',
              providerName: 'claude',
              backend: 'api',
              transport: 'anthropic',
              apiKeyEnv: 'ANTHROPIC_API_KEY',
              model: 'claude-sonnet-4-6',
              payloadTemplate: {
                tools: [
                  { type: 'web_search_20250305', name: 'server-web-search' },
                ],
              },
            },
          },
          codex: {
            default: {
              id: 'default',
              providerName: 'codex',
              backend: 'api',
              transport: 'openai',
              apiKeyEnv: 'OPENAI_API_KEY',
              model: 'gpt-5',
              payloadTemplate: {
                tools: [
                  { type: 'web_search_preview' },
                ],
              },
            },
          },
        },
        local: {},
        agent: {},
      },
    }));

    const response = await app.request('/diagnostics/providers?backend=api');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      providers: expect.arrayContaining([
        expect.objectContaining({
          provider: 'claude',
          backend: 'api',
          instance: 'sonnet',
          config: expect.objectContaining({
            apiRuntime: expect.objectContaining({
              providerNativeTools: expect.objectContaining({
                state: 'provider_native_configured',
                configuredTools: ['web_search_20250305'],
              }),
            }),
          }),
        }),
        expect.objectContaining({
          provider: 'codex',
          backend: 'api',
          instance: 'default',
          config: expect.objectContaining({
            apiRuntime: expect.objectContaining({
              providerNativeTools: expect.objectContaining({
                state: 'provider_native_configured',
                configuredTools: ['web_search_preview'],
              }),
            }),
          }),
        }),
      ]),
    }));
  });

  it('surfaces structured ACP profile metadata on agent diagnostics', async () => {
    const app = createTestApp(makeConfig({
      providerDefaultTargets: {
        codex: { backend: 'agent', instance: 'default' },
      },
      remoteProviderCatalog: {
        api: {},
        local: {},
        agent: {
          codex: {
            default: {
              id: 'default',
              providerName: 'codex',
              backend: 'agent',
              transport: 'acp_stdio',
              command: 'codex-acp',
              args: ['serve'],
              cwd: '/tmp/acp',
              startupTimeoutMs: 15000,
              model: 'gpt-5.4',
            },
          },
        },
      },
    }));

    const response = await app.request(
      '/diagnostics/providers?provider=codex&backend=agent&instance=default',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      providers: [
        expect.objectContaining({
          provider: 'codex',
          backend: 'agent',
          instance: 'default',
          checks: expect.arrayContaining([
            expect.objectContaining({
              code: 'agent_runtime_contract',
              status: 'ok',
              details: expect.objectContaining({
                adapter: 'acp',
                family: 'protocol',
                profile: {
                  id: 'codex-acp',
                  label: 'Codex ACP',
                  family: 'codex',
                  tier: 1,
                },
                transport: expect.objectContaining({
                  kind: 'stdio',
                  protocol: 'acp_v1',
                }),
              }),
            }),
          ]),
          config: expect.objectContaining({
            agentRuntime: expect.objectContaining({
              adapter: 'acp',
              profile: {
                id: 'codex-acp',
                label: 'Codex ACP',
                family: 'codex',
                tier: 1,
              },
            }),
          }),
        }),
      ],
    }));
  });

  it('surfaces ACP stdio launch-env auth semantics on agent diagnostics', async () => {
    vi.stubEnv('CODEX_ACP_TOKEN', 'test-codex-acp-token');
    vi.stubEnv('CODEX_ACP_API_KEY', 'test-codex-acp-api-key');
    vi.stubEnv('CODEX_ACP_PASSWORD', 'test-codex-acp-password');

    try {
      const app = createTestApp(makeConfig({
        providerDefaultTargets: {
          codex: { backend: 'agent', instance: 'default' },
        },
        remoteProviderCatalog: {
          api: {},
          local: {},
          agent: {
            codex: {
              default: {
                id: 'default',
                providerName: 'codex',
                backend: 'agent',
                transport: 'acp_stdio',
                command: 'codex-acp',
                args: ['serve'],
                cwd: '/tmp/acp',
                startupTimeoutMs: 15000,
                authTokenEnv: 'CODEX_ACP_TOKEN',
                apiKeyEnv: 'CODEX_ACP_API_KEY',
                passwordEnv: 'CODEX_ACP_PASSWORD',
                model: 'gpt-5.4',
              },
            },
          },
        },
      }));

      const response = await app.request(
        '/diagnostics/providers?provider=codex&backend=agent&instance=default',
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expect.objectContaining({
        providers: [
          expect.objectContaining({
            provider: 'codex',
            backend: 'agent',
            instance: 'default',
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'agent_runtime_contract',
                status: 'ok',
                details: expect.objectContaining({
                  auth: {
                    mechanisms: ['launch_env'],
                    credentials: [
                      { kind: 'auth_token', configured: true },
                      { kind: 'api_key', configured: true },
                      { kind: 'password', configured: true },
                    ],
                  },
                }),
              }),
            ]),
            config: expect.objectContaining({
              agentRuntime: expect.objectContaining({
                auth: {
                  mechanisms: ['launch_env'],
                  credentials: [
                    { kind: 'auth_token', configured: true },
                    { kind: 'api_key', configured: true },
                    { kind: 'password', configured: true },
                  ],
                },
              }),
            }),
          }),
        ],
      }));

      const configResponse = await app.request('/providers/config');
      expect(configResponse.status).toBe(200);
      await expect(configResponse.json()).resolves.toEqual(expect.objectContaining({
        providers: expect.objectContaining({
          codex: expect.objectContaining({
            instances: expect.arrayContaining([
              expect.objectContaining({
                id: 'default',
                agentRuntime: expect.objectContaining({
                  auth: {
                    mechanisms: ['launch_env'],
                    credentials: [
                      { kind: 'auth_token', configured: true },
                      { kind: 'api_key', configured: true },
                      { kind: 'password', configured: true },
                    ],
                  },
                }),
              }),
            ]),
          }),
        }),
      }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('surfaces dynamic Pi model catalog details during live CLI diagnostics', async () => {
    const config = makeConfig({
      providerCommands: {
        claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
        pi: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } },
      } as CliRuntimeConfig['providerCommands'],
      providerDefaultInstances: {
        claude: 'default',
        pi: 'default',
      },
      providerInstances: {
        auggie: {},
        claude: {
          default: {
            id: 'default',
            providerName: 'claude',
            commandConfig: {
              path: 'claude',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
          },
        },
        codex: {},
        copilot: {},
        cursor: {},
        antigravity: {},
        goose: {},
        junie: {},
        kiro: {},
        opencode: {},
        pi: {
          default: {
            id: 'default',
            providerName: 'pi',
            commandConfig: {
              path: 'pi',
              runner: 'auto',
              runtime: { mode: 'native' },
            },
            piSessionsDir: join(rootDir, '.pi', 'sessions'),
          },
        },
      },
      providerDefaultTargets: {
        pi: { backend: 'cli', instance: 'default' },
      },
    });
    const compatibility = new ProviderCompatibilityService(config, {
      runner: {
        run: vi.fn(async (_providerName, _commandConfig, args: string[]) => ({
          exitCode: 0,
          stdout: args[0] === '--version'
            ? 'pi 0.9.0\n'
            : 'Usage: pi --mode --session --provider --model --append-system-prompt\n',
          stderr: '',
          timedOut: false,
          durationMs: 3,
        })),
      },
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:02:00.000Z'),
    });
    const providerModelCatalog = new ProviderModelCatalogService(config, {
      piModelDiscoveryRunner: {
        run: vi.fn(async () => ({
          exitCode: 0,
          stdout: [
            'provider    model',
            'openai-codex  gpt-5.4',
            'anthropic     claude-sonnet-4-5',
            '',
          ].join('\n'),
          stderr: '',
          timedOut: false,
          durationMs: 3,
        })),
      },
    });
    const app = createApp({
      config,
      startup: createRuntimeStartupState(),
      registry,
      pool,
      compatibility,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      kiloNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog,
    });

    const response = await app.request('/diagnostics/providers?probe=live&provider=pi&backend=cli&instance=default');
    expect(response.status).toBe(200);
    const payload = await response.json();
    const provider = payload.providers.find((entry: { provider: string; backend: string; instance: string }) =>
      entry.provider === 'pi' && entry.backend === 'cli' && entry.instance === 'default',
    );
    expect(provider).toBeTruthy();
    expect(provider).toEqual(expect.objectContaining({
      availability: expect.objectContaining({
        probe: 'live',
      }),
      config: expect.objectContaining({
        continuity: expect.objectContaining({
          source: 'provider_native',
          providerManagedSessions: true,
          providerSessionState: false,
        }),
        modelCatalog: expect.objectContaining({
          source: 'dynamic',
          defaultModel: 'openai-codex/gpt-5.4',
          defaultModelStatus: 'available',
          modelCount: 2,
          warnings: [],
        }),
      }),
    }));
    expect(provider.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'model_catalog_loaded',
        status: 'ok',
        details: expect.objectContaining({
          source: 'dynamic',
          modelCount: 2,
          defaultModel: 'openai-codex/gpt-5.4',
        }),
      }),
    ]));
  });

  it('surfaces OpenCode live compatibility against the models subcommand seam', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-provider-opencode-live-'));
    try {
      const registry = new SessionRegistry();
      const pool = {
        getCapabilities: vi.fn(() => ({
          resume: true,
          fork: false,
          permissions: true,
        })),
      } as unknown as WorkerPool;
      const config = makeConfig({
        sessionBaseDir: join(rootDir, 'sessions'),
        dataDir: join(rootDir, 'data'),
        providerCommands: {
          claude: {
            path: 'claude',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
          opencode: {
            path: 'opencode',
            runner: 'auto',
            runtime: { mode: 'native' },
          },
        } as CliRuntimeConfig['providerCommands'],
        providerDefaultInstances: {
          claude: 'default',
          opencode: 'default',
        },
        providerInstances: {
          auggie: {},
          claude: {
            default: {
              id: 'default',
              providerName: 'claude',
              commandConfig: {
                path: 'claude',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
            },
          },
          codex: {},
          copilot: {},
          cursor: {},
          antigravity: {},
          goose: {},
          junie: {},
          kiro: {},
          opencode: {
            default: {
              id: 'default',
              providerName: 'opencode',
              commandConfig: {
                path: 'opencode',
                runner: 'auto',
                runtime: { mode: 'native' },
              },
              opencodeServerHost: '127.0.0.1',
              opencodeServerPort: 4097,
              opencodeServerStartupTimeoutMs: 10_000,
            },
          },
          pi: {},
        },
        providerDefaultTargets: {
          opencode: { backend: 'cli', instance: 'default' },
        },
      });
      const compatibility = new ProviderCompatibilityService(config, {
        runner: {
          run: vi.fn(async (_providerName, _commandConfig, args: string[]) => {
            if (args[0] === '--version') {
              return {
                exitCode: 0,
                stdout: 'opencode 1.1.0\n',
                stderr: '',
                timedOut: false,
                durationMs: 3,
              };
            }

            if (args[0] === 'models') {
              return {
                exitCode: 0,
                stdout: 'Usage: opencode models [provider]\n  --refresh\n  --verbose\n',
                stderr: '',
                timedOut: false,
                durationMs: 3,
              };
            }

            return {
              exitCode: 0,
              stdout: 'Usage: opencode serve\n  models\n  serve\n',
              stderr: '',
              timedOut: false,
              durationMs: 3,
            };
          }),
        },
        installCheckRunner: createInstallCheckRunner(),
        now: () => Date.parse('2026-03-23T00:02:10.000Z'),
      });
      const providerModelCatalog = new ProviderModelCatalogService(config, {
        opencodeModelDiscoveryRunner: {
          run: vi.fn(async () => ({
            exitCode: 0,
            stdout: [
              'anthropic/claude-sonnet-4-5',
              'opencode-go/glm-5',
            ].join('\n'),
            stderr: '',
            timedOut: false,
            durationMs: 3,
          })),
        },
      });
      const app = createApp({
        config,
        startup: createRuntimeStartupState(),
        registry,
        pool,
        compatibility,
        cursorNative: {} as never,
        gooseNative: {} as never,
        kiroNative: {} as never,
        kiloNative: {} as never,
        auggieSessions: {} as never,
        opencodeNative: {} as never,
        providerModelCatalog,
      });

      const response = await app.request(
        '/diagnostics/providers?probe=live&provider=opencode&backend=cli&instance=default',
      );
      expect(response.status).toBe(200);
      const payload = await response.json();
      const provider = payload.providers.find((entry: { provider: string; backend: string; instance: string }) =>
        entry.provider === 'opencode' && entry.backend === 'cli' && entry.instance === 'default',
      );
      expect(provider).toBeTruthy();
      expect(provider).toEqual(expect.objectContaining({
        availability: expect.objectContaining({
          probe: 'live',
        }),
        compatibility: expect.objectContaining({
          classification: 'ready',
          probe: {
            mode: 'live',
            supportsLive: true,
            liveValidated: true,
          },
        }),
        config: expect.objectContaining({
          modelCatalog: expect.objectContaining({
            source: 'dynamic',
            defaultModel: 'opencode-go/glm-5',
            defaultModelStatus: 'available',
            modelCount: 2,
            warnings: [],
          }),
        }),
      }));
      expect(provider.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'model_catalog_loaded',
          status: 'ok',
        }),
      ]));
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('returns 400 for invalid provider diagnostics query filters', async () => {
    const app = createTestApp();

    const response = await app.request('/diagnostics/providers?backend=desktop');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported provider diagnostics backend 'desktop'.",
    });
  });

  it('returns 400 for malformed provider diagnostics boolean filters', async () => {
    const app = createTestApp();

    const response = await app.request('/diagnostics/providers?defaultOnly=maybe');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid boolean query value 'maybe'.",
    });
  });

  it('returns 400 for invalid provider diagnostics scope values', async () => {
    const app = createTestApp();

    const response = await app.request('/diagnostics/providers?scope=summary');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported provider diagnostics scope 'summary'.",
    });
  });

  it('returns 400 when sessionKey diagnostics omit an explicit target', async () => {
    const app = createTestApp();

    const response = await app.request('/diagnostics/providers?sessionKey=session-123');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Effective tool inspection with 'sessionKey' requires 'provider', 'backend', and 'instance'.",
    });
  });

  it('supports explicit provider diagnostics reprobe through a POST route', async () => {
    const app = createTestApp();

    const response = await app.request('/diagnostics/providers/reprobe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        probe: 'live',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      probe: 'live',
      reprobe: {
        forceRefresh: true,
      },
      query: {
        hasFilters: true,
        filters: {
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
        },
      },
      providers: [
        expect.objectContaining({
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          compatibility: expect.objectContaining({
            probe: expect.objectContaining({
              mode: 'live',
            }),
          }),
        }),
      ],
    }));
  });

  it('returns 400 for invalid explicit reprobe payloads', async () => {
    const app = createTestApp();

    const response = await app.request('/diagnostics/providers/reprobe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        probe: 'full',
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported provider diagnostics probe 'full'.",
    });
  });

  it('lists retained provider-evolution artifacts through diagnostics routes', async () => {
    const config = makeConfig();
    let now = Date.parse('2026-03-27T00:00:00.000Z');
    const probeService = new ProviderEvolutionProbeService({
      rootDir: join(
        getRuntimeResolvedPaths(config).compatibilityEvidenceDir,
        'provider-evolution',
      ),
      now: () => now,
    });

    const artifact = await probeService.run({
      target: {
        provider: 'codex',
        instance: 'default',
        parserId: 'codex-jsonrpc',
        probeProfile: 'manual_text',
        transport: 'cli',
        runtimeMode: 'docker',
        version: '1.2.3',
      },
      profile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text,
      run: async ({ observer }) => {
        observer.recordNormalized({
          rawEventType: 'assistant',
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'result',
          events: { type: 'result' },
        });
        return {
          status: 'completed',
          turnsCompleted: 1,
          emittedEventCount: 2,
        };
      },
    });

    await probeService.updateArtifactReviewById(artifact.artifact.id, {
      classifications: ['regression'],
      summary: 'Manual review flagged a regression.',
      highlights: ['Removed future.event output.'],
    }, {
      provider: 'codex',
      runtimeMode: 'docker',
    });

    const app = createTestApp(config);
    const response = await app.request(
      '/diagnostics/providers/evolution?provider=codex&runtimeMode=docker&classification=regression&limit=1',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      query: {
        provider: 'codex',
        runtimeMode: 'docker',
        reviewClassifications: ['regression'],
        limit: 1,
      },
      artifacts: [
        expect.objectContaining({
          artifactId: artifact.artifact.id,
          provider: 'codex',
          instance: 'default',
          parserId: 'codex-jsonrpc',
          probeProfile: 'manual_text',
          transport: 'cli',
          runtimeMode: 'docker',
          version: '1.2.3',
          review: expect.objectContaining({
            classifications: ['regression'],
            summary: 'Manual review flagged a regression.',
          }),
        }),
      ],
    });
  });

  it('reads retained provider-evolution artifacts by id through diagnostics routes', async () => {
    const config = makeConfig();
    const probeService = new ProviderEvolutionProbeService({
      rootDir: join(
        getRuntimeResolvedPaths(config).compatibilityEvidenceDir,
        'provider-evolution',
      ),
    });

    const artifact = await probeService.run({
      target: {
        provider: 'claude',
        instance: 'default',
        parserId: 'claude-stream-json',
        probeProfile: 'manual_text',
        transport: 'cli',
        version: '1.2.3',
      },
      profile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text,
      run: async ({ observer }) => {
        observer.recordNormalized({
          rawEventType: 'assistant',
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'result',
          events: { type: 'result' },
        });
        return {
          status: 'completed',
          turnsCompleted: 1,
          emittedEventCount: 2,
        };
      },
    });

    const app = createTestApp(config);
    const response = await app.request(
      `/diagnostics/providers/evolution/${artifact.artifact.id}?provider=claude`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      relativePath: expect.stringContaining('claude/'),
      artifact: expect.objectContaining({
        id: artifact.artifact.id,
        provider: 'claude',
        instance: 'default',
        parserId: 'claude-stream-json',
        probeProfile: 'manual_text',
        transport: 'cli',
        version: '1.2.3',
      }),
    });

    const missing = await app.request('/diagnostics/providers/evolution/missing-artifact');
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({
      error: "Provider-evolution artifact 'missing-artifact' was not found.",
      code: 'provider_evolution_artifact_not_found',
    });
  });

  it('returns 400 for invalid provider-evolution artifact query filters', async () => {
    const app = createTestApp();

    const response = await app.request(
      '/diagnostics/providers/evolution?runtimeMode=hyperv&classification=future_state',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported provider-evolution runtimeMode 'hyperv'.",
    });
  });

  it('supports manual provider-evolution review updates through a POST route', async () => {
    const config = makeConfig();
    let now = Date.parse('2026-03-27T00:00:00.000Z');
    const probeService = new ProviderEvolutionProbeService({
      rootDir: join(
        getRuntimeResolvedPaths(config).compatibilityEvidenceDir,
        'provider-evolution',
      ),
      now: () => now,
    });

    const artifact = await probeService.run({
      target: {
        provider: 'codex',
        instance: 'default',
        parserId: 'codex-jsonrpc',
        probeProfile: 'manual_text',
        transport: 'cli',
        version: '1.2.3',
      },
      profile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text,
      run: async ({ observer }) => {
        observer.recordNormalized({
          rawEventType: 'assistant',
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'result',
          events: { type: 'result' },
        });
        return {
          status: 'completed',
          turnsCompleted: 1,
          emittedEventCount: 2,
        };
      },
    });

    const app = createTestApp(config);
    const response = await app.request(
      `/diagnostics/providers/evolution/${artifact.artifact.id}/review`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'codex',
          classifications: ['regression', 'schema-change'],
          summary: 'Manual review flagged a regression with schema changes.',
          highlights: [
            'Removed event types: future.event',
            'Schema changes observed for tool_result.',
          ],
          references: [
            {
              kind: 'issue',
              url: 'https://docs.example.com/issues/codex-cli-regression',
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      artifact: expect.objectContaining({
        artifactId: artifact.artifact.id,
        review: {
          classifications: ['regression', 'schema_change'],
          summary: 'Manual review flagged a regression with schema changes.',
          highlights: [
            'Removed event types: future.event',
            'Schema changes observed for tool_result.',
          ],
        },
        reviewContext: {
          references: [
            {
              kind: 'issue',
              url: 'https://docs.example.com/issues/codex-cli-regression',
            },
          ],
        },
      }),
      updated: true,
    });

    const reread = await probeService.readArtifactById(artifact.artifact.id, {
      provider: 'codex',
    });
    expect(reread?.artifact.review).toEqual({
      classifications: ['regression', 'schema_change'],
      summary: 'Manual review flagged a regression with schema changes.',
      highlights: [
        'Removed event types: future.event',
        'Schema changes observed for tool_result.',
      ],
    });
    expect(reread?.artifact.reviewContext).toEqual({
      references: [
        {
          kind: 'issue',
          url: 'https://docs.example.com/issues/codex-cli-regression',
        },
      ],
    });
  });

  it('returns 400 for invalid provider-evolution review payloads', async () => {
    const app = createTestApp();

    const response = await app.request('/diagnostics/providers/evolution/artifact-1/review', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        classifications: ['future_state'],
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid provider-evolution classification 'future_state'.",
    });
  });

  it('returns 404 when reviewing a missing provider-evolution artifact', async () => {
    const app = createTestApp();

    const response = await app.request('/diagnostics/providers/evolution/missing-artifact/review', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'claude',
        summary: 'No artifact was found.',
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Provider-evolution artifact 'missing-artifact' was not found.",
      code: 'provider_evolution_artifact_not_found',
    });
  });
});
