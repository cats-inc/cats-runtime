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
import { ProviderModelCatalogService } from '../core/models/providerModelCatalog.js';
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
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog,
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
                    total: 28,
                    fullAccess: 28,
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
                modelCount: 1,
                warnings: [],
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
                modelCount: 1,
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
        gemini: {},
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
        modelCatalog: expect.objectContaining({
          source: 'dynamic',
          defaultModel: 'openai-codex/gpt-5.4',
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
