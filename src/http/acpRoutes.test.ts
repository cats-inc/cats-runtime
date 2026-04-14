import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { GooseNativeSessionService } from '../backends/cli/goose/GooseNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import { createRuntimeStartupState } from '../startup.js';

function makeConfig(sessionBaseDir: string, dataDir: string): CliRuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 3100,
    apiKey: '',
    auggiePath: 'auggie',
    claudePath: 'claude',
    codexPath: 'codex',
    copilotPath: 'copilot',
    cursorPath: 'cursor-agent',
    geminiPath: 'gemini',
    goosePath: 'goose',
    juniePath: 'junie',
    kiroPath: 'kiro-cli',
    kiloPath: 'kilo',
    opencodePath: 'opencode',
    piPath: 'pi',
    opencodeServerHost: '127.0.0.1',
    opencodeServerPort: 4097,
    opencodeServerStartupTimeoutMs: 10000,
    kiloServerHost: '127.0.0.1',
    kiloServerPort: 4313,
    kiloServerStartupTimeoutMs: 10000,
    auggieSessionsDir: '',
    claudeProjectsDir: '',
    codexSessionsDir: '',
    copilotSessionsDir: '',
    cursorChatsDir: '',
    cursorRuntime: {
      mode: 'native',
    },
    geminiSessionsDir: '',
    kiroDbPath: '',
    kiroRuntime: {
      mode: 'native',
    },
    sessionBaseDir,
    dataDir,
    externalSessionLiveWindowMs: 0,
    maxSessions: 10,
    providerCommands: {
      auggie: { path: 'auggie', runner: 'auto', runtime: { mode: 'native' } },
      claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
      codex: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
      copilot: { path: 'copilot', runner: 'auto', runtime: { mode: 'native' } },
      cursor: { path: 'cursor-agent', runner: 'auto', runtime: { mode: 'native' } },
      gemini: { path: 'gemini', runner: 'auto', runtime: { mode: 'native' } },
      goose: { path: 'goose', runner: 'auto', runtime: { mode: 'native' } },
      junie: { path: 'junie', runner: 'auto', runtime: { mode: 'native' } },
      kiro: { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'native' } },
      kilo: { path: 'kilo', runner: 'auto', runtime: { mode: 'native' } },
      opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
      pi: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } },
    },
  } as unknown as CliRuntimeConfig;
}

function makeApp(options: { bootstrapRequired?: boolean } = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-routes-'));
  const sessionBaseDir = join(rootDir, 'sessions');
  const dataDir = join(rootDir, 'data');
  mkdirSync(sessionBaseDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const pool = {
    getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
    get: vi.fn(() => undefined),
    spawn: vi.fn(),
    kill: vi.fn(),
    status: vi.fn(() => ({ active: 0 })),
  } as unknown as WorkerPool;

  const registry = new SessionRegistry();
  const app = createApp({
    config: makeConfig(sessionBaseDir, dataDir),
    startup: createRuntimeStartupState({
      ready: true,
      bootstrapRequired: options.bootstrapRequired ?? false,
    }),
    registry,
    pool,
    cursorNative: {} as CursorNativeSessionService,
    gooseNative: {} as GooseNativeSessionService,
    kiroNative: {} as KiroNativeSessionService,
    auggieSessions: {} as AuggieSessionService,
    opencodeNative: {} as OpencodeNativeSessionService,
  });

  return { app, rootDir, registry };
}

describe('runtime ACP facade routes', () => {
  const cleanupRoots: string[] = [];

  afterEach(() => {
    while (cleanupRoots.length > 0) {
      rmSync(cleanupRoots.pop()!, { recursive: true, force: true });
    }
  });

  it('implements initialize over POST /acp with a conservative capability profile', async () => {
    const { app, rootDir } = makeApp();
    cleanupRoots.push(rootDir);

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: 1,
        agentInfo: {
          name: 'cats-runtime',
          version: expect.any(String),
        },
        authMethods: [],
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            audio: false,
            embeddedContext: false,
            image: false,
          },
          mcpCapabilities: {
            http: false,
            sse: false,
          },
          sessionCapabilities: {
            list: {},
          },
        },
        _meta: {
          catsRuntime: {
            transport: 'http',
            path: '/acp',
            bootstrapRequired: false,
            readinessPath: '/health',
            sessionLifecycle: 'pending',
            supportedMethods: [
              'initialize',
              'ping',
              'session/new',
              'session/list',
              'session/load',
              'session/cancel',
            ],
          },
        },
      },
    });
  });

  it('creates a runtime-owned session through ACP session/new via the shared session route', async () => {
    const { app, rootDir, registry } = makeApp();
    cleanupRoots.push(rootDir);

    const cwd = join(rootDir, 'workspace-new');
    mkdirSync(cwd, { recursive: true });

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'new',
        method: 'session/new',
        params: {
          cwd,
          mcpServers: [],
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      jsonrpc: string;
      id: string;
      result: {
        sessionId: string;
        _meta: {
          catsRuntime: {
            source: string;
            clientMcpServers: number;
            session: {
              id: string;
              cwd: string;
              providerName: string;
              status: string;
            };
          };
        };
      };
    };

    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe('new');
    expect(body.result.sessionId).toBeTruthy();
    expect(body.result._meta.catsRuntime).toMatchObject({
      source: 'runtime_http_bridge',
      clientMcpServers: 0,
      session: {
        id: body.result.sessionId,
        cwd,
        providerName: 'claude',
        status: 'initializing',
      },
    });

    expect(registry.get(body.result.sessionId)).toMatchObject({
      id: body.result.sessionId,
      cwd,
      providerName: 'claude',
      status: 'initializing',
    });
  });

  it('lists runtime-owned sessions through ACP session/list', async () => {
    const { app, rootDir, registry } = makeApp();
    cleanupRoots.push(rootDir);

    const session = registry.create({
      id: 'runtime-session-list',
      providerName: 'claude',
      cwd: join(rootDir, 'workspace'),
    });
    session.summary = 'ACP listed session';
    session.lastActivity = '2026-04-15T04:30:00.000Z';
    registry.updateStatus(session.id, 'ready');

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'list',
        method: 'session/list',
        params: {
          cwd: join(rootDir, 'workspace'),
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'list',
      result: {
        sessions: [{
          sessionId: 'runtime-session-list',
          cwd: join(rootDir, 'workspace'),
          title: 'ACP listed session',
          updatedAt: '2026-04-15T04:30:00.000Z',
          _meta: {
            catsRuntime: {
              providerName: 'claude',
              providerBackend: 'cli',
              providerInstanceId: 'default',
              status: 'ready',
              workspaceMode: 'shared',
            },
          },
        }],
        nextCursor: null,
        _meta: {
          catsRuntime: {
            source: 'runtime_registry',
            returnedCount: 1,
          },
        },
      },
    });
  });

  it('loads an existing runtime-owned session through ACP session/load', async () => {
    const { app, rootDir, registry } = makeApp();
    cleanupRoots.push(rootDir);

    const session = registry.create({
      id: 'runtime-session-load',
      providerName: 'codex',
      providerBackend: 'agent',
      providerInstanceId: 'acp-local',
      cwd: join(rootDir, 'workspace-load'),
    });
    session.summary = 'ACP loaded session';
    registry.updateStatus(session.id, 'ready');

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'load',
        method: 'session/load',
        params: {
          sessionId: session.id,
          cwd: join(rootDir, 'workspace-load'),
          mcpServers: [],
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'load',
      result: {
        _meta: {
          catsRuntime: {
            session: {
              sessionId: 'runtime-session-load',
              cwd: join(rootDir, 'workspace-load'),
              title: 'ACP loaded session',
              _meta: {
                catsRuntime: {
                  providerName: 'codex',
                  providerBackend: 'agent',
                  providerInstanceId: 'acp-local',
                  status: 'ready',
                  workspaceMode: 'shared',
                },
              },
            },
            resumedFromRuntimeRegistry: true,
            clientMcpServers: 0,
          },
        },
      },
    });
  });

  it('accepts ACP session/cancel as a notification and bridges it to the runtime session route', async () => {
    const { app, rootDir, registry } = makeApp();
    cleanupRoots.push(rootDir);

    const session = registry.create({
      id: 'runtime-session-cancel',
      providerName: 'claude',
      cwd: join(rootDir, 'workspace-cancel'),
    });
    registry.updateStatus(session.id, 'busy');

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: {
          sessionId: session.id,
        },
      }),
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(registry.get(session.id)?.status).toBe('ready');
  });

  it('returns JSON-RPC parse errors for invalid ACP HTTP bodies', async () => {
    const { app, rootDir } = makeApp();
    cleanupRoots.push(rootDir);

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Invalid JSON body',
      },
    });
  });

  it('returns a truthful not-yet-enabled error for ACP prompt-turn methods', async () => {
    const { app, rootDir } = makeApp();
    cleanupRoots.push(rootDir);

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'session-prompt',
        method: 'session/prompt',
        params: {
          sessionId: 'runtime-session',
          prompt: [{ type: 'text', text: 'hello' }],
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'session-prompt',
      error: {
        code: -32601,
        message: "ACP method 'session/prompt' is not yet enabled by the cats-runtime ACP facade.",
        data: {
          facade: 'runtime_acp_http',
          phase: 'phase_4',
          supportedMethods: [
            'initialize',
            'ping',
            'session/new',
            'session/list',
            'session/load',
            'session/cancel',
          ],
        },
      },
    });
  });

  it('surfaces bootstrap mode truthfully before ACP session methods are enabled', async () => {
    const { app, rootDir } = makeApp({ bootstrapRequired: true });
    cleanupRoots.push(rootDir);

    const initializeResponse = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'initialize',
        method: 'initialize',
      }),
    });

    expect(initializeResponse.status).toBe(200);
    await expect(initializeResponse.json()).resolves.toEqual(expect.objectContaining({
      jsonrpc: '2.0',
      id: 'initialize',
      result: expect.objectContaining({
        _meta: {
          catsRuntime: expect.objectContaining({
            bootstrapRequired: true,
            readinessPath: '/health',
          }),
        },
      }),
    }));

    const sessionResponse = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'bootstrap-session',
        method: 'session/new',
      }),
    });

    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'bootstrap-session',
      error: {
        code: -32001,
        message: 'Runtime bootstrap is still required before ACP session methods can be used.',
        data: {
          reason: 'runtime_bootstrap_required',
          readinessPath: '/health',
        },
      },
    });
  });
});
