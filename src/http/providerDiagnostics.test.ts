import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { createRuntimeStartupState } from '../startup.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import { ProviderCompatibilityService } from '../core/compatibility/ProviderCompatibilityService.js';
import type { ProviderInstallCheckRunner } from '../core/provider-install/ProviderInstallCheckRunner.js';

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
      geminiPath: 'gemini',
      goosePath: 'goose',
      juniePath: 'junie',
      kiroPath: 'kiro-cli',
      opencodePath: 'opencode',
      piPath: 'pi',
      opencodeServerHost: '127.0.0.1',
      opencodeServerPort: 4097,
      opencodeServerStartupTimeoutMs: 10_000,
      auggieSessionsDir: join(rootDir, '.augment', 'sessions'),
      claudeProjectsDir: join(rootDir, '.claude', 'projects'),
      codexSessionsDir: join(rootDir, '.codex', 'sessions'),
      copilotSessionsDir: join(rootDir, '.copilot', 'session-state'),
      cursorChatsDir: join(rootDir, '.cursor', 'chats'),
      cursorRuntime: { mode: 'native' },
      geminiSessionsDir: join(rootDir, '.gemini', 'tmp'),
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
        gemini: {},
        goose: {},
        junie: {},
        kiro: {},
        opencode: {},
        pi: {},
      },
    } as unknown as CliRuntimeConfig;

    return {
      ...config,
      ...overrides,
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

  function createTestApp(config: CliRuntimeConfig = makeConfig()) {
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
      installCheckRunner: createInstallCheckRunner(),
      now: () => Date.parse('2026-03-23T00:02:00.000Z'),
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
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog: {} as never,
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
        gemini: {},
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

  it('runs live endpoint probes for API and local targets when requested', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (url === 'https://api.anthropic.test/v1') {
        return new Response('', { status: 401 });
      }
      if (url === 'http://127.0.0.1:11434/api/tags') {
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
                code: 'endpoint_reachable',
                status: 'ok',
                details: expect.objectContaining({
                  url: 'https://api.anthropic.test/v1',
                  statusCode: 401,
                }),
              }),
            ]),
            config: expect.objectContaining({
              liveProbe: expect.objectContaining({
                url: 'https://api.anthropic.test/v1',
                reachable: true,
                statusCode: 401,
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
            checks: expect.arrayContaining([
              expect.objectContaining({
                code: 'endpoint_reachable',
                status: 'ok',
                details: expect.objectContaining({
                  url: 'http://127.0.0.1:11434/api/tags',
                  statusCode: 200,
                }),
              }),
            ]),
            config: expect.objectContaining({
              liveProbe: expect.objectContaining({
                url: 'http://127.0.0.1:11434/api/tags',
                reachable: true,
                statusCode: 200,
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
});
