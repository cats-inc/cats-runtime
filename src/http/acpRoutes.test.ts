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

  const app = createApp({
    config: makeConfig(sessionBaseDir, dataDir),
    startup: createRuntimeStartupState({
      ready: true,
      bootstrapRequired: options.bootstrapRequired ?? false,
    }),
    registry: new SessionRegistry(),
    pool,
    cursorNative: {} as CursorNativeSessionService,
    gooseNative: {} as GooseNativeSessionService,
    kiroNative: {} as KiroNativeSessionService,
    auggieSessions: {} as AuggieSessionService,
    opencodeNative: {} as OpencodeNativeSessionService,
  });

  return { app, rootDir };
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
          loadSession: false,
          promptCapabilities: {
            audio: false,
            embeddedContext: false,
            image: false,
          },
          mcpCapabilities: {
            http: false,
            sse: false,
          },
          sessionCapabilities: {},
        },
        _meta: {
          catsRuntime: {
            transport: 'http',
            path: '/acp',
            bootstrapRequired: false,
            readinessPath: '/health',
            sessionLifecycle: 'pending',
            supportedMethods: ['initialize', 'ping'],
          },
        },
      },
    });
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

  it('returns a truthful not-yet-enabled error for ACP session methods', async () => {
    const { app, rootDir } = makeApp();
    cleanupRoots.push(rootDir);

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'session-new',
        method: 'session/new',
        params: {
          cwd: '/tmp/repo',
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'session-new',
      error: {
        code: -32601,
        message: "ACP method 'session/new' is not yet enabled by the cats-runtime ACP facade.",
        data: {
          facade: 'runtime_acp_http',
          phase: 'phase_4',
          supportedMethods: ['initialize', 'ping'],
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
