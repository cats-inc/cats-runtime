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
import type { StreamEvent, TurnInput } from '../core/types.js';
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

function parseNdjsonBody(value: string): unknown[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function makeApp(
  options: {
    bootstrapRequired?: boolean;
    worker?: {
      alive?: boolean;
      busy?: boolean;
      on?: ReturnType<typeof vi.fn>;
      off?: ReturnType<typeof vi.fn>;
      streamMessage(turnInput: string | TurnInput): AsyncGenerator<StreamEvent>;
    };
    peerRouting?: {
      decide: ReturnType<typeof vi.fn>;
    };
    peerExecutionClient?: {
      buildRequest: ReturnType<typeof vi.fn>;
      streamExecution(
        peer: unknown,
        request: unknown,
        trace: unknown,
        signal: AbortSignal,
      ): AsyncGenerator<StreamEvent>;
    };
  } = {},
) {
  const rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-acp-routes-'));
  const sessionBaseDir = join(rootDir, 'sessions');
  const dataDir = join(rootDir, 'data');
  mkdirSync(sessionBaseDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const pool = {
    getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
    get: vi.fn(() => options.worker),
    spawn: vi.fn(),
    kill: vi.fn(),
    cancel: vi.fn(),
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
    peerRouting: options.peerRouting as never,
    peerExecutionClient: options.peerExecutionClient as never,
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
            sessionLifecycle: 'prompt_enabled_over_http_ndjson',
            promptStreaming: {
              accept: 'application/x-ndjson',
              notifications: ['session/update'],
            },
            routingSupport: {
              requestedVia: '_meta.catsRuntime.routing',
              supportedModes: ['local', 'peer'],
              shareWorkspaceFlag: 'shareWorkspace',
              requiresRuntimeSessionOrigin: true,
              peerModePolicyGate: true,
              peerModeAvailable: false,
            },
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
              origin: 'runtime',
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
                  origin: 'runtime',
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

  it('requires NDJSON negotiation for ACP HTTP prompt turns', async () => {
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
        code: -32600,
        message: "ACP HTTP prompt turns require 'Accept: application/x-ndjson'.",
        data: {
          facade: 'runtime_acp_http',
          phase: 'phase_4',
          reason: 'prompt_turn_requires_ndjson_accept',
          currentTransport: 'http',
          requiredAccept: 'application/x-ndjson',
          requiredNotifications: ['session/update'],
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
      },
    });
  });

  it('streams prompt-turn updates over ACP HTTP NDJSON carrier', async () => {
    const worker = {
      alive: true,
      busy: false,
      on: vi.fn(),
      off: vi.fn(),
      async *streamMessage(turnInput: string | TurnInput): AsyncGenerator<StreamEvent> {
        const resolvedInput = typeof turnInput === 'string' ? { message: turnInput } : turnInput;
        expect(resolvedInput.message).toBe('Summarize the workspace.');
        yield { type: 'text', text: 'Inspecting workspace. ' };
        yield {
          type: 'tool_use',
          toolId: 'shell-1',
          toolName: 'run_shell',
          toolArgs: { command: 'pwd' },
        };
        yield {
          type: 'tool_result',
          toolId: 'shell-1',
          toolName: 'run_shell',
          text: '/tmp/workspace',
        };
        yield { type: 'result', text: 'Workspace summarized.' };
      },
    };
    const { app, rootDir, registry } = makeApp({ worker });
    cleanupRoots.push(rootDir);

    const cwd = join(rootDir, 'workspace-prompt');
    mkdirSync(cwd, { recursive: true });
    const session = registry.create({
      id: 'runtime-session-prompt',
      providerName: 'claude',
      cwd,
    });
    registry.updateStatus(session.id, 'ready');

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'prompt-http',
        method: 'session/prompt',
        params: {
          sessionId: session.id,
          prompt: [{
            type: 'text',
            text: 'Summarize the workspace.',
          }],
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const body = await response.text();
    expect(parseNdjsonBody(body)).toEqual([
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: session.id,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'Inspecting workspace. ',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: session.id,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'shell-1',
            title: 'run_shell',
            kind: 'run_shell',
            status: 'pending',
            rawInput: {
              command: 'pwd',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: session.id,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'shell-1',
            status: 'completed',
            content: [{
              type: 'content',
              content: {
                type: 'text',
                text: '/tmp/workspace',
              },
            }],
          },
        },
      },
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: session.id,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'Workspace summarized.',
            },
          },
        },
      },
      {
        jsonrpc: '2.0',
        id: 'prompt-http',
        result: {
          stopReason: 'end_turn',
          _meta: {
            catsRuntime: {
              source: 'runtime_http_bridge',
              transport: 'http',
              turnStream: 'application/x-ndjson',
            },
          },
        },
      },
    ]);
  });

  it('passes ACP prompt routing hints through to peer execution and surfaces the effective route in the result meta', async () => {
    const peerRouting = {
      decide: vi.fn(() => ({
        mode: 'peer',
        reason: "Routing to peer 'lab-peer' by explicit selection.",
        localFallback: false,
        strategy: 'explicit',
        target: {
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          model: undefined,
        },
        peer: {
          identity: {
            peerId: 'lab-peer',
          },
        },
      })),
    };
    const peerExecutionClient = {
      buildRequest: vi.fn(() => ({
        request: { route: 'peer' },
        trace: {
          requestId: 'peer-trace-1',
          callerPeerId: 'local-peer',
          callerSessionId: 'runtime-session-peer',
          callerRunId: 'run-peer-1',
          peerId: 'lab-peer',
          routedAt: '2026-04-20T03:00:00.000Z',
          transport: 'ndjson',
          strategy: 'explicit',
          workspaceMode: 'read_only',
        },
      })),
      async *streamExecution(
        peer: unknown,
        request: unknown,
        trace: unknown,
        signal: AbortSignal,
      ): AsyncGenerator<StreamEvent> {
        void signal;
        expect((peer as { identity: { peerId: string } }).identity.peerId).toBe('lab-peer');
        expect(request).toEqual({ route: 'peer' });
        expect(trace).toEqual(expect.objectContaining({
          peerId: 'lab-peer',
          strategy: 'explicit',
          workspaceMode: 'read_only',
        }));
        yield {
          type: 'text',
          text: 'Peer handled the turn.',
          metadata: {
            peerRouting: {
              mode: 'peer',
              peerId: 'lab-peer',
              strategy: 'explicit',
              transport: 'ndjson',
              workspaceMode: 'read_only',
              routedAt: '2026-04-20T03:00:00.000Z',
            },
          },
        };
        yield {
          type: 'result',
          text: 'Peer turn complete.',
          metadata: {
            peerRouting: {
              mode: 'peer',
              peerId: 'lab-peer',
              strategy: 'explicit',
              transport: 'ndjson',
              workspaceMode: 'read_only',
              routedAt: '2026-04-20T03:00:00.000Z',
            },
          },
        };
      },
    };
    const { app, rootDir, registry } = makeApp({
      peerRouting,
      peerExecutionClient,
    });
    cleanupRoots.push(rootDir);

    const cwd = join(rootDir, 'workspace-peer');
    mkdirSync(cwd, { recursive: true });
    const session = registry.create({
      id: 'runtime-session-peer',
      providerName: 'claude',
      cwd,
    });
    registry.updateStatus(session.id, 'ready');

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'prompt-peer',
        method: 'session/prompt',
        params: {
          sessionId: session.id,
          prompt: [{
            type: 'text',
            text: 'Route this through a peer.',
          }],
          _meta: {
            catsRuntime: {
              routing: {
                mode: 'peer',
                peerId: 'lab-peer',
                shareWorkspace: true,
              },
            },
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = parseNdjsonBody(await response.text());
    expect(body.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 'prompt-peer',
      result: {
        stopReason: 'end_turn',
        _meta: {
          catsRuntime: {
            source: 'runtime_http_bridge',
            transport: 'http',
            turnStream: 'application/x-ndjson',
            routing: {
              requested: {
                mode: 'peer',
                peerId: 'lab-peer',
                strategy: 'explicit',
                shareWorkspace: true,
              },
              effective: {
                mode: 'peer',
                peerId: 'lab-peer',
                strategy: 'explicit',
                transport: 'ndjson',
                workspaceMode: 'read_only',
                routedAt: '2026-04-20T03:00:00.000Z',
              },
            },
          },
        },
      },
    });
    expect(peerRouting.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        id: session.id,
        origin: 'runtime',
      }),
      {
        mode: 'peer',
        peerId: 'lab-peer',
        strategy: 'explicit',
        shareWorkspace: true,
      },
    );
    expect(peerExecutionClient.buildRequest).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        id: session.id,
      }),
      routing: {
        mode: 'peer',
        peerId: 'lab-peer',
        strategy: 'explicit',
        shareWorkspace: true,
      },
    }));
  });

  it('rejects invalid ACP prompt routing metadata', async () => {
    const { app, rootDir, registry } = makeApp();
    cleanupRoots.push(rootDir);

    const cwd = join(rootDir, 'workspace-invalid-routing');
    mkdirSync(cwd, { recursive: true });
    const session = registry.create({
      id: 'runtime-session-invalid-routing',
      providerName: 'claude',
      cwd,
    });
    registry.updateStatus(session.id, 'ready');

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'prompt-invalid-routing',
        method: 'session/prompt',
        params: {
          sessionId: session.id,
          prompt: [{
            type: 'text',
            text: 'hello',
          }],
          _meta: {
            catsRuntime: {
              routing: 'peer',
            },
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'prompt-invalid-routing',
      error: {
        code: -32602,
        message: 'routing must be an object when provided.',
        data: {
          reason: 'invalid_cats_runtime_routing',
        },
      },
    });
  });

  it('surfaces shared peer-routing failure codes on ACP prompt errors', async () => {
    const { app, rootDir, registry } = makeApp();
    cleanupRoots.push(rootDir);

    const cwd = join(rootDir, 'workspace-peer-disabled');
    mkdirSync(cwd, { recursive: true });
    const session = registry.create({
      id: 'runtime-session-peer-disabled',
      providerName: 'claude',
      cwd,
    });
    registry.updateStatus(session.id, 'ready');

    const response = await app.request('/acp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'prompt-peer-disabled',
        method: 'session/prompt',
        params: {
          sessionId: session.id,
          prompt: [{
            type: 'text',
            text: 'Try peer routing.',
          }],
          _meta: {
            catsRuntime: {
              routing: {
                mode: 'peer',
                peerId: 'lab-peer',
              },
            },
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 'prompt-peer-disabled',
      error: {
        code: -32603,
        message: 'Peer routing service is not initialized.',
        data: {
          route: '/sessions/runtime-session-peer-disabled/messages',
          httpStatus: 503,
          code: 'peer_route_disabled',
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
