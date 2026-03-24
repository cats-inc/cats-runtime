import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
        opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
        pi: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } },
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

  function runGit(cwd: string, args: string[]): string {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
    }

    return result.stdout.trim();
  }

  function createGitWorkspace(repoName: string): string {
    const repoDir = join(rootDir, repoName);
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'tracked.txt'), 'initial\n', 'utf8');

    runGit(repoDir, ['init']);
    runGit(repoDir, ['config', 'user.email', 'cats-runtime@example.test']);
    runGit(repoDir, ['config', 'user.name', 'Cats Runtime Test']);
    runGit(repoDir, ['add', '.']);
    runGit(repoDir, ['commit', '-m', 'initial']);

    return repoDir;
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
      'provider_diagnostics',
      'observe_session',
      'list_runtime_skills',
      'create_session',
      'send_message',
      'close_session',
      'reset_session',
      'fork_session',
      'delete_session',
      'cleanup_session_workspace',
      'compact_session',
      'report_session_maintenance_follow_through',
      'report_compaction_follow_through',
      'list_browser_drivers',
      'list_browser_sessions',
      'browser_summary',
      'create_browser_session',
      'create_browser_page',
      'close_browser_session',
      'cleanup_browser_sessions',
      'audit_workspace',
      'init_workspace',
      'audit_delivery_target',
      'commit_changes',
    ]);

    const createSessionTool = listed.result.tools.find((tool) => tool.name === 'create_session') as {
      inputSchema?: { properties?: Record<string, { enum?: string[] }> };
    } | undefined;
    expect(createSessionTool?.inputSchema?.properties?.workspaceIsolation?.enum).toEqual([
      'shared',
      'isolated',
      'worktree',
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

    const providerDiagnosticsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 30,
        method: 'tools/call',
        params: {
          name: 'provider_diagnostics',
          arguments: {
            probe: 'live',
            provider: 'claude',
            backend: 'cli',
            instance: 'default',
            defaultOnly: true,
            forceRefresh: true,
          },
        },
      }),
    });
    expect(providerDiagnosticsResponse.status).toBe(200);
    const providerDiagnostics = await providerDiagnosticsResponse.json() as {
      result: {
        structuredContent: {
          probe: string;
          providersPath: string;
          query: {
            hasFilters: boolean;
            filters: Record<string, string | boolean>;
          };
          summary: { targets: number };
          providers: Array<{
            provider: string;
            backend: string;
            instance: string;
            defaultTarget: boolean;
          }>;
        };
      };
    };
    expect(providerDiagnostics.result.structuredContent.probe).toBe('live');
    expect(providerDiagnostics.result.structuredContent.query).toEqual({
      hasFilters: true,
      filters: {
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        defaultOnly: true,
      },
    });
    expect(providerDiagnostics.result.structuredContent.providersPath).toBe(
      '/diagnostics/providers?probe=live&provider=claude&backend=cli&instance=default&defaultOnly=true&force=1',
    );
    expect(providerDiagnostics.result.structuredContent.summary.targets).toBe(1);
    expect(providerDiagnostics.result.structuredContent.providers).toEqual([
      expect.objectContaining({
        provider: 'claude',
        backend: 'cli',
        instance: 'default',
        defaultTarget: true,
      }),
    ]);

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

  it('exposes the runtime skill catalog through MCP with the same lightweight filters as HTTP', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            family: ['chat'],
            slug: ['companion'],
            role: ['companion_core'],
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      result: {
        structuredContent: {
          contract: {
            version: number;
          };
          query: {
            hasFilters: boolean;
            filters: Record<string, string[]>;
          };
          count: number;
          catalogPath: string;
          skills: Array<{
            id: string;
            library: {
              family: string;
              slug: string;
              role: string;
            };
          }>;
        };
      };
    };
    expect(payload.result.structuredContent.contract.version).toBe(1);
    expect(payload.result.structuredContent.query).toEqual({
      hasFilters: true,
      filters: {
        family: ['chat'],
        slug: ['companion'],
        role: ['companion_core'],
      },
    });
    expect(payload.result.structuredContent.count).toBe(1);
    expect(payload.result.structuredContent.catalogPath).toBe(
      '/skills/catalog?family=chat&slug=companion&role=companion_core',
    );
    expect(payload.result.structuredContent.skills).toEqual([
      expect.objectContaining({
        id: 'companion',
        library: expect.objectContaining({
          family: 'chat',
          slug: 'companion',
          role: 'companion_core',
        }),
      }),
    ]);
  });

  it('rejects invalid runtime skill catalog filters through MCP with params errors', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            family: ['invalid'],
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 6,
      error: {
        code: -32602,
        message: 'family must be a valid runtime skill family',
      },
    });
  });

  it('passes runtime skill catalog pagination arguments through MCP', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            limit: 1,
            offset: 0,
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      result: {
        structuredContent: {
          count: number;
          catalogPath: string;
          pagination: {
            offset: number;
            limit: number | null;
            returned: number;
            hasMore: boolean;
          };
          skills: Array<{ id: string }>;
        };
      };
    };
    expect(payload.result.structuredContent.catalogPath).toBe('/skills/catalog?offset=0&limit=1');
    expect(payload.result.structuredContent.pagination).toEqual({
      offset: 0,
      limit: 1,
      returned: 1,
      hasMore: true,
    });
    expect(payload.result.structuredContent.skills).toHaveLength(1);
    expect(payload.result.structuredContent.count).toBeGreaterThan(
      payload.result.structuredContent.skills.length,
    );
  });

  it('passes runtime skill catalog sorting arguments through MCP', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 22,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            sortBy: 'id',
            sortDirection: 'desc',
            limit: 3,
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      result: {
        structuredContent: {
          catalogPath: string;
          query: {
            sort?: {
              by: string;
              direction: string;
            };
          };
          skills: Array<{ id: string }>;
        };
      };
    };
    expect(payload.result.structuredContent.catalogPath).toBe(
      '/skills/catalog?sortBy=id&sortDirection=desc&limit=3',
    );
    expect(payload.result.structuredContent.query.sort).toEqual({
      by: 'id',
      direction: 'desc',
    });
    expect(payload.result.structuredContent.skills.map((skill) => skill.id)).toEqual(
      [...payload.result.structuredContent.skills.map((skill) => skill.id)]
        .sort((left, right) => right.localeCompare(left)),
    );
  });

  it('rejects runtime skill sort directions without a sort field through MCP', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 23,
        method: 'tools/call',
        params: {
          name: 'list_runtime_skills',
          arguments: {
            sortDirection: 'desc',
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 23,
      error: {
        code: -32602,
        message: 'sortDirection requires sortBy',
      },
    });
  });

  it('exposes runtime-owned browser summary and cleanup through MCP', async () => {
    const app = createTestApp();

    const createdResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        label: 'MCP Browser Session',
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as {
      session: { id: string };
    };
    await app.request(`/browser/sessions/${created.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:4173',
        binding: {
          kind: 'manual_url',
        },
      }),
    });
    await app.request(`/browser/sessions/${created.session.id}/close`, {
      method: 'POST',
    });

    const summaryResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'browser_summary',
          arguments: {
            olderThanMs: 0,
          },
        },
      }),
    });
    expect(summaryResponse.status).toBe(200);
    const summaryPayload = await summaryResponse.json() as {
      result: {
        structuredContent: {
          summaryPath: string;
          sessions: { closed: number };
          cleanupCandidates: { sessionIds: string[] };
        };
      };
    };
    expect(summaryPayload.result.structuredContent.summaryPath).toBe(
      '/browser/summary?olderThanMs=0',
    );
    expect(summaryPayload.result.structuredContent.sessions.closed).toBe(1);
    expect(summaryPayload.result.structuredContent.cleanupCandidates.sessionIds).toEqual([
      created.session.id,
    ]);

    const cleanupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'cleanup_browser_sessions',
          arguments: {
            olderThanMs: 0,
          },
        },
      }),
    });
    expect(cleanupResponse.status).toBe(200);
    await expect(cleanupResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: {
        content: [
          {
            type: 'text',
            text: 'Removed 1 browser session(s) during cleanup.',
          },
        ],
        structuredContent: {
          action: 'cleanup_browser_sessions',
          cleanupPath: '/browser/sessions/cleanup',
          filters: {
            olderThanMs: 0,
            status: 'closed',
          },
          matchedSessionCount: 1,
          matchedPageCount: 1,
          removedSessionCount: 1,
          removedPageCount: 1,
          removedSessionIds: [created.session.id],
          remainingSessionCount: 0,
          remainingClosedSessionCount: 0,
        },
      },
    });
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
        id: 8,
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
        id: 9,
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
        id: 10,
        method: 'tools/call',
        params: {
          name: 'create_session',
          arguments: {
            provider: 'claude',
            cwd: workspacePath,
            workspaceIsolation: 'shared',
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
    expect(created.result.structuredContent.session.workspaceIsolation).toEqual(
      expect.objectContaining({
        mode: 'shared',
      }),
    );
    expect(created.result.structuredContent.messagePath).toBe(
      `/sessions/${created.result.structuredContent.session.id}/messages`,
    );

    const createdSessionId = created.result.structuredContent.session.id;
    const sendResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
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
        id: 12,
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

    const closeResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'close_session',
          arguments: {
            sessionId: createdSessionId,
            maintenance: {
              reason: 'prepare_for_reset',
            },
          },
        },
      }),
    });
    expect(closeResponse.status).toBe(200);
    const closed = await closeResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          closePath: string;
          status: string;
        };
      };
    };
    expect(closed.result.structuredContent.responseStatus).toBe(200);
    expect(closed.result.structuredContent.action).toBe('close');
    expect(closed.result.structuredContent.closePath).toBe(
      `/sessions/${createdSessionId}/close`,
    );
    expect(closed.result.structuredContent.status).toBe('closed');

    const repoDir = createGitWorkspace('workspace-cleanup-retry');
    const createWorktreeResponse = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'claude',
        cwd: repoDir,
        workspaceIsolation: 'worktree',
      }),
    });
    expect(createWorktreeResponse.status).toBe(201);
    const createdWorktree = await createWorktreeResponse.json() as {
      id: string;
      cwd: string;
    };
    writeFileSync(join(createdWorktree.cwd, 'tracked.txt'), 'retain for mcp cleanup\n', 'utf8');

    const resetResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'reset_session',
          arguments: {
            sessionId: createdWorktree.id,
            worktreeCleanupPolicy: 'preserve',
          },
        },
      }),
    });
    expect(resetResponse.status).toBe(200);
    const reset = await resetResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          resetPath: string;
          retryCleanupPath?: string;
          session: {
            cwd: string;
          };
        };
      };
    };
    expect(reset.result.structuredContent.responseStatus).toBe(200);
    expect(reset.result.structuredContent.action).toBe('reset');
    expect(reset.result.structuredContent.status).toBe('retained');
    expect(reset.result.structuredContent.resetPath).toBe(
      `/sessions/${createdWorktree.id}/reset`,
    );
    expect(reset.result.structuredContent.retryCleanupPath).toBe(
      `/sessions/${createdWorktree.id}/workspace/cleanup`,
    );
    expect(reset.result.structuredContent.session.cwd).toBe(createdWorktree.cwd);

    const blockedCleanupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'cleanup_session_workspace',
          arguments: {
            sessionId: createdWorktree.id,
            requireAcknowledgedHooks: true,
            worktreeCleanupPolicy: 'discard',
            maintenance: {
              reason: 'operator_retry_cleanup',
            },
          },
        },
      }),
    });
    expect(blockedCleanupResponse.status).toBe(200);
    await expect(blockedCleanupResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 15,
      error: {
        code: -32000,
        message: "This session still has pending pre_flush hooks for action 'cleanup_workspace'.",
        data: expect.objectContaining({
          httpStatus: 409,
        }),
      },
    });

    const cleanupFollowThroughResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 16,
        method: 'tools/call',
        params: {
          name: 'report_session_maintenance_follow_through',
          arguments: {
            sessionId: createdWorktree.id,
            action: 'cleanup_workspace',
            phase: 'pre_flush',
            outcome: 'acknowledged',
            maintenance: {
              reason: 'memory_flush_completed',
            },
          },
        },
      }),
    });
    expect(cleanupFollowThroughResponse.status).toBe(200);
    await expect(cleanupFollowThroughResponse.json()).resolves.toEqual(expect.objectContaining({
      result: expect.objectContaining({
        structuredContent: expect.objectContaining({
          action: 'cleanup_workspace',
          phase: 'pre_flush',
          outcome: 'acknowledged',
        }),
      }),
    }));

    const cleanupResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 17,
        method: 'tools/call',
        params: {
          name: 'cleanup_session_workspace',
          arguments: {
            sessionId: createdWorktree.id,
            requireAcknowledgedHooks: true,
            worktreeCleanupPolicy: 'discard',
            maintenance: {
              reason: 'operator_retry_cleanup',
            },
          },
        },
      }),
    });
    expect(cleanupResponse.status).toBe(200);
    const cleaned = await cleanupResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          cleanupPath: string;
          cleanup: {
            workspaceCleaned: boolean;
            worktreeCleanupPolicy: string;
          };
          session: {
            cwd: string;
            hydration: {
              workspace: {
                runtimeCwd: string;
              };
            };
          };
        };
      };
    };
    expect(cleaned.result.structuredContent.responseStatus).toBe(200);
    expect(cleaned.result.structuredContent.action).toBe('cleanup_workspace');
    expect(cleaned.result.structuredContent.status).toBe('completed');
    expect(cleaned.result.structuredContent.cleanupPath).toBe(
      `/sessions/${createdWorktree.id}/workspace/cleanup`,
    );
    expect(cleaned.result.structuredContent.cleanup).toEqual(expect.objectContaining({
      workspaceCleaned: true,
      worktreeCleanupPolicy: 'discard',
    }));
    expect(cleaned.result.structuredContent.session.cwd).toBe(repoDir);
    expect(cleaned.result.structuredContent.session.hydration.workspace.runtimeCwd).toBe(repoDir);

    const resetFollowThroughSession = registry.create({
      id: 'session-maintenance-mcp',
      providerName: 'claude',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'workspace-maintenance'),
      workspaceMode: 'shared',
      permissionMode: 'skip',
    });
    resetFollowThroughSession.messageCount = 4;
    resetFollowThroughSession.totalInputTokens = 400;
    resetFollowThroughSession.totalOutputTokens = 200;
    registry.updateStatus(resetFollowThroughSession.id, 'closed');

    const maintenanceFollowThroughResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 150,
        method: 'tools/call',
        params: {
          name: 'report_session_maintenance_follow_through',
          arguments: {
            sessionId: resetFollowThroughSession.id,
            action: 'reset',
            phase: 'pre_reset',
            outcome: 'acknowledged',
            maintenance: {
              reason: 'memory_flush_completed',
            },
          },
        },
      }),
    });
    expect(maintenanceFollowThroughResponse.status).toBe(200);
    const maintenanceFollowThrough = await maintenanceFollowThroughResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          phase: string;
          outcome: string;
          followThroughPath: string;
          maintenance: {
            lastFollowThrough: {
              action: string;
              phase: string;
              outcome: string;
              reason?: string;
            };
          };
        };
      };
    };
    expect(maintenanceFollowThrough.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'reset',
      phase: 'pre_reset',
      outcome: 'acknowledged',
      followThroughPath: `/sessions/${resetFollowThroughSession.id}/maintenance/follow-through`,
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          action: 'reset',
          phase: 'pre_reset',
          outcome: 'acknowledged',
          reason: 'memory_flush_completed',
        }),
      }),
    }));

    const deleteToolSession = registry.create({
      id: 'session-delete-mcp',
      providerName: 'claude',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'workspace-delete'),
      workspaceMode: 'shared',
      permissionMode: 'skip',
    });
    deleteToolSession.messageCount = 4;
    deleteToolSession.totalInputTokens = 400;
    deleteToolSession.totalOutputTokens = 200;
    registry.updateStatus(deleteToolSession.id, 'closed');

    const blockedDeleteResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 152,
        method: 'tools/call',
        params: {
          name: 'delete_session',
          arguments: {
            sessionId: deleteToolSession.id,
            requireAcknowledgedHooks: true,
            maintenance: {
              reason: 'owner_requested_delete',
            },
          },
        },
      }),
    });
    expect(blockedDeleteResponse.status).toBe(200);
    await expect(blockedDeleteResponse.json()).resolves.toEqual({
      jsonrpc: '2.0',
      id: 152,
      error: {
        code: -32000,
        message: "This session still has pending pre_flush hooks for action 'delete'.",
        data: expect.objectContaining({
          httpStatus: 409,
        }),
      },
    });
    expect(registry.get(deleteToolSession.id)).toBeTruthy();

    const deleteFollowThroughResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 153,
        method: 'tools/call',
        params: {
          name: 'report_session_maintenance_follow_through',
          arguments: {
            sessionId: deleteToolSession.id,
            action: 'delete',
            phase: 'pre_flush',
            outcome: 'acknowledged',
            maintenance: {
              reason: 'memory_flush_completed',
            },
          },
        },
      }),
    });
    expect(deleteFollowThroughResponse.status).toBe(200);

    const deleteResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 154,
        method: 'tools/call',
        params: {
          name: 'delete_session',
          arguments: {
            sessionId: deleteToolSession.id,
            requireAcknowledgedHooks: true,
          },
        },
      }),
    });
    expect(deleteResponse.status).toBe(200);
    const deleted = await deleteResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          deletePath: string;
          cleanup: {
            registryDropped: boolean;
          };
          maintenance: {
            action: string;
            status: string;
          };
        };
      };
    };
    expect(deleted.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'delete',
      status: 'deleted',
      deletePath: `/sessions/${deleteToolSession.id}`,
      cleanup: expect.objectContaining({
        registryDropped: true,
      }),
      maintenance: expect.objectContaining({
        action: 'delete',
        status: 'completed',
      }),
    }));
    expect(registry.get(deleteToolSession.id)).toBeUndefined();

    const compactionSession = registry.create({
      id: 'session-compact-mcp',
      providerName: 'claude',
      providerInstanceId: 'default',
      cwd: join(rootDir, 'workspace-compact'),
      workspaceMode: 'shared',
      permissionMode: 'skip',
    });
    compactionSession.messageCount = 40;
    compactionSession.totalInputTokens = 9_000;
    compactionSession.totalOutputTokens = 5_000;
    registry.updateStatus(compactionSession.id, 'closed');

    const compactResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 151,
        method: 'tools/call',
        params: {
          name: 'compact_session',
          arguments: {
            sessionId: compactionSession.id,
            maintenance: {
              reason: 'owner_requested_compaction',
            },
          },
        },
      }),
    });
    expect(compactResponse.status).toBe(200);
    const compacted = await compactResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          hookStatus: string;
          compactPath: string;
          runtimeCompactionExecuted: boolean;
          maintenance: {
            lastRequest: {
              action: string;
              reason?: string;
            };
          };
        };
      };
    };
    expect(compacted.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'compact',
      status: 'pending_hooks',
      hookStatus: 'pending',
      compactPath: `/sessions/${compactionSession.id}/compact`,
      runtimeCompactionExecuted: false,
      maintenance: expect.objectContaining({
        lastRequest: expect.objectContaining({
          action: 'compact',
          reason: 'owner_requested_compaction',
        }),
      }),
    }));

    const compactionFollowThroughResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 152,
        method: 'tools/call',
        params: {
          name: 'report_compaction_follow_through',
          arguments: {
            sessionId: compactionSession.id,
            outcome: 'acknowledged',
            maintenance: {
              reason: 'memory_flush_completed',
              hookPayloads: [{
                kind: 'memory_flush',
                payload: {
                  flushed: true,
                },
              }],
            },
          },
        },
      }),
    });
    expect(compactionFollowThroughResponse.status).toBe(200);
    const compactionFollowThrough = await compactionFollowThroughResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          outcome: string;
          status: string;
          hookStatus: string;
          followThroughPath: string;
          maintenance: {
            lastFollowThrough: {
              outcome: string;
              reason?: string;
            };
          };
        };
      };
    };
    expect(compactionFollowThrough.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'compact',
      outcome: 'acknowledged',
      status: 'ready_for_external_compaction',
      hookStatus: 'acknowledged',
      followThroughPath: `/sessions/${compactionSession.id}/compact/follow-through`,
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          outcome: 'acknowledged',
          reason: 'memory_flush_completed',
        }),
      }),
    }));

    const readyCompactionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 153,
        method: 'tools/call',
        params: {
          name: 'compact_session',
          arguments: {
            sessionId: compactionSession.id,
          },
        },
      }),
    });
    expect(readyCompactionResponse.status).toBe(200);
    const readyCompaction = await readyCompactionResponse.json() as {
      result: {
        structuredContent: {
          responseStatus: number;
          action: string;
          status: string;
          hookStatus: string;
          compactPath: string;
          maintenance: {
            lastFollowThrough: {
              outcome: string;
              reason?: string;
            };
          };
        };
      };
    };
    expect(readyCompaction.result.structuredContent).toEqual(expect.objectContaining({
      responseStatus: 200,
      action: 'compact',
      status: 'ready_for_external_compaction',
      hookStatus: 'acknowledged',
      compactPath: `/sessions/${compactionSession.id}/compact`,
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          outcome: 'acknowledged',
          reason: 'memory_flush_completed',
        }),
      }),
    }));

    const initWorkspaceResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 18,
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
        id: 17,
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

  it('exposes browser substrate tools over MCP without depending on a separate browser service', async () => {
    const app = createTestApp();

    const listDriversResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'list_browser_drivers',
          arguments: {},
        },
      }),
    });
    expect(listDriversResponse.status).toBe(200);
    const listedDrivers = await listDriversResponse.json() as {
      result: {
        structuredContent: {
          drivers: Array<{ id: string }>;
        };
      };
    };
    expect(listedDrivers.result.structuredContent.drivers).toEqual([
      expect.objectContaining({
        id: 'manual',
      }),
    ]);

    const createBrowserSessionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 16,
        method: 'tools/call',
        params: {
          name: 'create_browser_session',
          arguments: {
            runtimeSessionId: 'session-1',
            label: 'MCP Browser Session',
          },
        },
      }),
    });
    expect(createBrowserSessionResponse.status).toBe(200);
    const browserSessionResult = await createBrowserSessionResponse.json() as {
      result: {
        structuredContent: {
          session: { id: string; runtimeSessionId: string };
          createBrowserPagePath: string;
        };
      };
    };
    expect(browserSessionResult.result.structuredContent.session.runtimeSessionId).toBe('session-1');

    const browserSessionId = browserSessionResult.result.structuredContent.session.id;
    const createBrowserPageResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 17,
        method: 'tools/call',
        params: {
          name: 'create_browser_page',
          arguments: {
            browserSessionId,
            url: 'http://127.0.0.1:3000',
            label: 'MCP Preview',
          },
        },
      }),
    });
    expect(createBrowserPageResponse.status).toBe(200);
    const browserPageResult = await createBrowserPageResponse.json() as {
      result: {
        structuredContent: {
          page: { previewSurface: { kind: string; url?: string } };
        };
      };
    };
    expect(browserPageResult.result.structuredContent.page.previewSurface).toEqual(
      expect.objectContaining({
        kind: 'browser_page',
        url: 'http://127.0.0.1:3000',
      }),
    );

    const listBrowserSessionsResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 18,
        method: 'tools/call',
        params: {
          name: 'list_browser_sessions',
          arguments: {
            runtimeSessionId: 'session-1',
          },
        },
      }),
    });
    expect(listBrowserSessionsResponse.status).toBe(200);
    const listedSessions = await listBrowserSessionsResponse.json() as {
      result: {
        structuredContent: {
          sessions: Array<{ id: string; inspection: { openPageCount: number } }>;
        };
      };
    };
    expect(listedSessions.result.structuredContent.sessions).toEqual([
      expect.objectContaining({
        id: browserSessionId,
        inspection: expect.objectContaining({
          openPageCount: 1,
        }),
      }),
    ]);

    const closeBrowserSessionResponse = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 19,
        method: 'tools/call',
        params: {
          name: 'close_browser_session',
          arguments: {
            browserSessionId,
          },
        },
      }),
    });
    expect(closeBrowserSessionResponse.status).toBe(200);
    const closed = await closeBrowserSessionResponse.json() as {
      result: {
        structuredContent: {
          session: { status: string };
        };
      };
    };
    expect(closed.result.structuredContent.session.status).toBe('closed');
  });

  it('rejects invalid list_sessions status filters with a machine-readable params error', async () => {
    const app = createTestApp();

    const response = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20,
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
      id: 20,
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
        id: 21,
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
      id: 21,
      error: {
        code: -32602,
        message: 'profile must be a valid workspace substrate profile',
      },
    });
  });
});
