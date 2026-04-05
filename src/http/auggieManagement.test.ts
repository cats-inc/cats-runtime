import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';

describe('Auggie native session management', () => {
  let runtimeRootDir = '';
  let dataDir = '';
  let sessionBaseDir = '';

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
    dataDir,
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
  let attachedWorkers: Map<string, { alive: boolean }>;

  beforeEach(() => {
    runtimeRootDir = mkdtempSync(join(tmpdir(), 'auggie-management-runtime-'));
    dataDir = join(runtimeRootDir, 'data');
    sessionBaseDir = join(runtimeRootDir, 'sessions');
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

  afterEach(() => {
    rmSync(runtimeRootDir, { recursive: true, force: true });
  });

  it('loads Auggie history through the generic history route', async () => {
    const session = registry.upsertDiscovered('auggie-123', {
      providerName: 'auggie',
      cwd: 'C:/repo',
      summary: 'Existing Auggie Session',
      sourcePath: 'C:/Users/kenne/.augment/sessions/auggie-123.json',
      messageCount: 1,
    });
    vi.mocked(auggieSessions.loadHistory).mockResolvedValue([
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
    expect(vi.mocked(auggieSessions.loadHistory)).toHaveBeenCalledWith({
      providerSessionId: 'auggie-123',
      sourcePath: 'C:/Users/kenne/.augment/sessions/auggie-123.json',
    });
  });

  it('deletes discovered Auggie session files so they cannot be rediscovered', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'auggie-delete-'));
    const sourcePath = join(tempDir, 'auggie-123.json');
    writeFileSync(sourcePath, JSON.stringify({ sessionId: 'auggie-123', chatHistory: [{}] }));

    const session = registry.upsertDiscovered('auggie-123', {
      providerName: 'auggie',
      cwd: 'C:/repo',
      summary: 'Existing Auggie Session',
      sourcePath,
      messageCount: 1,
    });

    vi.mocked(auggieSessions.getSession).mockImplementation(async (providerSessionId: string) => (
      providerSessionId === 'auggie-123' && existsSync(sourcePath)
        ? {
          providerSessionId: 'auggie-123',
          cwd: 'C:/repo',
          sourcePath,
          summary: 'Existing Auggie Session',
          messageCount: 1,
          exchangeCount: 1,
        }
        : null
    ));

    try {
      const res = await app.request(`/sessions/${session!.id}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe('deleted');
      expect(registry.get(session!.id)).toBeUndefined();
      expect(existsSync(sourcePath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('discovers existing Auggie sessions for a workspace', async () => {
    vi.mocked(auggieSessions.listSessions).mockResolvedValue([
      {
        providerSessionId: 'auggie-abc',
        cwd: 'C:/repo',
        sourcePath: 'C:/Users/kenne/.augment/sessions/auggie-abc.json',
        summary: 'Existing Auggie Session',
        messageCount: 3,
        exchangeCount: 3,
        lastActivity: '2026-03-09T00:00:00Z',
        model: 'gpt5.4',
      },
    ]);

    const res = await app.request('/auggie/sessions/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: 'C:/repo' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      sessions: Array<{ providerSessionId: string; origin: string; controlMode: string; resumeStrategy: string }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].providerSessionId).toBe('auggie-abc');
    expect(body.sessions[0].origin).toBe('discovered');
    expect(body.sessions[0].controlMode).toBe('resume_only');
    expect(body.sessions[0].resumeStrategy).toBe('provider_session');
    expect(registry.list({ provider: 'auggie' })).toHaveLength(1);
  });

  it('inspects all Auggie sessions when cwd is omitted', async () => {
    vi.mocked(auggieSessions.listAllSessions).mockResolvedValue([
      {
        providerSessionId: 'auggie-global-1',
        cwd: 'C:/Users/kenne/Source/SK2/one-man-digital-company',
        sourcePath: 'C:/Users/kenne/.augment/sessions/auggie-global-1.json',
        summary: 'Global Auggie Session',
        messageCount: 4,
        exchangeCount: 4,
      },
    ]);

    const res = await app.request('/auggie/sessions');

    expect(res.status).toBe(200);
    const body = await res.json() as { sessions: Array<{ providerSessionId: string; cwd: string }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].providerSessionId).toBe('auggie-global-1');
    expect(body.sessions[0].cwd).toBe('C:/Users/kenne/Source/SK2/one-man-digital-company');
  });

  it('resumes a discovered Auggie session through the generic resume route', async () => {
    const session = registry.upsertDiscovered('auggie-123', {
      providerName: 'auggie',
      cwd: 'C:/repo',
      summary: 'Existing Auggie Session',
      messageCount: 1,
      lastActivity: '2026-03-09T00:00:00Z',
    });

    const res = await app.request(`/sessions/${session!.id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.controlMode).toBe('full');
    expect(body.ownership).toBe('logical_session');
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      session!.id,
      'auggie',
      expect.objectContaining({
        cwd: 'C:/repo',
        resumeSessionId: 'auggie-123',
      }),
      undefined,
    );
    expect(registry.get(session!.id)?.status).toBe('initializing');
  });
});
