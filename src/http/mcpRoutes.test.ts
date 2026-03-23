import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import { createRuntimeApp } from './app.js';
import { createRuntimeStartupState } from '../startup.js';

describe('runtime MCP facade', () => {
  let rootDir: string;
  let sessionBaseDir: string;
  let dataDir: string;
  let registry: SessionRegistry;
  let pool: WorkerPool;

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

    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => undefined),
      spawn: vi.fn(),
      kill: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: { claude: 1 } })),
    } as unknown as WorkerPool;
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
      'audit_workspace',
      'audit_delivery_target',
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
    expect(observe.result.structuredContent.session.inspection.state).toBe('closed');
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
});
