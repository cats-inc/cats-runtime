import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/core/config.js';
import { createDiscoveryController, createRuntimeServer } from '../src/server.js';
import { createRuntimeStartupState } from '../src/startup.js';

function alignDefaultProviderRuntime(
  config: ReturnType<typeof loadConfig>,
  provider: 'cursor' | 'kiro',
  runtime: { mode: 'native' | 'wsl'; distro?: string },
): void {
  const defaultInstanceId = config.providerDefaultInstances?.[provider] || 'default';
  const instance = config.providerInstances?.[provider]?.[defaultInstanceId];
  if (!instance) {
    return;
  }

  const nextRuntime = {
    ...instance.commandConfig.runtime,
    ...runtime,
  };
  instance.commandConfig = {
    ...instance.commandConfig,
    runtime: nextRuntime,
  };
  config.providerCommands[provider] = {
    ...config.providerCommands[provider],
    runtime: nextRuntime,
  };
}

function createTestConfig(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-test-'));
  const env = {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_CONFIG_PATH: join(root, 'providers.missing.yaml'),
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
    CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
    CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    GEMINI_SESSIONS_DIR: join(root, '.gemini', 'tmp'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
  };

  for (const dir of [
    env.CATS_RUNTIME_SESSION_BASE_DIR,
    env.CATS_RUNTIME_DATA_DIR,
    env.AUGGIE_SESSIONS_DIR,
    env.CLAUDE_PROJECTS_DIR,
    env.CODEX_SESSIONS_DIR,
    env.COPILOT_SESSIONS_DIR,
    env.CURSOR_CHATS_DIR,
    env.GEMINI_SESSIONS_DIR,
    env.PI_SESSIONS_DIR,
    join(root, '.junie', 'sessions'),
    join(root, 'data'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  const config = {
    ...loadConfig(env),
    host: '127.0.0.1',
    port: 0,
    ...overrides,
  };

  const overrideRecord = overrides as Record<string, unknown>;
  const overriddenProviderInstances = (
    overrideRecord.providerInstances
    && typeof overrideRecord.providerInstances === 'object'
    && !Array.isArray(overrideRecord.providerInstances)
  ) ? overrideRecord.providerInstances as Record<string, unknown> : undefined;

  if (overrideRecord.cursorRuntime && !overriddenProviderInstances?.cursor) {
    alignDefaultProviderRuntime(
      config,
      'cursor',
      overrideRecord.cursorRuntime as { mode: 'native' | 'wsl'; distro?: string },
    );
  }

  if (overrideRecord.kiroRuntime && !overriddenProviderInstances?.kiro) {
    alignDefaultProviderRuntime(
      config,
      'kiro',
      overrideRecord.kiroRuntime as { mode: 'native' | 'wsl'; distro?: string },
    );
  }

  return { root, config, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function withRuntime(
  overrides: Record<string, unknown>,
  options: Parameters<typeof createRuntimeServer>[1],
  run: (runtime: ReturnType<typeof createRuntimeServer>) => Promise<void>,
) {
  const { config, cleanup } = createTestConfig(overrides);
  const runtime = createRuntimeServer(config, options);
  try {
    await run(runtime);
  } finally {
    await runtime.close();
    cleanup();
  }
}

describe('runtime server', () => {
  it('GET / serves the embedded dashboard', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Cats Runtime Dashboard');
      expect(html.indexOf('<option value="claude">claude</option>'))
        .toBeLessThan(html.indexOf('<option value="codex">codex</option>'));
      expect(html.indexOf('<option value="codex">codex</option>'))
        .toBeLessThan(html.indexOf('<option value="gemini">gemini</option>'));
      expect(html.indexOf('<option value="kiro">kiro</option>'))
        .toBeLessThan(html.indexOf('<option value="auggie">auggie</option>'));

      const openCreateModalMatch = html.match(
        /async function openCreateModal\(\) \{([\s\S]*?)\n\}/,
      );
      expect(openCreateModalMatch?.[1]).toBeTruthy();
      const openCreateModalBody = openCreateModalMatch![1];
      expect(openCreateModalBody.indexOf("classList.add('open')"))
        .toBeLessThan(openCreateModalBody.indexOf('await refreshProviderCatalog()'));
      expect(html).toContain('id="createSessionBtn"');
      expect(html).not.toContain("{ id: 'default', runtime: { mode: 'native' } }");
    });
  });

  it('GET /health enforces optional inbound auth', async () => {
    await withRuntime({ apiKey: 'runtime-secret' }, {}, async (runtime) => {
      const unauthenticated = await runtime.app.request('/health');
      expect(unauthenticated.status).toBe(401);

      const authenticated = await runtime.app.request(
        '/health',
        {
          headers: { authorization: 'Bearer runtime-secret' },
        },
      );

      expect(authenticated.status).toBe(200);
      expect(await authenticated.json()).toEqual({
        service: 'cats-runtime',
        status: 'ok',
        version: '0.1.0',
        timestamp: expect.any(String),
        startup: {
          mode: 'standalone',
          managedBy: undefined,
          readySignal: 'http',
          ready: false,
          pid: expect.any(Number),
          startedAt: expect.any(String),
          address: undefined,
        },
      });
    });
  });

  it('GET /health exposes app-managed startup metadata after listen', async () => {
    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer(config, {
      startup: createRuntimeStartupState({
        mode: 'app-managed',
        managedBy: 'cats-inc',
        readyOutput: 'json',
      }),
    });

    try {
      const address = await runtime.start();
      const response = await fetch(`http://${address.host}:${address.port}/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        service: 'cats-runtime',
        status: 'ok',
        version: '0.1.0',
        timestamp: expect.any(String),
        startup: {
          mode: 'app-managed',
          managedBy: 'cats-inc',
          readySignal: 'http',
          ready: true,
          pid: expect.any(Number),
          startedAt: expect.any(String),
          address: {
            host: address.host,
            port: address.port,
            healthUrl: `http://${address.host}:${address.port}/health`,
          },
        },
      });
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('GET /sessions returns the embedded registry state', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/sessions');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sessions: [],
        count: 0,
      });
    });
  });

  it('POST /sessions rejects unknown providers before spawning', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'unknown-cli', cwd: 'C:/repo' }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toMatch(/Unknown provider 'unknown-cli'/);
    });
  });

  it('GET /kiro/models returns the local catalog without an upstream proxy', async () => {
    await withRuntime({ kiroRuntime: { mode: 'wsl' } }, {}, async (runtime) => {
      const response = await runtime.app.request('/kiro/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        instance: 'default',
        runtime: { mode: 'wsl' },
        source: 'static',
        models: ['claude-sonnet-4.5', 'deepseek-3.2', 'minimax-m2.1'],
      });
    });
  });

  it('GET /providers/config returns configured provider instances for the dashboard', async () => {
    await withRuntime({
      providerDefaultInstances: {
        cursor: 'ubuntu',
      },
      providerInstances: {
        auggie: {},
        claude: {},
        codex: {},
        copilot: {},
        cursor: {
          ubuntu: {
            id: 'ubuntu',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
            },
            cursorChatsDir: '/wsl/ubuntu/.cursor/chats',
          },
          debian: {
            id: 'debian',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Debian', environmentId: 'debian' },
            },
            cursorChatsDir: '/wsl/debian/.cursor/chats',
          },
        },
        gemini: {},
        kiro: {},
        opencode: {},
        pi: {},
        goose: {},
        junie: {},
      },
    }, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/config');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        providers: {
          cursor: {
            defaultInstance: 'ubuntu',
            defaultBackend: 'cli',
            instances: [
              {
                id: 'ubuntu',
                target: 'cli/ubuntu',
                backend: 'cli',
                command: 'cursor-agent',
                runner: 'auto',
                runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
                transport: undefined,
                model: undefined,
              },
              {
                id: 'debian',
                target: 'cli/debian',
                backend: 'cli',
                command: 'cursor-agent',
                runner: 'auto',
                runtime: { mode: 'wsl', distro: 'Debian', environmentId: 'debian' },
                transport: undefined,
                model: undefined,
              },
            ],
          },
        },
      });
    });
  });

  it('POST /sessions rejects providers omitted by positive-list YAML config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-positive-list-test-'));
    const configPath = join(root, 'providers.yaml');
    writeFileSync(configPath, `
version: 1
environments:
  native:
    kind: native
providers:
  claude:
    instances:
      default:
        environment: native
        command: claude
        runner: auto
        projects_dir: ~/.claude/projects
`.trimStart());

    const env = {
      HOME: root,
      USERPROFILE: root,
      CATS_RUNTIME_CONFIG_PATH: configPath,
      CATS_RUNTIME_HOST: '127.0.0.1',
      CATS_RUNTIME_PORT: '3110',
      CATS_RUNTIME_NATIVE_DISCOVERY_INTERVAL_MS: '0',
      CATS_RUNTIME_EXTERNAL_SESSION_LIVE_WINDOW_MS: '0',
      CATS_RUNTIME_DATA_DIR: join(root, 'runtime-data'),
      CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'runtime-sessions'),
    };

    for (const dir of [
      env.CATS_RUNTIME_DATA_DIR,
      env.CATS_RUNTIME_SESSION_BASE_DIR,
    ]) {
      mkdirSync(dir, { recursive: true });
    }

    const runtime = createRuntimeServer(loadConfig(env));
    try {
      const catalogResponse = await runtime.app.request('/providers/config');
      expect(catalogResponse.status).toBe(200);
      expect(await catalogResponse.json()).toEqual({
        providers: {
          claude: {
            defaultInstance: 'default',
            defaultBackend: 'cli',
            instances: [
              {
                id: 'default',
                target: 'cli/default',
                backend: 'cli',
                command: 'claude',
                runner: 'auto',
                runtime: { mode: 'native', environmentId: 'native' },
                transport: undefined,
                model: undefined,
              },
            ],
          },
        },
      });

      const response = await runtime.app.request('/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'codex' }),
      });

      expect(response.status).toBe(400);
      const payload = await response.json();
      expect(payload.error).toMatch(/Unknown provider 'codex'\. Valid: claude/);
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('GET /sessions treats instance=default as the provider default alias in YAML mode', async () => {
    await withRuntime({
      providerDefaultInstances: {
        cursor: 'ubuntu',
      },
      providerInstances: {
        cursor: {
          ubuntu: {
            id: 'ubuntu',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
            },
            cursorChatsDir: '/wsl/ubuntu/.cursor/chats',
          },
          native: {
            id: 'native',
            providerName: 'cursor',
            commandConfig: {
              path: 'cursor-agent',
              runner: 'auto',
              runtime: { mode: 'native', environmentId: 'native' },
            },
            cursorChatsDir: 'C:/Users/test/.cursor/chats',
          },
        },
      },
    }, {}, async (runtime) => {
      runtime.context.registry.create({
        providerName: 'cursor',
        providerInstanceId: 'ubuntu',
        cwd: 'C:/repo',
      });
      runtime.context.registry.create({
        providerName: 'cursor',
        providerInstanceId: 'native',
        cwd: 'C:/repo-native',
      });

      const response = await runtime.app.request('/sessions?provider=cursor&instance=default');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sessions: [
          expect.objectContaining({
            providerName: 'cursor',
            providerInstanceId: 'ubuntu',
            cwd: 'C:/repo',
          }),
        ],
        count: 1,
      });
    });
  });

  it('GET /discovery/status reports WSL discovery policy state for dashboard polling', async () => {
    await withRuntime({
      cursorRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      kiroRuntime: { mode: 'wsl', distro: 'Ubuntu' },
      wslDiscoveryPolicy: 'manual_only',
      nativeDiscoveryIntervalMs: 5000,
    }, {}, async (runtime) => {
      const response = await runtime.app.request('/discovery/status');
      expect(response.status).toBe(200);

      const payload = await response.json() as {
        wsl: {
          policy: string;
          summary: { state: string; message: string };
          providers: Record<string, {
            state: string;
            runtimeMode: string;
            distro?: string;
            message: string;
          }>;
        };
      };

      expect(payload.wsl.policy).toBe('manual_only');
      expect(payload.wsl.summary).toEqual({
        state: 'disabled',
        message: 'Background WSL discovery is disabled by policy',
      });
      expect(payload.wsl.providers.cursor).toEqual(expect.objectContaining({
        state: 'disabled',
        runtimeMode: 'wsl',
        distro: 'Ubuntu',
      }));
      expect(payload.wsl.providers.kiro).toEqual(expect.objectContaining({
        state: 'disabled',
        runtimeMode: 'wsl',
        distro: 'Ubuntu',
      }));
    });
  });

  it('boots with Docker-backed file providers without trying to host-resolve their container paths', async () => {
    const { config, cleanup } = createTestConfig({
      providerDefaultInstances: {
        auggie: 'docker-dev',
        copilot: 'docker-dev',
      },
      providerInstances: {
        auggie: {
          'docker-dev': {
            id: 'docker-dev',
            providerName: 'auggie',
            commandConfig: {
              path: 'auggie',
              runner: 'auto',
              runtime: { mode: 'docker', container: 'cats-cli-test', environmentId: 'docker-dev' },
            },
            auggieSessionsDir: '~/.augment/sessions',
          },
        },
        copilot: {
          'docker-dev': {
            id: 'docker-dev',
            providerName: 'copilot',
            commandConfig: {
              path: 'copilot',
              runner: 'auto',
              runtime: { mode: 'docker', container: 'cats-cli-test', environmentId: 'docker-dev' },
            },
            copilotSessionsDir: '~/.copilot/session-state',
          },
        },
      },
    });

    const runtime = createRuntimeServer(config);
    try {
      await runtime.start();
      const response = await runtime.app.request('/health');
      expect(response.status).toBe(200);
    } finally {
      await runtime.close();
      cleanup();
    }
  });

  it('deduplicates overlapping file discovery watchers even when one path uses ~', async () => {
    const { root, config, cleanup } = createTestConfig();
    const sharedDir = join(root, '.augment', 'sessions');
    writeFileSync(
      join(sharedDir, 'session-1.json'),
      JSON.stringify({
        sessionId: 'auggie-1',
        created: '2026-03-10T00:00:00.000Z',
        modified: '2026-03-10T00:01:00.000Z',
        name: 'Repo review',
        agentState: {
          modelId: 'gpt-5-4',
        },
        chatHistory: [
          {
            exchange: {
              request_message: 'Review this repo',
              request_nodes: [
                {
                  ide_state_node: {
                    workspace_folders: [
                      {
                        folder_root: 'C:/Users/kenne/Source/SK2/one-man-digital-company',
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      }, null, 2),
      'utf-8',
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    config.auggieSessionsDir = sharedDir;
    config.providerDefaultInstances = {
      ...config.providerDefaultInstances,
      auggie: 'native',
    };
    config.providerInstances = {
      ...config.providerInstances,
      auggie: {
        native: {
          id: 'native',
          providerName: 'auggie',
          commandConfig: config.providerCommands.auggie,
          auggieSessionsDir: sharedDir,
        },
        mirror: {
          id: 'mirror',
          providerName: 'auggie',
          commandConfig: {
            ...config.providerCommands.auggie,
            runtime: { ...config.providerCommands.auggie.runtime },
          },
          auggieSessionsDir: '~/.augment/sessions',
        },
      },
    };

    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = root;
    process.env.USERPROFILE = root;

    const runtime = createRuntimeServer(config);
    const discovery = createDiscoveryController(runtime.context);
    try {
      discovery.start();

      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (runtime.context.registry.list({ provider: 'auggie' }).length > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      const sessions = runtime.context.registry.list({ provider: 'auggie' });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].providerInstanceId).toBe('native');
      expect(
        warnSpy.mock.calls.some(([message]) =>
          String(message).includes("share watch dir")
          && String(message).includes("'auggie'")
          && String(message).includes("'auggie@mirror'")),
      ).toBe(true);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      discovery.stop();
      warnSpy.mockRestore();
      await runtime.close();
      cleanup();
    }
  });

  it('GET /providers/:provider/models returns structured static fallback for CLI providers', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'codex',
        backend: 'cli',
        instance: 'default',
        defaultModel: 'gpt-5.4',
        source: 'static',
        cache: null,
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
          { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', default: false },
          { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex', default: false },
        ],
        warnings: [],
      });
    });
  });

  it('GET /providers/:provider/models returns dynamic Ollama catalog with cache metadata', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      models: [
        { name: 'deepseek-r1:14b' },
        { name: 'qwen2.5-coder:7b' },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await withRuntime({
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
    }, { apiBackend: { fetch: fetchMock } }, async (runtime) => {
      const first = await runtime.app.request('/providers/ollama/models');
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({
        provider: 'ollama',
        backend: 'local',
        instance: 'local',
        defaultModel: 'qwen2.5-coder:7b',
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: expect.any(String),
          ttlSec: 60,
        },
        models: [
          { id: 'deepseek-r1:14b', label: 'deepseek-r1:14b', default: false },
          { id: 'qwen2.5-coder:7b', label: 'qwen2.5-coder:7b', default: true },
        ],
        warnings: [],
      });

      const second = await runtime.app.request('/providers/ollama/models');
      expect(second.status).toBe(200);
      expect((await second.json()).cache).toEqual({
        servedFromCache: true,
        cachedAt: expect.any(String),
        ttlSec: 60,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('GET /providers/:provider/models uses agent adapter model discovery when available', async () => {
    const bridgeFetch = vi.fn(async () => new Response(JSON.stringify({
      providers: [
        { name: 'openai', models: ['gpt-5.4', 'gpt-5.3-codex'] },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await withRuntime({
      providerDefaultTargets: {
        codex: { backend: 'agent', instance: 'bridge' },
      },
      remoteProviderCatalog: {
        api: {},
        local: {},
        agent: {
          codex: {
            bridge: {
              id: 'bridge',
              providerName: 'codex',
              backend: 'agent',
              transport: 'agent_sdk_bridge',
              baseUrl: 'http://127.0.0.1:8082',
              model: 'gpt-5.4',
            },
          },
        },
      },
    }, { agentBackend: { fetch: bridgeFetch } }, async (runtime) => {
      const response = await runtime.app.request('/providers/codex/models?instance=agent/bridge');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'codex',
        backend: 'agent',
        instance: 'bridge',
        defaultModel: 'gpt-5.4',
        source: 'dynamic',
        cache: {
          servedFromCache: false,
          cachedAt: expect.any(String),
          ttlSec: 60,
        },
        models: [
          { id: 'gpt-5.4', label: 'gpt-5.4', default: true },
          { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', default: false },
        ],
        warnings: [],
      });
    });
  });

  it('GET /providers/:provider/models falls back to static catalog when dynamic discovery fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });

    await withRuntime({
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
    }, { apiBackend: { fetch: fetchMock } }, async (runtime) => {
      const response = await runtime.app.request('/providers/ollama/models');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        provider: 'ollama',
        backend: 'local',
        instance: 'local',
        defaultModel: 'qwen2.5-coder:7b',
        source: 'config',
        cache: null,
        models: [
          { id: 'qwen2.5-coder:7b', label: 'qwen2.5-coder:7b', default: true },
        ],
        warnings: [
          expect.stringContaining(
            'Dynamic model discovery failed for ollama/local/local: connection refused',
          ),
        ],
      });
    });
  });

  it('GET /providers/:provider/models returns 400 for unknown providers', async () => {
    await withRuntime({}, {}, async (runtime) => {
      const response = await runtime.app.request('/providers/missing/models');
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Failed to inspect provider models: Error: Provider 'missing' is not configured",
      });
    });
  });

  it('createDiscoveryController falls back to default services when instance resolvers are absent', async () => {
    const { config, cleanup } = createTestConfig();
    const runtime = createRuntimeServer(config);

    try {
      expect(() => createDiscoveryController({
        ...runtime.context,
        resolveCursorNative: undefined,
        resolveKiroNative: undefined,
        resolveAuggieSessions: undefined,
        resolveOpencodeNative: undefined,
        wslDiscoveryStatus: undefined,
      })).not.toThrow();
    } finally {
      await runtime.close();
      cleanup();
    }
  });
});
