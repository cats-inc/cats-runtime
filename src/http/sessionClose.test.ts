import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
    kiroDbPath: '~/.local/share/kiro-cli/data.sqlite3',
    kiroRuntime: {
      mode: 'wsl',
      distro: 'Ubuntu',
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
      kiro: { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'wsl', distro: 'Ubuntu' } },
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
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'closed' });
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

    const res = await app.request(`/sessions/${session.id}/close`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'closing' });
    expect(registry.get(session.id)?.status).toBe('closing');
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
    expect(await res.json()).toEqual({
      status: 'canceling',
      attached: true,
    });
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

    const res = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      providerSessionId?: string;
      providerState?: unknown;
      status: string;
      inspection: {
        actions: { canResume: boolean; canReset: boolean };
        services: Array<{ id: string }>;
      };
    };
    expect(body.status).toBe('closed');
    expect(body.providerSessionId).toBeUndefined();
    expect(body.providerState).toBeUndefined();
    expect(body.inspection.actions.canResume).toBe(true);
    expect(body.inspection.actions.canReset).toBe(false);
    expect(body.inspection.services).toEqual([]);
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

    const wakeupListResponse = await app.request(`/wakeups?sessionId=${session.id}`);
    expect(wakeupListResponse.status).toBe(200);
    await expect(wakeupListResponse.json()).resolves.toEqual({ wakeups: [] });
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
    }));

    const wakeupListResponse = await app.request(`/wakeups?sessionId=${session.id}`);
    expect(wakeupListResponse.status).toBe(200);
    await expect(wakeupListResponse.json()).resolves.toEqual({ wakeups: [] });
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
});
