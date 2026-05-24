import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { KiloNativeSessionService } from '../backends/cli/kilo/KiloNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';

describe('Kilo native session management', () => {
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
    antigravityPath: 'agy',
    kiroPath: 'kiro-cli',
    kiloPath: 'kilo',
    opencodePath: 'opencode',
    kiloServerHost: '127.0.0.1',
    kiloServerPort: 4313,
    kiloServerStartupTimeoutMs: 10000,
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
    kiroDbPath: '~/AppData/Local/kiro-cli/data.sqlite3',
    kiroRuntime: {
      mode: 'native',
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
      antigravity: { path: 'agy', runner: 'auto', runtime: { mode: 'native' } },
      kiro: { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'native' } },
      kilo: { path: 'kilo', runner: 'auto', runtime: { mode: 'native' } },
      opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
      goose: { path: 'goose', runner: 'auto', runtime: { mode: 'native' } },
      pi: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } },
      junie: { path: 'junie', runner: 'auto', runtime: { mode: 'native' } },
    },
  });

  let registry: SessionRegistry;
  let pool: WorkerPool;
  let cursorNative: CursorNativeSessionService;
  let kiroNative: KiroNativeSessionService;
  let kiloNative: KiloNativeSessionService;
  let auggieSessions: AuggieSessionService;
  let opencodeNative: OpencodeNativeSessionService;
  let app: ReturnType<typeof createApp>;
  let attachedWorkers: Map<string, { alive: boolean }>;

  beforeEach(() => {
    runtimeRootDir = mkdtempSync(join(tmpdir(), 'kilo-management-runtime-'));
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
    kiloNative = {
      createSession: vi.fn(),
      listSessions: vi.fn(),
      listAllSessions: vi.fn(),
      getSession: vi.fn(),
      loadHistory: vi.fn(),
      deleteSession: vi.fn(),
      listPendingPermissions: vi.fn(),
      replyPermission: vi.fn(),
      listPendingQuestions: vi.fn(),
      rejectQuestion: vi.fn(),
      close: vi.fn(),
    } as unknown as KiloNativeSessionService;
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
      kiloNative,
      auggieSessions,
      opencodeNative,
    });
  });

  afterEach(() => {
    rmSync(runtimeRootDir, { recursive: true, force: true });
  });

  it('creates a native Kilo session through POST /sessions', async () => {
    vi.mocked(kiloNative.createSession).mockResolvedValue({
      providerSessionId: 'kilo-123',
      cwd: 'C:/repo',
      summary: 'Existing Kilo Session',
      messageCount: 0,
      lastActivity: '2026-03-09T00:00:00Z',
    });

    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'kilo',
        cwd: 'C:/repo',
        workspaceMode: 'shared',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.providerName).toBe('kilo');
    expect(body.providerSessionId).toBe('kilo-123');
    expect(body.status).toBe('ready');
    expect(body.origin).toBe('runtime');
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      expect.any(String),
      'kilo',
      expect.objectContaining({
        cwd: 'C:/repo',
        resumeSessionId: 'kilo-123',
      }),
      'native',
    );
  });

  it('loads Kilo history through the generic history route', async () => {
    const session = registry.upsertDiscovered('kilo-123', {
      providerName: 'kilo',
      cwd: 'C:/repo',
      summary: 'Existing Kilo Session',
      messageCount: 1,
    });
    vi.mocked(kiloNative.loadHistory).mockResolvedValue([
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

  it('deletes the native Kilo session before removing it from the registry', async () => {
    const session = registry.upsertDiscovered('kilo-123', {
      providerName: 'kilo',
      cwd: 'C:/repo',
      summary: 'Existing Kilo Session',
      messageCount: 1,
    });
    vi.mocked(kiloNative.deleteSession).mockResolvedValue(true);
    vi.mocked(kiloNative.getSession).mockResolvedValue(null);

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.nativeDeleted).toBe(true);
    expect(registry.get(session!.id)).toBeUndefined();
  });

  it('deletes Kilo sessions that are already gone even when native delete returns false', async () => {
    const session = registry.upsertDiscovered('kilo-gone', {
      providerName: 'kilo',
      cwd: 'C:/repo',
      summary: 'Existing Kilo Session',
      messageCount: 1,
    });
    vi.mocked(kiloNative.deleteSession).mockResolvedValue(false);
    vi.mocked(kiloNative.getSession).mockResolvedValue(null);

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(body.nativeDeleted).toBe(true);
    expect(registry.get(session!.id)).toBeUndefined();
  });

  it('deletes stale Kilo sessions even when their saved instance is no longer configured', async () => {
    const config = makeConfig();
    config.providerDefaultInstances = { kilo: 'docker-dev' };
    config.providerInstances = {
      kilo: {
        'docker-dev': {
          id: 'docker-dev',
          providerName: 'kilo',
          commandConfig: { path: 'kilo', runner: 'auto', runtime: { mode: 'native' } },
          kiloServerHost: '127.0.0.1',
          kiloServerPort: 4313,
          kiloServerStartupTimeoutMs: 10000,
        },
      },
    };

    app = createApp({
      config,
      registry,
      pool,
      cursorNative,
      kiroNative,
      kiloNative,
      auggieSessions,
      opencodeNative,
    });

    const session = registry.create({
      id: 'stale-kilo',
      providerName: 'kilo',
      providerInstanceId: 'native',
      cwd: 'C:/repo',
    });
    registry.setProviderSessionId(session.id, 'kilo-stale');
    registry.updateStatus(session.id, 'closed');

    const res = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(body.nativeDeleted).toBe(false);
    expect(registry.get(session.id)).toBeUndefined();
    expect(vi.mocked(kiloNative.deleteSession)).not.toHaveBeenCalled();
  });

  it('flushes deleted Kilo sessions to disk before returning success', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kilo-delete-persist-'));
    const sessionBaseDir = join(dataDir, 'sessions');
    const persistedRegistry = new SessionRegistry(dataDir, sessionBaseDir);

    try {
      app = createApp({
        config: {
          ...makeConfig(),
          sessionBaseDir,
        },
        registry: persistedRegistry,
        pool,
        cursorNative,
        kiroNative,
        kiloNative,
        auggieSessions,
        opencodeNative,
      });

      const session = persistedRegistry.create({
        id: 'persisted-kilo',
        providerName: 'kilo',
        cwd: 'C:/repo',
      });
      persistedRegistry.setProviderSessionId(session.id, 'kilo-persisted');
      persistedRegistry.updateStatus(session.id, 'closed');
      persistedRegistry.flush();

      vi.mocked(kiloNative.deleteSession).mockResolvedValue(true);
      vi.mocked(kiloNative.getSession).mockResolvedValue(null);

      const res = await app.request(`/sessions/${session.id}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const persisted = JSON.parse(
        readFileSync(join(dataDir, 'sessions.json'), 'utf-8'),
      ) as Array<{ id: string }>;
      expect(persisted.some((item) => item.id === session.id)).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('discovers existing Kilo sessions for a workspace', async () => {
    vi.mocked(kiloNative.listSessions).mockResolvedValue([
      {
        providerSessionId: 'kilo-abc',
        cwd: 'C:/repo',
        summary: 'Existing Kilo Session',
        messageCount: 3,
        lastActivity: '2026-03-09T00:00:00Z',
      },
    ]);

    const res = await app.request('/kilo/sessions/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: 'C:/repo' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      sessions: Array<{ providerSessionId: string; origin: string; controlMode: string }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].providerSessionId).toBe('kilo-abc');
    expect(body.sessions[0].origin).toBe('discovered');
    expect(body.sessions[0].controlMode).toBe('resume_only');
    expect(registry.list({ provider: 'kilo' })).toHaveLength(1);
  });
});
