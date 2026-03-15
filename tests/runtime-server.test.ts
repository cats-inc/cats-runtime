import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/core/config.js';
import { createDiscoveryController, createRuntimeServer } from '../src/server.js';

function createTestConfig(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-test-'));
  const env = {
    HOME: root,
    USERPROFILE: root,
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

  return { root, config, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function withRuntime(
  overrides: Record<string, unknown>,
  run: (runtime: ReturnType<typeof createRuntimeServer>) => Promise<void>,
) {
  const { config, cleanup } = createTestConfig(overrides);
  const runtime = createRuntimeServer(config);
  try {
    await run(runtime);
  } finally {
    await runtime.close();
    cleanup();
  }
}

describe('runtime server', () => {
  it('GET / serves the embedded dashboard', async () => {
    await withRuntime({}, async (runtime) => {
      const response = await runtime.app.request('/');
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('cats-runtime Dashboard');
      expect(html).toContain('cats-runtime');
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
    });
  });

  it('GET /health enforces optional inbound auth', async () => {
    await withRuntime({ apiKey: 'runtime-secret' }, async (runtime) => {
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
      });
    });
  });

  it('GET /sessions returns the embedded registry state', async () => {
    await withRuntime({}, async (runtime) => {
      const response = await runtime.app.request('/sessions');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sessions: [],
        count: 0,
      });
    });
  });

  it('POST /sessions rejects unknown providers before spawning', async () => {
    await withRuntime({}, async (runtime) => {
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
    await withRuntime({ kiroRuntime: { mode: 'wsl' } }, async (runtime) => {
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
      },
    }, async (runtime) => {
      const response = await runtime.app.request('/providers/config');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        providers: expect.objectContaining({
          cursor: {
            defaultInstance: 'ubuntu',
            instances: [
              {
                id: 'ubuntu',
                command: 'cursor-agent',
                runner: 'auto',
                runtime: { mode: 'wsl', distro: 'Ubuntu', environmentId: 'ubuntu' },
              },
              {
                id: 'debian',
                command: 'cursor-agent',
                runner: 'auto',
                runtime: { mode: 'wsl', distro: 'Debian', environmentId: 'debian' },
              },
            ],
          },
        }),
      });
    });
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
    }, async (runtime) => {
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
    }, async (runtime) => {
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
    try {
      await runtime.start();

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
      warnSpy.mockRestore();
      await runtime.close();
      cleanup();
    }
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
