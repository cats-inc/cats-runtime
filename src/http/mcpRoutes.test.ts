import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import { createRuntimeApp } from './app.js';
import { createRuntimeStartupState } from '../startup.js';
import type { StreamEvent, TurnInput } from '../core/types.js';

describe('runtime MCP facade', () => {
  let rootDir: string;
  let sessionBaseDir: string;
  let dataDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;
  let workers: Map<string, {
    alive: boolean;
    busy: boolean;
    streamMessage: (turn: string | TurnInput) => AsyncGenerator<StreamEvent>;
  }>;

  function makeConfig(): CliRuntimeConfig {
    return {
      host: '127.0.0.1',
      port: 3110,
      apiKey: '',
      dataDir,
      sessionBaseDir,
      claudePath: 'claude',
      providerCommands: {
        claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
      },
      providerDefaultInstances: {
        claude: 'default',
      },
      providerInstances: {
        claude: {
          default: {
            id: 'default',
            providerName: 'claude',
            commandConfig: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
          },
        },
      },
      externalSessionLiveWindowMs: 0,
      maxSessions: 10,
    } as unknown as CliRuntimeConfig;
  }

  function createTestApp() {
    const workerStream = async function* (turn: string | TurnInput): AsyncGenerator<StreamEvent> {
      const input = typeof turn === 'string' ? turn : turn.message;
      yield { type: 'text', text: `reply: ${input}` };
      yield { type: 'result', summary: `completed: ${input}` };
    };

    workers.set('session-1', {
      alive: true,
      busy: false,
      streamMessage: workerStream,
    });

    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn((sessionId: string) => workers.get(sessionId)),
      spawn: vi.fn((sessionId: string) => {
        const worker = {
          alive: true,
          busy: false,
          streamMessage: workerStream,
        };
        workers.set(sessionId, worker);
        return worker;
      }),
      kill: vi.fn((sessionId: string) => {
        workers.delete(sessionId);
      }),
      killAll: vi.fn(() => {
        workers.clear();
      }),
      status: vi.fn(() => ({ active: workers.size, busy: 0, idle: workers.size, providers: { claude: workers.size } })),
    } as unknown as WorkerPool;

    return createRuntimeApp({
      config: makeConfig(),
      startup: createRuntimeStartupState(),
      registry,
      pool,
      cursorNative: {} as never,
      gooseNative: {} as never,
      kiroNative: {} as never,
      auggieSessions: {} as never,
      opencodeNative: {} as never,
      providerModelCatalog: {} as never,
    });
  }

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-mcp-'));
    sessionBaseDir = join(rootDir, 'sessions');
    dataDir = join(rootDir, 'data');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    registry = new SessionRegistry();
    registry.create({
      id: 'session-1',
      providerName: 'claude',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'workspace'),
      workspaceMode: 'shared',
      permissionMode: 'skip',
    });
    registry.updateStatus('session-1', 'ready');
    workers = new Map();
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('implements initialize and tools/list over POST /mcp', async () => {
    const app = createTestApp();

    const initializeResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      }),
    });
    expect(initializeResponse.status).toBe(200);
    await expect(initializeResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'cats-runtime-mcp',
          version: expect.any(String),
        },
        capabilities: {
          tools: {},
        },
      },
    });

    const listResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as {
      result: {
        tools: Array<{ name: string }>;
      };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual([
      'runtime_summary',
      'list_sessions',
      'observe_session',
      'create_session',
      'send_message',
      'fork_session',
      'audit_workspace',
      'init_workspace',
      'audit_delivery_target',
      'commit_changes',
    ]);
  });

  it('returns runtime and session inspection data through tools/call', async () => {
    const app = createTestApp();

    const runtimeSummaryResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'runtime_summary',
          arguments: {},
        },
      }),
    });
    expect(runtimeSummaryResponse.status).toBe(200);
    const runtimeSummary = await runtimeSummaryResponse.json() as {
      result: {
        structuredContent: {
          sessions: { total: number };
          diagnostics: { mcpPath: string };
        };
      };
    };
    expect(runtimeSummary.result.structuredContent.sessions.total).toBe(1);
    expect(runtimeSummary.result.structuredContent.diagnostics.mcpPath).toBe('/mcp');

    const observeResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'observe_session',
          arguments: {
            sessionId: 'session-1',
          },
        },
      }),
    });
    expect(observeResponse.status).toBe(200);
    const observe = await observeResponse.json() as {
      result: {
        structuredContent: {
          session: {
            id: string;
            inspection: {
              state: string;
            };
          };
          observePath: string;
        };
      };
    };
    expect(observe.result.structuredContent.session.id).toBe('session-1');
    expect(observe.result.structuredContent.session.inspection.state).toBe('idle');
    expect(observe.result.structuredContent.observePath).toBe('/sessions/session-1/observe');
  });

  it('exposes workspace and delivery audit tools without making MCP the only runtime API', async () => {
    const app = createTestApp();
    const workspacePath = join(rootDir, 'workspace');
    mkdirSync(workspacePath, { recursive: true });

    const workspaceAuditResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'audit_workspace',
          arguments: {
            workspacePath,
          },
        },
      }),
    });
    expect(workspaceAuditResponse.status).toBe(200);
    const workspaceAudit = await workspaceAuditResponse.json() as {
      result: {
        structuredContent: {
          operation: string;
          contract: { mode: string };
        };
      };
    };
    expect(workspaceAudit.result.structuredContent.operation).toBe('audit-workspace');
    expect(workspaceAudit.result.structuredContent.contract.mode).toBe('preview');

    const deliveryAuditResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'audit_delivery_target',
          arguments: {
            workspacePath,
            includeSessionArtifacts: true,
          },
        },
      }),
    });
    expect(deliveryAuditResponse.status).toBe(200);
    const deliveryAudit = await deliveryAuditResponse.json() as {
      result: {
        structuredContent: {
          action: string;
          contract: { mode: string };
        };
      };
    };
    expect(deliveryAudit.result.structuredContent.action).toBe('audit-delivery-target');
    expect(deliveryAudit.result.structuredContent.contract.mode).toBe('preview');
  });

  it('exposes mutation tools aligned with existing session, workspace, and delivery contracts', async () => {
    const app = createTestApp();
    const workspacePath = join(rootDir, 'workspace');
    mkdirSync(workspacePath, { recursive: true });

    const createResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'create_session',
          arguments: {
            provider: 'claude',
            cwd: workspacePath,
          },
        },
      }),
    });
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          session: { id: string; providerName: string };
          messagePath: string;
        };
      };
    };
    expect(created.result.structuredContent.responseStatus).toBe(201);
    expect(created.result.structuredContent.session.providerName).toBe('claude');
    expect(created.result.structuredContent.messagePath).toBe(
      `/sessions/${created.result.structuredContent.session.id}/messages`,
    );

    const createdSessionId = created.result.structuredContent.session.id;
    const sendResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'send_message',
          arguments: {
            sessionId: createdSessionId,
            message: 'hello from mcp',
          },
        },
      }),
    });
    expect(sendResponse.status).toBe(200);
    const sent = await sendResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          sessionId: string;
          events: Array<{ type: string; text?: string; summary?: string }>;
        };
      };
    };
    expect(sent.result.structuredContent.responseStatus).toBe(200);
    expect(sent.result.structuredContent.sessionId).toBe(createdSessionId);
    expect(sent.result.structuredContent.events).toEqual([
      { type: 'text', text: 'reply: hello from mcp' },
      { type: 'result', summary: 'completed: hello from mcp' },
    ]);

    const forkResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'fork_session',
          arguments: {
            sessionId: createdSessionId,
            mode: 'context_transplant',
          },
        },
      }),
    });
    expect(forkResponse.status).toBe(200);
    const forked = await forkResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          session: { id: string };
        };
      };
    };
    expect(forked.result.structuredContent.responseStatus).toBe(201);
    expect(forked.result.structuredContent.session.id).not.toBe(createdSessionId);

    const initWorkspaceResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'init_workspace',
          arguments: {
            workspacePath,
          },
        },
      }),
    });
    expect(initWorkspaceResponse.status).toBe(200);
    const initWorkspace = await initWorkspaceResponse.json() as {
      result: {
        structuredContent: {
          operation: string;
        };
      };
    };
    expect(initWorkspace.result.structuredContent.operation).toBe('init-workspace');

    const commitResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'commit_changes',
          arguments: {
            workspacePath,
            repo: {
              message: 'feat: mcp test',
            },
          },
        },
      }),
    });
    expect(commitResponse.status).toBe(200);
    const commit = await commitResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
        };
      };
    };
    expect(commit.result.structuredContent.responseStatus).toBe(200);
    expect(commit.result.structuredContent.action).toBe('create-commit');
  });

  it('rejects invalid list_sessions status filters with a machine-readable params error', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'list_sessions',
          arguments: {
            status: 'sleeping',
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 12,
      error: {
        code: -32602,
        message: 'status must be a valid session status',
      },
    });
  });

  it('rejects invalid audit_workspace enum values before reaching the substrate service', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'audit_workspace',
          arguments: {
            workspacePath: join(rootDir, 'workspace'),
            profile: 'banana',
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 13,
      error: {
        code: -32602,
        message: 'profile must be a valid workspace substrate profile',
      },
    });
  });
});
