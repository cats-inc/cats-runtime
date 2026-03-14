import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';

describe('OpenCode native session management', () => {
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
      getCapabilities: vi.fn(() => ({ resume: true, fork: false, permissions: true })),
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

  it('creates a native OpenCode session through POST /sessions', async () => {
    vi.mocked(opencodeNative.createSession).mockResolvedValue({
      providerSessionId: 'oc-123',
      cwd: 'C:/repo',
      summary: 'Existing OpenCode Session',
      messageCount: 0,
      lastActivity: '2026-03-09T00:00:00Z',
    });

    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'opencode',
        cwd: 'C:/repo',
        workspaceMode: 'shared',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.providerName).toBe('opencode');
    expect(body.providerSessionId).toBe('oc-123');
    expect(body.status).toBe('ready');
    expect(body.origin).toBe('runtime');
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      expect.any(String),
      'opencode',
      expect.objectContaining({
        cwd: 'C:/repo',
        resumeSessionId: 'oc-123',
      }),
    );
  });

  it('loads OpenCode history through the generic history route', async () => {
    const session = registry.upsertDiscovered('oc-123', {
      providerName: 'opencode',
      cwd: 'C:/repo',
      summary: 'Existing OpenCode Session',
      messageCount: 1,
    });
    vi.mocked(opencodeNative.loadHistory).mockResolvedValue([
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

  it('deletes the native OpenCode session before removing it from the registry', async () => {
    const session = registry.upsertDiscovered('oc-123', {
      providerName: 'opencode',
      cwd: 'C:/repo',
      summary: 'Existing OpenCode Session',
      messageCount: 1,
    });
    vi.mocked(opencodeNative.deleteSession).mockResolvedValue(true);
    vi.mocked(opencodeNative.getSession).mockResolvedValue(null);

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.nativeDeleted).toBe(true);
    expect(registry.get(session!.id)).toBeUndefined();
  });

  it('discovers existing OpenCode sessions for a workspace', async () => {
    vi.mocked(opencodeNative.listSessions).mockResolvedValue([
      {
        providerSessionId: 'oc-abc',
        cwd: 'C:/repo',
        summary: 'Existing OpenCode Session',
        messageCount: 3,
        lastActivity: '2026-03-09T00:00:00Z',
      },
    ]);

    const res = await app.request('/opencode/sessions/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: 'C:/repo' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      sessions: Array<{ providerSessionId: string; origin: string; controlMode: string }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].providerSessionId).toBe('oc-abc');
    expect(body.sessions[0].origin).toBe('discovered');
    expect(body.sessions[0].controlMode).toBe('resume_only');
    expect(registry.list({ provider: 'opencode' })).toHaveLength(1);
  });
});
