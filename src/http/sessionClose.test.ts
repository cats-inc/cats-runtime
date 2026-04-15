import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp, getRuntimeSessionManager, type AppContext } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import { RuntimeWakeupService } from '../core/wakeup/RuntimeWakeupService.js';

function parseSse(text: string): Array<Record<string, unknown>> {
  return text
    .split('\n\n')
    .map((frame) => frame
      .split('\n')
      .find((line) => line.startsWith('data: ')))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice(6)));
}

describe('session close route', () => {
  const makeConfig = (): CliRuntimeConfig => ({
    host: '127.0.0.1',
    port: 3100,
    apiKey: '',
    auggieMaxTurns: 10,
    auggiePath: 'auggie',
    claudePath: 'claude',
    codexPath: 'codex',
    copilotPath: 'copilot',
    cursorPath: 'cursor-agent',
    geminiPath: 'gemini',
    kiroPath: 'kiro-cli',
    opencodePath: 'opencode',
    opencodeServerHost: '127.0.0.1',
    opencodeServerPort: 4097,
    opencodeServerStartupTimeoutMs: 10000,
    auggieSessionsDir: '~/.augment/sessions',
    claudeProjectsDir: '',
    codexSessionsDir: '',
    copilotSessionsDir: '',
    cursorChatsDir: '~/.cursor/chats',
    cursorRuntime: {
      mode: 'wsl',
      distro: 'Ubuntu',
    },
    geminiSessionsDir: '',
    kiroDbPath: '~/AppData/Local/kiro-cli/data.sqlite3',
    kiroRuntime: {
      mode: 'native',
    },
    nativeDiscoveryIntervalMs: 5000,
    externalSessionLiveWindowMs: 15000,
    maxSessions: 10,
    sessionBaseDir,
    providerCommands: {
      auggie: { path: 'auggie', runner: 'auto', runtime: { mode: 'native' } },
      claude: { path: 'claude', runner: 'auto', runtime: { mode: 'native' } },
      codex: { path: 'codex', runner: 'auto', runtime: { mode: 'native' } },
      copilot: { path: 'copilot', runner: 'auto', runtime: { mode: 'native' } },
      cursor: { path: 'cursor-agent', runner: 'auto', runtime: { mode: 'wsl', distro: 'Ubuntu' } },
      gemini: { path: 'gemini', runner: 'auto', runtime: { mode: 'native' } },
      kiro: { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'native' } },
      opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
    },
  });

  let registry: SessionRegistry;
  let pool: WorkerPool;
  let cursorNative: CursorNativeSessionService;
  let kiroNative: KiroNativeSessionService;
  let auggieSessions: AuggieSessionService;
  let opencodeNative: OpencodeNativeSessionService;
  let app: ReturnType<typeof createApp>;
  let ctx: AppContext;
  let attachedWorkers: Map<string, { alive: boolean; busy?: boolean }>;
  let rootDir: string;
  let sessionBaseDir: string;
  let dataDir: string;
  let wakeup: RuntimeWakeupService;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-session-close-'));
    sessionBaseDir = join(rootDir, 'sessions');
    dataDir = join(rootDir, 'data');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    registry = new SessionRegistry();
    attachedWorkers = new Map();
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn((id: string) => attachedWorkers.get(id)),
      spawn: vi.fn(),
      cancel: vi.fn((id: string) => {
        const worker = attachedWorkers.get(id);
        if (worker) {
          worker.busy = false;
        }
      }),
      kill: vi.fn((id: string) => {
        attachedWorkers.delete(id);
      }),
      status: vi.fn(() => ({ active: attachedWorkers.size })),
    } as unknown as WorkerPool;
    wakeup = new RuntimeWakeupService({
      persistPath: join(dataDir, 'wakeups.json'),
      sessionExists: (sessionId) => registry.get(sessionId) !== undefined,
      wakeSession: vi.fn(async (sessionId: string) => ({
        sessionId,
        outcome: 'resumed' as const,
      })),
    });
    cursorNative = {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      listAllSessions: vi.fn(),
      loadHistory: vi.fn(),
      deleteSession: vi.fn(),
    } as unknown as CursorNativeSessionService;
    kiroNative = {
      listSessions: vi.fn(),
      listAllSessions: vi.fn(),
      loadHistory: vi.fn(),
      deleteSession: vi.fn(),
      canResumeSession: vi.fn(),
      getLatestSession: vi.fn(),
      getLatestSessionId: vi.fn(),
    } as unknown as KiroNativeSessionService;
    auggieSessions = {
      listSessions: vi.fn(),
      listAllSessions: vi.fn(),
      loadHistory: vi.fn(),
      getLatestSession: vi.fn(),
      getSession: vi.fn(),
    } as unknown as AuggieSessionService;
    opencodeNative = {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      listAllSessions: vi.fn(),
      getSession: vi.fn(),
      loadHistory: vi.fn(),
      prompt: vi.fn(),
      abortSession: vi.fn(),
      deleteSession: vi.fn(),
      listPendingPermissions: vi.fn(),
      replyPermission: vi.fn(),
      listPendingQuestions: vi.fn(),
      rejectQuestion: vi.fn(),
      close: vi.fn(),
    } as unknown as OpencodeNativeSessionService;

    ctx = {
      config: makeConfig(),
      registry,
      pool,
      cursorNative,
      kiroNative,
      auggieSessions,
      opencodeNative,
      wakeup,
    } as AppContext;
    app = createApp(ctx);
  });

  afterEach(() => {
    wakeup.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns closed when the worker is already gone', async () => {
    const session = registry.create({
      id: 'session-1',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    registry.updateStatus(session.id, 'ready');

    const res = await app.request(`/sessions/${session.id}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maintenance: {
          reason: 'owner_requested_close',
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              scope: 'summary',
            },
          }],
        },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      action: 'close',
      status: 'closed',
      inspection: expect.objectContaining({
        state: 'closed',
        maintenance: expect.objectContaining({
          lastRequest: expect.objectContaining({
            action: 'close',
            reason: 'owner_requested_close',
            hookPayloads: [
              expect.objectContaining({
                kind: 'memory_flush',
                payload: {
                  scope: 'summary',
                },
                payloadStatus: 'stored',
                payloadBytes: expect.any(Number),
              }),
            ],
          }),
        }),
      }),
    }));
    expect(registry.get(session.id)?.status).toBe('closed');
    expect(vi.mocked(pool.kill)).not.toHaveBeenCalled();
  });

  it('returns closing and kills an attached worker', async () => {
    const session = registry.create({
      id: 'session-2',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    registry.updateStatus(session.id, 'ready');
    attachedWorkers.set(session.id, { alive: true });
    const runtime = getRuntimeSessionManager(ctx);
    runtime.beginRun(session, { message: 'Finish the task.' });

    const res = await app.request(`/sessions/${session.id}/close`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      action: 'close',
      status: 'closed',
      attached: false,
      inspection: expect.objectContaining({
        state: 'closed',
        lastRun: expect.objectContaining({
          status: 'canceled',
          resultSummary: 'Session close terminated the current execution boundary.',
        }),
        maintenance: expect.objectContaining({
          lastLifecycle: expect.objectContaining({
            action: 'close',
            boundary: 'soft_close',
            status: 'completed',
            cleanup: expect.objectContaining({
              workerDetached: true,
            }),
          }),
        }),
      }),
    }));
    expect(registry.get(session.id)?.status).toBe('closed');
    expect(vi.mocked(pool.kill)).toHaveBeenCalledWith(session.id);
  });

  it('cancels a busy worker without closing the session', async () => {
    const session = registry.create({
      id: 'session-3',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    registry.updateStatus(session.id, 'busy');
    attachedWorkers.set(session.id, { alive: true, busy: true });

    const res = await app.request(`/sessions/${session.id}/cancel`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      action: 'cancel',
      status: 'ready',
      attached: true,
      inspection: expect.objectContaining({
        state: 'canceling',
      }),
    }));
    expect(vi.mocked(pool.cancel)).toHaveBeenCalledWith(session.id);
    expect(attachedWorkers.get(session.id)?.busy).toBe(false);
  });

  it('resets provider resume state and inspection metadata', async () => {
    const session = registry.create({
      id: 'session-4',
      providerName: 'claude',
      providerBackend: 'agent',
      cwd: 'C:/repo',
    });
    registry.setProviderSessionId(session.id, 'provider-session-1');
    registry.setProviderState(session.id, {
      agentSession: {
        providerSessionId: 'provider-session-1',
        status: 'idle',
        services: [{
          id: 'preview',
          name: 'Preview',
          url: 'http://127.0.0.1:4173',
        }],
      },
    });
    const runtime = getRuntimeSessionManager(ctx);
    runtime.beginRun(session, { message: 'Continue the task.' });
    runtime.observeEvent(session.id, {
      type: 'progress',
      text: 'Collecting stale context',
      metadata: {
        kind: 'status',
        status: 'running',
      },
    });

    const res = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maintenance: {
          reason: 'owner_requested_reset',
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              scope: 'summary',
              includeArtifacts: true,
            },
          }],
        },
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      action: string;
      providerSessionId?: string;
      providerState?: unknown;
      status: string;
      inspection: {
        currentRun?: unknown;
        lastRun?: unknown;
        progress?: unknown;
        recentEvents?: unknown[];
        maintenance: {
          lastRequest: {
            action: string;
            worktreeDisposition?: string;
            reason?: string;
            hookPayloads: Array<{ kind: string; payload?: Record<string, unknown> }>;
          };
          resetBoundary: {
            status: string;
            lastResetAt?: string;
          };
          lastLifecycle: {
            action: string;
            boundary: string;
            cleanup: Record<string, unknown>;
          };
        };
        actions: { canResume: boolean; canReset: boolean };
        services: Array<{ id: string }>;
      };
    };
    expect(body.action).toBe('reset');
    expect(body.status).toBe('closed');
    expect(body.providerSessionId).toBeUndefined();
    expect(body.providerState).toBeUndefined();
    expect(body.inspection.currentRun).toBeUndefined();
    expect(body.inspection.lastRun).toBeUndefined();
    expect(body.inspection.progress).toBeUndefined();
    expect(body.inspection.recentEvents).toEqual([]);
    expect(body.inspection.maintenance.lastRequest).toEqual(expect.objectContaining({
      action: 'reset',
      reason: 'owner_requested_reset',
      hookPayloads: [
        expect.objectContaining({
          kind: 'memory_flush',
          payload: {
            scope: 'summary',
            includeArtifacts: true,
          },
          payloadStatus: 'stored',
          payloadBytes: expect.any(Number),
        }),
      ],
    }));
    expect(body.inspection.maintenance.resetBoundary).toEqual(expect.objectContaining({
      status: 'cleared',
      lastResetAt: expect.any(String),
      reasonCodes: ['manual_reset'],
    }));
    expect(body.inspection.maintenance.lastLifecycle).toEqual(expect.objectContaining({
      action: 'reset',
      boundary: 'hard_reset',
      cleanup: expect.objectContaining({
        providerResumeCleared: true,
        providerStateCleared: true,
        wakeupsCleared: false,
        runStateCleared: true,
      }),
    }));
    expect(body.inspection.actions.canResume).toBe(true);
    expect(body.inspection.actions.canReset).toBe(false);
    expect(body.inspection.services).toEqual([]);

    runtime.dropSession(session.id);
    const historyResponse = await app.request(`/sessions/${session.id}/history`);
    expect(historyResponse.status).toBe(200);
    const historyBody = await historyResponse.json() as {
      inspection: {
        maintenance: {
          lastRequest: {
            action: string;
            reason?: string;
          };
          resetBoundary: {
            status: string;
          };
        };
      };
    };
    expect(historyBody.inspection.maintenance.lastRequest).toEqual(expect.objectContaining({
      action: 'reset',
      reason: 'owner_requested_reset',
    }));
    expect(historyBody.inspection.maintenance.resetBoundary.status).toBe('cleared');
  });

  it('clears scheduled wakeups when resetting a session', async () => {
    const session = registry.create({
      id: 'session-reset-wakeup',
      providerName: 'claude',
      cwd: join(rootDir, 'repo-reset'),
    });
    registry.setProviderSessionId(session.id, 'provider-session-reset');
    wakeup.create({
      reason: 'Wake after reopen.',
      target: {
        kind: 'session',
        sessionId: session.id,
      },
      scheduleAt: '2026-03-23T00:05:00.000Z',
    });

    const res = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('closed');
    expect(body).not.toHaveProperty('wakeup');
    expect(body).toEqual(expect.objectContaining({
      inspection: expect.objectContaining({
        maintenance: expect.objectContaining({
          lastLifecycle: expect.objectContaining({
            cleanup: expect.objectContaining({
              wakeupsCleared: true,
            }),
          }),
        }),
      }),
    }));

    const wakeupListResponse = await app.request(`/wakeups?sessionId=${session.id}`);
    expect(wakeupListResponse.status).toBe(200);
    await expect(wakeupListResponse.json()).resolves.toEqual({ wakeups: [] });
  });

  it('exposes a public compaction-preparation route and persists the last compaction request', async () => {
    const session = registry.create({
      id: 'session-compact',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    session.messageCount = 40;
    session.totalInputTokens = 9000;
    session.totalOutputTokens = 5000;
    registry.updateStatus(session.id, 'closed');

    const pendingResponse = await app.request(`/sessions/${session.id}/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maintenance: {
          reason: 'owner_requested_compaction',
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              scope: 'summary',
            },
          }],
        },
      }),
    });
    expect(pendingResponse.status).toBe(200);
    const pendingBody = await pendingResponse.json() as {
      action: string;
      status: string;
      execution: string;
      runtimeCompactionExecuted: boolean;
      hookStatus: string;
      reasonCodes: string[];
      maintenance: {
        lastRequest: {
          action: string;
          reason?: string;
        };
      };
    };
    expect(pendingBody).toEqual(expect.objectContaining({
      action: 'compact',
      status: 'pending_hooks',
      execution: 'external_only',
      runtimeCompactionExecuted: false,
      hookStatus: 'pending',
      reasonCodes: expect.arrayContaining(['pre_compaction_hooks_pending', 'session_inactive']),
      maintenance: expect.objectContaining({
        lastRequest: expect.objectContaining({
          action: 'compact',
          reason: 'owner_requested_compaction',
        }),
      }),
    }));

    const readyResponse = await app.request(`/sessions/${session.id}/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acknowledgeHooks: true,
        maintenance: {
          reason: 'hooks_acknowledged',
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              scope: 'summary',
              flushed: true,
            },
          }],
        },
      }),
    });
    expect(readyResponse.status).toBe(200);
    const readyBody = await readyResponse.json() as {
      status: string;
      hookStatus: string;
      session: {
        inspection: {
          maintenance: {
            lastRequest: {
              action: string;
              reason?: string;
              hookPayloads: Array<{
                kind: string;
                payload?: Record<string, unknown>;
                payloadStatus?: string;
                payloadBytes?: number;
              }>;
            };
          };
        };
      };
    };
    expect(readyBody).toEqual(expect.objectContaining({
      status: 'ready_for_external_compaction',
      hookStatus: 'acknowledged',
      session: expect.objectContaining({
        inspection: expect.objectContaining({
          maintenance: expect.objectContaining({
            lastRequest: expect.objectContaining({
              action: 'compact',
              reason: 'hooks_acknowledged',
              hookPayloads: [
                expect.objectContaining({
                  kind: 'memory_flush',
                  payload: {
                    scope: 'summary',
                    flushed: true,
                  },
                  payloadStatus: 'stored',
                  payloadBytes: expect.any(Number),
                }),
              ],
            }),
          }),
        }),
      }),
    }));

    getRuntimeSessionManager(ctx).dropSession(session.id);
    const persistedResponse = await app.request(`/sessions/${session.id}`);
    expect(persistedResponse.status).toBe(200);
    const persistedBody = await persistedResponse.json() as {
      inspection: {
        maintenance: {
          lastRequest: {
            action: string;
            reason?: string;
          };
        };
      };
    };
    expect(persistedBody.inspection.maintenance.lastRequest).toEqual(expect.objectContaining({
      action: 'compact',
      reason: 'hooks_acknowledged',
    }));
  });

  it('records compaction follow-through outcomes and reopens pending hooks on retry requests', async () => {
    const session = registry.create({
      id: 'session-compact-follow-through',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    session.messageCount = 40;
    session.totalInputTokens = 9_000;
    session.totalOutputTokens = 5_000;
    registry.updateStatus(session.id, 'closed');

    const pendingResponse = await app.request(`/sessions/${session.id}/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maintenance: {
          reason: 'owner_requested_compaction',
        },
      }),
    });
    expect(pendingResponse.status).toBe(200);
    await expect(pendingResponse.json()).resolves.toEqual(expect.objectContaining({
      status: 'pending_hooks',
      hookStatus: 'pending',
    }));

    const acknowledgedResponse = await app.request(`/sessions/${session.id}/compact/follow-through`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        outcome: 'acknowledged',
        maintenance: {
          reason: 'memory_flush_completed',
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              flushed: true,
              scope: 'summary',
            },
          }],
        },
      }),
    });
    expect(acknowledgedResponse.status).toBe(200);
    const acknowledgedBody = await acknowledgedResponse.json() as {
      outcome: string;
      status: string;
      hookStatus: string;
      maintenance: {
        lastFollowThrough: {
          outcome: string;
          reason?: string;
          hookPayloads: Array<{
            kind: string;
            payload?: Record<string, unknown>;
            payloadStatus?: string;
          }>;
        };
      };
    };
    expect(acknowledgedBody).toEqual(expect.objectContaining({
      outcome: 'acknowledged',
      status: 'ready_for_external_compaction',
      hookStatus: 'acknowledged',
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          outcome: 'acknowledged',
          reason: 'memory_flush_completed',
          hookPayloads: [
            expect.objectContaining({
              kind: 'memory_flush',
              payloadStatus: 'stored',
              payload: {
                flushed: true,
                scope: 'summary',
              },
            }),
          ],
        }),
      }),
    }));

    const retryResponse = await app.request(`/sessions/${session.id}/compact/follow-through`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        outcome: 'retry_requested',
        maintenance: {
          reason: 'memory_flush_needs_retry',
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              flushed: false,
              error: 'transient export failure',
            },
          }],
        },
      }),
    });
    expect(retryResponse.status).toBe(200);
    const retryBody = await retryResponse.json() as {
      outcome: string;
      status: string;
      hookStatus: string;
      maintenance: {
        lastFollowThrough: {
          outcome: string;
          reason?: string;
        };
      };
    };
    expect(retryBody).toEqual(expect.objectContaining({
      outcome: 'retry_requested',
      status: 'pending_hooks',
      hookStatus: 'pending',
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          outcome: 'retry_requested',
          reason: 'memory_flush_needs_retry',
        }),
      }),
    }));

    getRuntimeSessionManager(ctx).dropSession(session.id);
    const persistedResponse = await app.request(`/sessions/${session.id}`);
    expect(persistedResponse.status).toBe(200);
    const persistedBody = await persistedResponse.json() as {
      inspection: {
        maintenance: {
          lastFollowThrough: {
            outcome: string;
            reason?: string;
          };
        };
      };
    };
    expect(persistedBody.inspection.maintenance.lastFollowThrough).toEqual(expect.objectContaining({
      outcome: 'retry_requested',
      reason: 'memory_flush_needs_retry',
    }));
  });

  it('uses persisted completion follow-through to keep the public compaction seam acknowledged', async () => {
    const session = registry.create({
      id: 'session-compact-follow-through-completed',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    session.messageCount = 40;
    session.totalInputTokens = 9_000;
    session.totalOutputTokens = 5_000;
    registry.updateStatus(session.id, 'closed');

    const followThroughResponse = await app.request(`/sessions/${session.id}/compact/follow-through`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        outcome: 'completed',
        maintenance: {
          reason: 'external_compaction_completed',
        },
      }),
    });
    expect(followThroughResponse.status).toBe(200);
    await expect(followThroughResponse.json()).resolves.toEqual(expect.objectContaining({
      outcome: 'completed',
      status: 'ready_for_external_compaction',
      hookStatus: 'completed',
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          outcome: 'completed',
          reason: 'external_compaction_completed',
        }),
      }),
    }));

    const compactResponse = await app.request(`/sessions/${session.id}/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maintenance: {
          reason: 'owner_checked_compaction_status',
        },
      }),
    });
    expect(compactResponse.status).toBe(200);
    await expect(compactResponse.json()).resolves.toEqual(expect.objectContaining({
      status: 'ready_for_external_compaction',
      hookStatus: 'completed',
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          outcome: 'completed',
          reason: 'external_compaction_completed',
        }),
      }),
    }));
  });

  it('records generic maintenance follow-through for pre-reset and pre-flush hooks', async () => {
    const resetSession = registry.create({
      id: 'session-maintenance-follow-through-reset',
      providerName: 'claude',
      cwd: 'C:/repo-reset-follow-through',
    });
    resetSession.messageCount = 4;
    resetSession.totalInputTokens = 400;
    resetSession.totalOutputTokens = 200;
    registry.updateStatus(resetSession.id, 'closed');

    const resetFollowThroughResponse = await app.request(
      `/sessions/${resetSession.id}/maintenance/follow-through`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'reset',
          phase: 'pre_reset',
          outcome: 'acknowledged',
          maintenance: {
            reason: 'memory_flush_completed',
            hookPayloads: [{
              kind: 'memory_flush',
              payload: {
                flushed: true,
                scope: 'summary',
              },
            }],
          },
        }),
      },
    );
    expect(resetFollowThroughResponse.status).toBe(200);
    await expect(resetFollowThroughResponse.json()).resolves.toEqual(expect.objectContaining({
      action: 'reset',
      phase: 'pre_reset',
      outcome: 'acknowledged',
      maintenance: expect.objectContaining({
        lastFollowThrough: expect.objectContaining({
          action: 'reset',
          phase: 'pre_reset',
          outcome: 'acknowledged',
          reason: 'memory_flush_completed',
          hookPayloads: [
            expect.objectContaining({
              kind: 'memory_flush',
              payloadStatus: 'stored',
              payload: {
                flushed: true,
                scope: 'summary',
              },
            }),
          ],
        }),
      }),
    }));

    const flushSession = registry.create({
      id: 'session-maintenance-follow-through-flush',
      providerName: 'claude',
      cwd: 'C:/repo-flush-follow-through',
      workspaceMode: 'isolated',
    });
    registry.updateStatus(flushSession.id, 'closed');

    const flushFollowThroughResponse = await app.request(
      `/sessions/${flushSession.id}/maintenance/follow-through`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          phase: 'pre_flush',
          outcome: 'retry_requested',
          maintenance: {
            reason: 'memory_flush_needs_retry',
          },
        }),
      },
    );
    expect(flushFollowThroughResponse.status).toBe(200);
    await expect(flushFollowThroughResponse.json()).resolves.toEqual(expect.objectContaining({
      action: 'delete',
      phase: 'pre_flush',
      outcome: 'retry_requested',
      maintenance: expect.objectContaining({
        flush: expect.objectContaining({
          status: 'retry_requested',
          phase: 'pre_flush',
          hookCount: 1,
          action: 'delete',
          reasonCodes: ['follow_through_retry_requested'],
        }),
        lastFollowThrough: expect.objectContaining({
          action: 'delete',
          phase: 'pre_flush',
          outcome: 'retry_requested',
          reason: 'memory_flush_needs_retry',
        }),
      }),
    }));

    getRuntimeSessionManager(ctx).dropSession(flushSession.id);
    const persistedFlushResponse = await app.request(`/sessions/${flushSession.id}`);
    expect(persistedFlushResponse.status).toBe(200);
    await expect(persistedFlushResponse.json()).resolves.toEqual(expect.objectContaining({
      inspection: expect.objectContaining({
        maintenance: expect.objectContaining({
          flush: expect.objectContaining({
            status: 'retry_requested',
            phase: 'pre_flush',
            hookCount: 1,
            action: 'delete',
            reasonCodes: ['follow_through_retry_requested'],
          }),
          lastFollowThrough: expect.objectContaining({
            action: 'delete',
            phase: 'pre_flush',
            outcome: 'retry_requested',
            reason: 'memory_flush_needs_retry',
          }),
        }),
      }),
    }));
  });

  it('rejects invalid maintenance follow-through action and phase combinations', async () => {
    const session = registry.create({
      id: 'session-maintenance-follow-through-invalid',
      providerName: 'claude',
      cwd: 'C:/repo-invalid-follow-through',
    });
    session.messageCount = 4;
    session.totalInputTokens = 400;
    session.totalOutputTokens = 200;
    registry.updateStatus(session.id, 'closed');

    const response = await app.request(`/sessions/${session.id}/maintenance/follow-through`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'reset',
        phase: 'pre_flush',
        outcome: 'acknowledged',
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "action 'reset' does not support follow-through phase 'pre_flush'",
    });
  });

  it('gates reset behind acknowledged pre-reset hooks when requested', async () => {
    const session = registry.create({
      id: 'session-reset-hook-gated',
      providerName: 'claude',
      cwd: 'C:/repo-reset-gated',
    });
    session.messageCount = 4;
    session.totalInputTokens = 400;
    session.totalOutputTokens = 200;
    registry.setProviderSessionId(session.id, 'provider-session-reset-gated');
    registry.setProviderState(session.id, {
      resumeToken: 'keep-me',
    });
    registry.updateStatus(session.id, 'closed');

    const blockedReset = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requireAcknowledgedHooks: true,
        maintenance: {
          reason: 'owner_requested_reset',
        },
      }),
    });
    expect(blockedReset.status).toBe(409);
    await expect(blockedReset.json()).resolves.toEqual(expect.objectContaining({
      error: "This session still has pending pre_reset hooks for action 'reset'.",
      action: 'reset',
      phase: 'pre_reset',
      status: 'pending_hooks',
      hookStatus: 'pending',
      reasonCodes: ['pre_reset_hooks_pending'],
      maintenance: expect.objectContaining({
        lastRequest: expect.objectContaining({
          action: 'reset',
          reason: 'owner_requested_reset',
        }),
      }),
      session: expect.objectContaining({
        providerSessionId: 'provider-session-reset-gated',
      }),
    }));
    expect(registry.get(session.id)?.providerSessionId).toBe('provider-session-reset-gated');
    expect(registry.get(session.id)?.providerState).toEqual({ resumeToken: 'keep-me' });

    const acknowledgeReset = await app.request(`/sessions/${session.id}/maintenance/follow-through`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'reset',
        phase: 'pre_reset',
        outcome: 'acknowledged',
        maintenance: {
          reason: 'memory_flush_completed',
        },
      }),
    });
    expect(acknowledgeReset.status).toBe(200);

    const resetResponse = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requireAcknowledgedHooks: true,
      }),
    });
    expect(resetResponse.status).toBe(200);
    const resetBody = await resetResponse.json() as {
      action: string;
      status: string;
      providerSessionId?: string;
      providerState?: unknown;
      inspection: {
        maintenance: {
          lastFollowThrough?: {
            action: string;
            phase: string;
            outcome: string;
          };
          lastLifecycle: {
            action: string;
            status: string;
          };
        };
      };
    };
    expect(resetBody.action).toBe('reset');
    expect(resetBody.status).toBe('closed');
    expect(resetBody.providerSessionId).toBeUndefined();
    expect(resetBody.providerState).toBeUndefined();
    expect(resetBody.inspection.maintenance.lastFollowThrough).toEqual(expect.objectContaining({
      action: 'reset',
      phase: 'pre_reset',
      outcome: 'acknowledged',
    }));
    expect(resetBody.inspection.maintenance.lastLifecycle).toEqual(expect.objectContaining({
      action: 'reset',
      status: 'completed',
    }));
    expect(registry.get(session.id)?.providerSessionId).toBeUndefined();
    expect(registry.get(session.id)?.providerState).toBeUndefined();
  });

  it('gates delete behind acknowledged pre-flush hooks when requested', async () => {
    const session = registry.create({
      id: 'session-delete-hook-gated',
      providerName: 'claude',
      cwd: 'C:/repo-delete-gated',
    });
    session.messageCount = 4;
    session.totalInputTokens = 400;
    session.totalOutputTokens = 200;
    registry.updateStatus(session.id, 'closed');

    const blockedDelete = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requireAcknowledgedHooks: true,
        maintenance: {
          reason: 'owner_requested_delete',
        },
      }),
    });
    expect(blockedDelete.status).toBe(409);
    await expect(blockedDelete.json()).resolves.toEqual(expect.objectContaining({
      error: "This session still has pending pre_flush hooks for action 'delete'.",
      action: 'delete',
      phase: 'pre_flush',
      status: 'pending_hooks',
      hookStatus: 'pending',
      reasonCodes: ['pre_flush_hooks_pending'],
      maintenance: expect.objectContaining({
        lastRequest: expect.objectContaining({
          action: 'delete',
          reason: 'owner_requested_delete',
        }),
      }),
    }));
    expect(registry.get(session.id)).toBeTruthy();

    const acknowledgeDelete = await app.request(`/sessions/${session.id}/maintenance/follow-through`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        phase: 'pre_flush',
        outcome: 'acknowledged',
        maintenance: {
          reason: 'memory_flush_completed',
        },
      }),
    });
    expect(acknowledgeDelete.status).toBe(200);

    const deleteResponse = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requireAcknowledgedHooks: true,
      }),
    });
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual(expect.objectContaining({
      action: 'delete',
      status: 'deleted',
      maintenance: expect.objectContaining({
        action: 'delete',
        status: 'completed',
      }),
    }));
    expect(registry.get(session.id)).toBeUndefined();
  });

  it('keeps reset hook acknowledgements usable after later delete follow-through writes', async () => {
    const session = registry.create({
      id: 'session-reset-history-kept',
      providerName: 'claude',
      cwd: 'C:/repo-reset-history-kept',
    });
    session.messageCount = 4;
    session.totalInputTokens = 400;
    session.totalOutputTokens = 200;
    registry.setProviderSessionId(session.id, 'provider-session-reset-history-kept');
    registry.updateStatus(session.id, 'closed');

    const blockedReset = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requireAcknowledgedHooks: true,
        maintenance: {
          reason: 'owner_requested_reset',
        },
      }),
    });
    expect(blockedReset.status).toBe(409);

    const acknowledgeReset = await app.request(`/sessions/${session.id}/maintenance/follow-through`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'reset',
        phase: 'pre_reset',
        outcome: 'acknowledged',
        maintenance: {
          reason: 'memory_flush_completed',
        },
      }),
    });
    expect(acknowledgeReset.status).toBe(200);

    const blockedDelete = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requireAcknowledgedHooks: true,
        maintenance: {
          reason: 'owner_requested_delete',
        },
      }),
    });
    expect(blockedDelete.status).toBe(409);

    const acknowledgeDelete = await app.request(`/sessions/${session.id}/maintenance/follow-through`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'delete',
        phase: 'pre_flush',
        outcome: 'acknowledged',
        maintenance: {
          reason: 'memory_flush_completed',
        },
      }),
    });
    expect(acknowledgeDelete.status).toBe(200);

    const resetResponse = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requireAcknowledgedHooks: true,
      }),
    });
    expect(resetResponse.status).toBe(200);
    await expect(resetResponse.json()).resolves.toEqual(expect.objectContaining({
      action: 'reset',
      status: 'closed',
      inspection: expect.objectContaining({
        maintenance: expect.objectContaining({
          lastFollowThrough: expect.objectContaining({
            action: 'delete',
            phase: 'pre_flush',
            outcome: 'acknowledged',
          }),
          followThroughHistory: expect.arrayContaining([
            expect.objectContaining({
              action: 'reset',
              phase: 'pre_reset',
              outcome: 'acknowledged',
            }),
            expect.objectContaining({
              action: 'delete',
              phase: 'pre_flush',
              outcome: 'acknowledged',
            }),
          ]),
          lastLifecycle: expect.objectContaining({
            action: 'reset',
            status: 'completed',
          }),
        }),
      }),
    }));
  });

  it('runtime-compacts managed transcripts, repairs malformed lines, and persists the compaction baseline', async () => {
    const session = registry.create({
      id: 'session-runtime-compact',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    session.messageCount = 40;
    session.totalInputTokens = 9_000;
    session.totalOutputTokens = 5_000;
    registry.updateStatus(session.id, 'closed');

    const historyDir = join(sessionBaseDir, 'history');
    mkdirSync(historyDir, { recursive: true });
    const transcriptPath = join(historyDir, `${session.id}.jsonl`);
    writeFileSync(transcriptPath, [
      JSON.stringify({
        type: 'user',
        message: { content: 'Need a cleanup plan.' },
        timestamp: '2026-03-24T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Starting from repo state.' }] },
        timestamp: '2026-03-24T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'tool_use',
        toolId: 'tool-1',
        toolName: 'inspect-repo-status',
        arguments: { path: '.' },
        timestamp: '2026-03-24T00:00:02.000Z',
      }),
      JSON.stringify({
        type: 'tool_result',
        toolId: 'tool-1',
        toolName: 'inspect-repo-status',
        text: 'dirty worktree',
        timestamp: '2026-03-24T00:00:03.000Z',
      }),
      'not-json-at-all',
      JSON.stringify({
        type: 'user',
        message: { content: 'Retry after the fix.' },
        timestamp: '2026-03-24T00:00:04.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Retrying with a narrower patch.' }] },
        timestamp: '2026-03-24T00:00:05.000Z',
      }),
    ].join('\n') + '\n', 'utf8');
    registry.setSourcePath(session.id, transcriptPath);

    const response = await app.request(`/sessions/${session.id}/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acknowledgeHooks: true,
        maintenance: {
          reason: 'owner_requested_runtime_compaction',
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      status: string;
      execution: string;
      runtimeCompactionExecuted: boolean;
      runtimeCompaction?: {
        transcriptPath: string;
        archivePath?: string;
        repairedLineCount: number;
        compactedEntryCount: number;
        aggressivePassCount: number;
      };
      maintenance: {
        compaction: {
          status: string;
          reasonCodes: string[];
          messageCount: number;
          totalTokens: number;
          lastCompaction?: {
            transcriptPath: string;
            archivePath?: string;
          };
        };
      };
    };
    expect(body).toEqual(expect.objectContaining({
      status: 'compacted',
      execution: 'runtime',
      runtimeCompactionExecuted: true,
      runtimeCompaction: expect.objectContaining({
        transcriptPath,
        repairedLineCount: 1,
        compactedEntryCount: expect.any(Number),
        aggressivePassCount: expect.any(Number),
      }),
      maintenance: expect.objectContaining({
        compaction: expect.objectContaining({
          status: 'not_ready',
          reasonCodes: ['below_compaction_threshold'],
        }),
      }),
    }));
    expect(body.runtimeCompaction?.archivePath).toBeTruthy();

    const compactedLines = readFileSync(transcriptPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(compactedLines[0]).toEqual(expect.objectContaining({
      type: 'compaction_summary',
      text: expect.stringContaining('Runtime compaction summary'),
    }));

    const historyResponse = await app.request(`/sessions/${session.id}/history`);
    expect(historyResponse.status).toBe(200);
    await expect(historyResponse.json()).resolves.toEqual(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          text: expect.stringContaining('Runtime compaction summary'),
        }),
      ]),
    }));

    getRuntimeSessionManager(ctx).dropSession(session.id);
    const persistedResponse = await app.request(`/sessions/${session.id}`);
    expect(persistedResponse.status).toBe(200);
    const persistedBody = await persistedResponse.json() as {
      inspection: {
        maintenance: {
          compaction: {
            status: string;
            lastCompaction?: {
              transcriptPath: string;
              archivePath?: string;
            };
          };
        };
      };
    };
    expect(persistedBody.inspection.maintenance.compaction).toEqual(expect.objectContaining({
      status: 'not_ready',
      lastCompaction: expect.objectContaining({
        transcriptPath,
        archivePath: expect.any(String),
      }),
    }));
  });

  it('returns deferred compaction status while the session is still active', async () => {
    const session = registry.create({
      id: 'session-compact-active',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    session.messageCount = 40;
    session.totalInputTokens = 9000;
    session.totalOutputTokens = 5000;
    registry.updateStatus(session.id, 'ready');
    attachedWorkers.set(session.id, { alive: true });

    const response = await app.request(`/sessions/${session.id}/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maintenance: {
          reason: 'owner_requested_compaction',
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      status: string;
      hookStatus: string;
      reasonCodes: string[];
    };
    expect(body).toEqual(expect.objectContaining({
      status: 'deferred',
      hookStatus: 'pending',
      reasonCodes: expect.arrayContaining(['message_count_threshold', 'token_threshold', 'session_active']),
    }));
  });

  it('returns not_ready when compaction thresholds have not been reached yet', async () => {
    const session = registry.create({
      id: 'session-compact-not-ready',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    session.messageCount = 2;
    session.totalInputTokens = 200;
    session.totalOutputTokens = 100;
    registry.updateStatus(session.id, 'closed');

    const response = await app.request(`/sessions/${session.id}/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acknowledgeHooks: true,
        maintenance: {
          reason: 'owner_checked_compaction',
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      status: string;
      execution: string;
      runtimeCompactionExecuted: boolean;
      hookStatus: string;
      reasonCodes: string[];
      maintenance: {
        lastRequest: {
          action: string;
          reason?: string;
        };
      };
    };
    expect(body).toEqual(expect.objectContaining({
      status: 'not_ready',
      execution: 'external_only',
      runtimeCompactionExecuted: false,
      hookStatus: 'none',
      reasonCodes: ['below_compaction_threshold'],
      maintenance: expect.objectContaining({
        lastRequest: expect.objectContaining({
          action: 'compact',
          reason: 'owner_checked_compaction',
        }),
      }),
    }));
  });

  it('sanitizes persisted maintenance request payloads before surfacing them through session inspection', async () => {
    const session = registry.create({
      id: 'session-compact-guardrails',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    session.messageCount = 2;
    session.totalInputTokens = 20;
    session.totalOutputTokens = 10;
    registry.updateStatus(session.id, 'closed');

    const response = await app.request(`/sessions/${session.id}/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maintenance: {
          reason: 'r'.repeat(700),
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              apiKey: 'super-secret',
              summary: 's'.repeat(700),
            },
          }],
        },
      }),
    });
    expect(response.status).toBe(200);

    const body = await response.json() as {
      maintenance: {
        lastRequest: {
          reason?: string;
          reasonTruncated?: boolean;
          hookPayloads: Array<{
            kind: string;
            payload?: Record<string, unknown>;
            payloadStatus?: string;
            payloadWarnings?: string[];
          }>;
        };
        markers: Array<{
          code: string;
          details?: Record<string, unknown>;
        }>;
      };
    };
    expect(body.maintenance.lastRequest.reason?.length).toBeLessThanOrEqual(512);
    expect(body.maintenance.lastRequest.reasonTruncated).toBe(true);
    expect(body.maintenance.lastRequest.hookPayloads[0]).toEqual(expect.objectContaining({
      kind: 'memory_flush',
      payloadStatus: 'redacted_and_truncated',
      payloadWarnings: expect.arrayContaining(['sensitive_keys_redacted', 'string_truncated']),
      payload: expect.objectContaining({
        apiKey: '[redacted]',
      }),
    }));
    const compactMarker = body.maintenance.markers.find((marker) => marker.code === 'compact_requested');
    expect(compactMarker).toEqual(expect.objectContaining({
      code: 'compact_requested',
      details: expect.objectContaining({
        reasonTruncated: true,
      }),
    }));
    expect(String(compactMarker?.details?.reason ?? '')).toHaveLength(512);

    getRuntimeSessionManager(ctx).dropSession(session.id);
    const persistedResponse = await app.request(`/sessions/${session.id}`);
    expect(persistedResponse.status).toBe(200);
    const persistedBody = await persistedResponse.json() as {
      inspection: {
        maintenance: {
          lastRequest: {
            reasonTruncated?: boolean;
            hookPayloads: Array<{
              payloadStatus?: string;
              payload?: Record<string, unknown>;
            }>;
          };
          markers: Array<{
            code: string;
            details?: Record<string, unknown>;
          }>;
        };
      };
    };
    expect(persistedBody.inspection.maintenance.lastRequest.reasonTruncated).toBe(true);
    expect(persistedBody.inspection.maintenance.lastRequest.hookPayloads[0]).toEqual(
      expect.objectContaining({
        payloadStatus: 'redacted_and_truncated',
        payload: expect.objectContaining({
          apiKey: '[redacted]',
        }),
      }),
    );
    const persistedCompactMarker = persistedBody.inspection.maintenance.markers.find(
      (marker) => marker.code === 'compact_requested',
    );
    expect(persistedCompactMarker).toEqual(expect.objectContaining({
      code: 'compact_requested',
      details: expect.objectContaining({
        reasonTruncated: true,
      }),
    }));
    expect(String(persistedCompactMarker?.details?.reason ?? '')).toHaveLength(512);
  });

  it('clears runtime-owned browser sessions when resetting a session', async () => {
    const session = registry.create({
      id: 'session-reset-browser',
      providerName: 'claude',
      cwd: join(rootDir, 'repo-reset-browser'),
    });
    registry.updateStatus(session.id, 'ready');

    const createBrowserResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtimeSessionId: session.id,
        label: 'Reset Browser Session',
      }),
    });
    expect(createBrowserResponse.status).toBe(201);
    const browserSession = await createBrowserResponse.json() as {
      session: { id: string };
    };

    const pageResponse = await app.request(`/browser/sessions/${browserSession.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:4173',
        label: 'Reset Preview',
      }),
    });
    expect(pageResponse.status).toBe(201);

    const res = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      action: string;
      inspection: {
        browserSessions?: unknown[];
        maintenance: {
          lastLifecycle: {
            cleanup: Record<string, unknown>;
          };
        };
      };
    };
    expect(body.action).toBe('reset');
    expect(body.inspection.browserSessions).toBeUndefined();
    expect(body.inspection.maintenance.lastLifecycle.cleanup).toEqual(expect.objectContaining({
      browserSessionsCleared: 1,
    }));

    const browserSessionsResponse = await app.request(`/browser/sessions?runtimeSessionId=${session.id}`);
    expect(browserSessionsResponse.status).toBe(200);
    await expect(browserSessionsResponse.json()).resolves.toEqual({ sessions: [] });
  });

  it('clears scheduled wakeups when deleting a session', async () => {
    const session = registry.create({
      id: 'session-delete-wakeup',
      providerName: 'claude',
      cwd: join(rootDir, 'repo-delete'),
    });
    registry.updateStatus(session.id, 'closed');
    wakeup.create({
      reason: 'Wake before follow-up.',
      target: {
        kind: 'session',
        sessionId: session.id,
      },
      scheduleAt: '2026-03-23T00:10:00.000Z',
    });

    const res = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      status: 'deleted',
      cleanup: expect.objectContaining({
        workerDetached: true,
        wakeupsCleared: true,
        registryDropped: true,
      }),
      maintenance: expect.objectContaining({
        action: 'delete',
        boundary: 'permanent_delete',
        status: 'completed',
        cleanup: expect.objectContaining({
          workerDetached: true,
          wakeupsCleared: true,
          registryDropped: true,
        }),
      }),
    }));

    const wakeupListResponse = await app.request(`/wakeups?sessionId=${session.id}`);
    expect(wakeupListResponse.status).toBe(200);
    await expect(wakeupListResponse.json()).resolves.toEqual({ wakeups: [] });
  });

  it('clears runtime-owned browser sessions when deleting a session', async () => {
    const session = registry.create({
      id: 'session-delete-browser',
      providerName: 'claude',
      cwd: join(rootDir, 'repo-delete-browser'),
    });
    registry.updateStatus(session.id, 'closed');

    const createBrowserResponse = await app.request('/browser/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtimeSessionId: session.id,
        label: 'Delete Browser Session',
      }),
    });
    expect(createBrowserResponse.status).toBe(201);
    const browserSession = await createBrowserResponse.json() as {
      session: { id: string };
    };

    const pageResponse = await app.request(`/browser/sessions/${browserSession.session.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'http://127.0.0.1:3000',
        label: 'Delete Preview',
      }),
    });
    expect(pageResponse.status).toBe(201);

    const res = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      status: 'deleted',
      cleanup: expect.objectContaining({
        browserSessionsCleared: 1,
        registryDropped: true,
      }),
      maintenance: expect.objectContaining({
        cleanup: expect.objectContaining({
          browserSessionsCleared: 1,
          registryDropped: true,
        }),
      }),
    }));

    const browserSessionsResponse = await app.request(`/browser/sessions?runtimeSessionId=${session.id}`);
    expect(browserSessionsResponse.status).toBe(200);
    await expect(browserSessionsResponse.json()).resolves.toEqual({ sessions: [] });
  });

  it('returns a machine-readable observe payload with inspection and stream availability', async () => {
    const session = registry.create({
      id: 'session-5',
      providerName: 'claude',
      cwd: 'C:/repo',
      context: {
        source: 'assignment',
        reason: 'follow up',
        taskId: 'task-9',
      },
    });
    registry.updateStatus(session.id, 'ready');
    attachedWorkers.set(session.id, { alive: true });

    const runtime = getRuntimeSessionManager(ctx);
    runtime.beginRun(session, { message: 'check status' });
    runtime.observeEvent(session.id, {
      type: 'progress',
      text: 'Inspecting workspace',
      metadata: {
        kind: 'status',
        status: 'running',
      },
    });
    wakeup.create({
      reason: 'Wake for owner follow-up.',
      target: {
        kind: 'session',
        sessionId: session.id,
      },
      scheduleAt: '2026-03-23T00:15:00.000Z',
    });

    const res = await app.request(`/sessions/${session.id}/observe`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      historyPath: `/sessions/${session.id}/history`,
      observePath: `/sessions/${session.id}/observe`,
      stream: {
        path: `/sessions/${session.id}/stream`,
        available: true,
      },
      session: {
        id: session.id,
        wakeup: {
          pending: true,
          pendingRequestCount: 1,
          nextScheduledAt: '2026-03-23T00:15:00.000Z',
          lastRequest: {
            reason: 'Wake for owner follow-up.',
            status: 'scheduled',
          },
        },
        inspection: {
          state: 'running',
          wake: {
            source: 'assignment',
            reason: 'follow up',
            taskId: 'task-9',
          },
          currentRun: {
            status: 'running',
            wake: {
              source: 'assignment',
              reason: 'follow up',
              taskId: 'task-9',
            },
          },
          progress: {
            eventType: 'progress',
            text: 'Inspecting workspace',
            kind: 'status',
            status: 'running',
          },
        },
      },
    });
  });

  it('replays active observed turn events to late /sessions/:id/stream subscribers', async () => {
    class MockWorker extends EventEmitter {
      alive = true;
      busy = true;
    }

    const session = registry.create({
      id: 'session-stream-replay',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    registry.updateStatus(session.id, 'busy');
    const worker = new MockWorker();
    attachedWorkers.set(session.id, worker as unknown as { alive: boolean; busy?: boolean });

    const runtime = getRuntimeSessionManager(ctx);
    runtime.beginRun(session, { message: 'Need streamed replay.' });
    runtime.observeEvent(session.id, {
      type: 'progress',
      text: 'Collecting context',
      metadata: {
        kind: 'status',
        status: 'running',
      },
    });
    runtime.observeEvent(session.id, {
      type: 'text',
      text: 'Partial streamed output',
    });

    setTimeout(() => {
      runtime.observeEvent(session.id, {
        type: 'result',
        text: 'Final output',
      });
      worker.alive = false;
      worker.busy = false;
      worker.emit('exit', 0, null);
    }, 10);

    const response = await app.request(`/sessions/${session.id}/stream`);
    expect(response.status).toBe(200);
    expect(parseSse(await response.text())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'progress',
        text: 'Collecting context',
        sessionId: session.id,
        streamSeq: 1,
        streamSeqIndex: 0,
      }),
      expect.objectContaining({
        type: 'text',
        text: 'Partial streamed output',
        sessionId: session.id,
        streamSeq: 2,
        streamSeqIndex: 0,
      }),
      expect.objectContaining({
        type: 'content_block',
        sessionId: session.id,
        streamSeq: 2,
        streamSeqIndex: 1,
      }),
      expect.objectContaining({
        type: 'result',
        text: 'Final output',
        sessionId: session.id,
        streamSeq: 3,
        streamSeqIndex: 0,
      }),
      expect.objectContaining({
        type: 'session_closed',
      }),
    ]));
  });

  it('does not replay terminal observed events from the previous run when a session starts a new turn', async () => {
    class MockWorker extends EventEmitter {
      alive = true;
      busy = true;
    }

    const session = registry.create({
      id: 'session-stream-no-terminal-replay',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    registry.updateStatus(session.id, 'busy');
    const worker = new MockWorker();
    attachedWorkers.set(session.id, worker as unknown as { alive: boolean; busy?: boolean });

    const runtime = getRuntimeSessionManager(ctx);
    runtime.beginRun(session, { message: 'Old turn.' });
    runtime.observeEvent(session.id, {
      type: 'text',
      text: 'Old turn output',
    });
    runtime.observeEvent(session.id, {
      type: 'result',
      text: 'Old turn done',
    });

    setTimeout(() => {
      runtime.beginRun(session, { message: 'Fresh turn.' });
      runtime.observeEvent(session.id, {
        type: 'progress',
        text: 'Fresh turn starting',
        metadata: {
          kind: 'status',
          status: 'running',
        },
      });
      runtime.observeEvent(session.id, {
        type: 'text',
        text: 'Fresh turn output',
      });
      runtime.observeEvent(session.id, {
        type: 'result',
        text: 'Fresh turn done',
      });
      worker.alive = false;
      worker.busy = false;
      worker.emit('exit', 0, null);
    }, 10);

    const response = await app.request(`/sessions/${session.id}/stream`);
    expect(response.status).toBe(200);
    const events = parseSse(await response.text());
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        text: 'Old turn output',
      }),
      expect.objectContaining({
        type: 'result',
        text: 'Old turn done',
      }),
    ]));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'progress',
        text: 'Fresh turn starting',
        sessionId: session.id,
      }),
      expect.objectContaining({
        type: 'text',
        text: 'Fresh turn output',
        sessionId: session.id,
      }),
      expect.objectContaining({
        type: 'result',
        text: 'Fresh turn done',
        sessionId: session.id,
      }),
      expect.objectContaining({
        type: 'session_closed',
      }),
    ]));
  });
});
