import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';

describe('Cursor native session management', () => {
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
    sessionBaseDir: 'C:/tmp/cats-runtime/sessions',
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
  let attachedWorkers: Map<string, { alive: boolean }>;

  beforeEach(() => {
    registry = new SessionRegistry();
    attachedWorkers = new Map();
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn((id: string) => attachedWorkers.get(id)),
      spawn: vi.fn((sessionId: string) => {
        const worker = { alive: true };
        attachedWorkers.set(sessionId, worker);
        return worker as never;
      }),
      kill: vi.fn((sessionId: string) => {
        const worker = attachedWorkers.get(sessionId);
        if (worker) worker.alive = false;
        attachedWorkers.delete(sessionId);
      }),
      status: vi.fn(() => ({ active: 0 })),
    } as unknown as WorkerPool;
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

    app = createApp({
      config: makeConfig(),
      registry,
      pool,
      cursorNative,
      kiroNative,
      auggieSessions,
      opencodeNative,
    });
  });

  it('creates a native Cursor session through POST /sessions', async () => {
    vi.mocked(cursorNative.createSession).mockResolvedValue({
      providerSessionId: 'cursor-123',
      cwd: 'C:/repo',
      summary: 'Untitled Session',
      messageCount: 0,
    });

    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'cursor',
        cwd: 'C:/repo',
        workspaceMode: 'shared',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.providerName).toBe('cursor');
    expect(body.providerSessionId).toBe('cursor-123');
    expect(body.status).toBe('ready');
    expect(body.origin).toBe('runtime');
    expect(body.controlMode).toBe('full');
    expect(body.ownership).toBe('logical_session');
    expect(registry.list({ provider: 'cursor' })).toHaveLength(1);
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      expect.any(String),
      'cursor',
      expect.objectContaining({
        cwd: 'C:/repo',
        resumeSessionId: 'cursor-123',
      }),
    );
  });

  it('loads Cursor history through the generic history route', async () => {
    const session = registry.upsertDiscovered('cursor-123', {
      providerName: 'cursor',
      cwd: 'C:/repo',
      summary: 'Untitled Session',
      messageCount: 1,
    });
    vi.mocked(cursorNative.loadHistory).mockResolvedValue([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'world' },
    ]);

    const res = await app.request(`/sessions/${session!.id}/history`);

    expect(res.status).toBe(200);
    const body = await res.json() as { messages: Array<{ role: string; text: string }> };
    expect(body.messages).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'world' },
    ]);
  });

  it('deletes the native Cursor session before removing it from the registry', async () => {
    const session = registry.upsertDiscovered('cursor-123', {
      providerName: 'cursor',
      cwd: 'C:/repo',
      summary: 'Untitled Session',
      messageCount: 1,
    });
    vi.mocked(cursorNative.deleteSession).mockResolvedValue(true);

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.nativeDeleted).toBe(true);
    expect(registry.get(session!.id)).toBeUndefined();
  });

  it('retains session when native Cursor session state cannot be deleted', async () => {
    const session = registry.upsertDiscovered('cursor-stuck', {
      providerName: 'cursor',
      cwd: 'C:/repo',
      summary: 'Untitled Session',
      messageCount: 1,
    });
    vi.mocked(cursorNative.deleteSession).mockResolvedValue(false);

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('retained');
    expect(body.hadTranscript).toBe(true);
    expect(body.nativeDeleted).toBe(false);
    // Session kept in registry — not removed
    expect(registry.get(session!.id)).toBeDefined();
  });

  it('discovers existing Cursor sessions for a workspace', async () => {
    vi.mocked(cursorNative.listSessions).mockResolvedValue([
      {
        providerSessionId: 'cursor-abc',
        cwd: 'C:/repo',
        summary: 'Existing Cursor Session',
        messageCount: 3,
        lastActivity: '2026-03-09T00:00:00Z',
      },
    ]);

    const res = await app.request('/cursor/sessions/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: 'C:/repo' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ providerSessionId: string }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].providerSessionId).toBe('cursor-abc');
    expect(registry.list({ provider: 'cursor' })).toHaveLength(1);
  });

  it('passes startIfNeeded=false to Cursor manual discovery', async () => {
    vi.mocked(cursorNative.listSessions).mockResolvedValue([]);

    const res = await app.request('/cursor/sessions/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: 'C:/repo', startIfNeeded: false }),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(cursorNative.listSessions)).toHaveBeenCalledWith(
      'C:/repo',
      { startIfNeeded: false },
    );
  });

  it('inspects native Cursor sessions without mutating the registry', async () => {
    vi.mocked(cursorNative.listSessions).mockResolvedValue([
      {
        providerSessionId: 'cursor-inspect-1',
        cwd: 'C:/repo',
        summary: 'Inspect Only',
        messageCount: 2,
      },
    ]);

    const res = await app.request('/cursor/sessions?cwd=C:/repo');

    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ providerSessionId: string }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].providerSessionId).toBe('cursor-inspect-1');
    expect(registry.list({ provider: 'cursor' })).toHaveLength(0);
  });

  it('inspects all native Cursor sessions when cwd is omitted', async () => {
    vi.mocked(cursorNative.listAllSessions).mockResolvedValue([
      {
        providerSessionId: 'cursor-global-1',
        cwd: '/mnt/c/Users/kenne/Source/SK2/ai-content-storyteller',
        summary: 'Global Cursor Session',
        messageCount: 4,
      },
    ]);

    const res = await app.request('/cursor/sessions');

    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ providerSessionId: string; cwd: string }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].providerSessionId).toBe('cursor-global-1');
    expect(body.sessions[0].cwd).toBe('/mnt/c/Users/kenne/Source/SK2/ai-content-storyteller');
  });

  it('discovers all native Cursor sessions when cwd is omitted', async () => {
    vi.mocked(cursorNative.listAllSessions).mockResolvedValue([
      {
        providerSessionId: 'cursor-global-1',
        cwd: '/mnt/c/Users/kenne/Source/SK2/ai-content-storyteller',
        summary: 'Global Cursor Session',
        messageCount: 4,
        lastActivity: '2026-03-09T00:00:00Z',
      },
    ]);

    const res = await app.request('/cursor/sessions/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      sessions: Array<{ providerSessionId: string; cwd: string; origin: string; controlMode: string }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].providerSessionId).toBe('cursor-global-1');
    expect(body.sessions[0].cwd).toBe('/mnt/c/Users/kenne/Source/SK2/ai-content-storyteller');
    expect(body.sessions[0].origin).toBe('discovered');
    expect(body.sessions[0].controlMode).toBe('resume_only');
    expect(registry.list({ provider: 'cursor' })).toHaveLength(1);
  });

  it('returns 400 when sending a message to a closed Cursor session before resume', async () => {
    const session = registry.upsertDiscovered('cursor-123', {
      providerName: 'cursor',
      cwd: 'C:/repo',
      summary: 'Untitled Session',
      messageCount: 1,
    });

    const res = await app.request(`/sessions/${session!.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Resume it first');
  });

  it('resumes a discovered Cursor session by spawning an ephemeral worker', async () => {
    const session = registry.upsertDiscovered('cursor-123', {
      providerName: 'cursor',
      cwd: 'C:/repo',
      summary: 'Untitled Session',
      messageCount: 1,
    });

    const res = await app.request(`/sessions/${session!.id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.controlMode).toBe('full');
    expect(body.controls).toMatchObject({ canSend: true, canResume: false, canClose: true });
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      session!.id,
      'cursor',
      expect.objectContaining({
        cwd: 'C:/repo',
        resumeSessionId: 'cursor-123',
      }),
    );
    expect(registry.get(session!.id)?.status).toBe('ready');
  });

  it('serializes recently active discovered Cursor sessions as external observe-only sessions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T00:00:20Z'));

    try {
      const session = registry.upsertDiscovered('cursor-live', {
        providerName: 'cursor',
        cwd: 'C:/repo',
        summary: 'Live elsewhere',
        messageCount: 4,
        lastActivity: '2026-03-10T00:00:10Z',
      });

      const res = await app.request(`/sessions/${session!.id}`);

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.activity).toBe('interactive');
      expect(body.controlMode).toBe('observe_only');
      expect(body.attached).toBe(false);
      expect(body.controls).toMatchObject({
        canSend: false,
        canResume: false,
        canClose: false,
        canDelete: false,
        canRefresh: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks resuming a discovered Cursor session while it still appears active elsewhere', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T00:00:20Z'));

    try {
      const session = registry.upsertDiscovered('cursor-live', {
        providerName: 'cursor',
        cwd: 'C:/repo',
        summary: 'Live elsewhere',
        messageCount: 4,
        lastActivity: '2026-03-10T00:00:10Z',
      });

      const res = await app.request(`/sessions/${session!.id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('active outside cats-runtime');
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks deleting a discovered Cursor session while it still appears active elsewhere', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T00:00:20Z'));

    try {
      const session = registry.upsertDiscovered('cursor-live', {
        providerName: 'cursor',
        cwd: 'C:/repo',
        summary: 'Live elsewhere',
        messageCount: 4,
        lastActivity: '2026-03-10T00:00:10Z',
      });

      const res = await app.request(`/sessions/${session!.id}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('still active outside cats-runtime');
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts attached Cursor sessions into closing before the worker exits', async () => {
    const session = registry.create({
      providerName: 'cursor',
      cwd: 'C:/repo',
    });
    registry.updateStatus(session.id, 'ready');

    vi.mocked(pool.get).mockReturnValue({
      alive: true,
    } as never);

    const res = await app.request(`/sessions/${session.id}/close`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('closing');
    expect(registry.get(session.id)?.status).toBe('closing');
    expect(vi.mocked(pool.kill)).toHaveBeenCalledWith(session.id);
  });
});
