import { withSelectedCliProviders } from '../../tests/support/selectedCliFixture.js';
import { mkdtempSync, rmSync } from 'node:fs';
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

describe('Kiro native session management', () => {
  let runtimeRootDir = '';
  let dataDir = '';
  let sessionBaseDir = '';

  const makeConfig = (): CliRuntimeConfig => withSelectedCliProviders(({
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
    kiroSessionsDir: '~/.kiro/sessions',
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
      opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
    },
  }));

  let registry: SessionRegistry;
  let pool: WorkerPool;
  let cursorNative: CursorNativeSessionService;
  let kiroNative: KiroNativeSessionService;
  let auggieSessions: AuggieSessionService;
  let opencodeNative: OpencodeNativeSessionService;
  let app: ReturnType<typeof createApp>;
  let attachedWorkers: Map<string, { alive: boolean }>;

  beforeEach(() => {
    runtimeRootDir = mkdtempSync(join(tmpdir(), 'kiro-management-runtime-'));
    dataDir = join(runtimeRootDir, 'data');
    sessionBaseDir = join(runtimeRootDir, 'sessions');
    registry = new SessionRegistry();
    attachedWorkers = new Map();
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: false, permissions: false })),
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

  it('creates a managed Kiro session through POST /sessions', async () => {
    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'kiro',
        cwd: 'C:/repo',
        workspaceMode: 'shared',
        model: 'claude-sonnet-4.5',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.providerName).toBe('kiro');
    expect(body.status).toBe('initializing');
    expect(body.origin).toBe('runtime');
    expect(body.controlMode).toBe('full');
    expect(body.ownership).toBe('logical_session');
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      expect.any(String),
      'kiro',
      expect.objectContaining({
        cwd: 'C:/repo',
        model: 'claude-sonnet-4.5',
      }),
      'native',
    );
  });

  it('loads Kiro history through the generic history route', async () => {
    const session = registry.upsertDiscovered('sess_123', {
      providerName: 'kiro',
      cwd: 'C:/repo',
      summary: 'Existing Kiro Session',
      messageCount: 1,
    });
    vi.mocked(kiroNative.loadHistory).mockResolvedValue([
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
    expect(vi.mocked(kiroNative.loadHistory)).toHaveBeenCalledWith('sess_123');
  });

  it('deletes the native Kiro session by id before removing it from the registry', async () => {
    const session = registry.upsertDiscovered('sess_123', {
      providerName: 'kiro',
      cwd: 'C:/repo',
      summary: 'Existing Kiro Session',
      messageCount: 1,
    });
    vi.mocked(kiroNative.deleteSession).mockResolvedValue(true);
    vi.mocked(kiroNative.listSessions).mockResolvedValue([]);

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.nativeDeleted).toBe(true);
    expect(vi.mocked(kiroNative.deleteSession)).toHaveBeenCalledWith('sess_123');
    expect(registry.get(session!.id)).toBeUndefined();
  });

  it('deletes Kiro sessions that are already gone even when native delete returns false', async () => {
    const session = registry.upsertDiscovered('sess_gone', {
      providerName: 'kiro',
      cwd: 'C:/repo',
      summary: 'Existing Kiro Session',
      messageCount: 1,
    });
    vi.mocked(kiroNative.deleteSession).mockResolvedValue(false);
    vi.mocked(kiroNative.listSessions).mockResolvedValue([]);

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(body.nativeDeleted).toBe(true);
    expect(registry.get(session!.id)).toBeUndefined();
  });

  it('discovers existing Kiro sessions for a workspace', async () => {
    vi.mocked(kiroNative.listSessions).mockResolvedValue([
      {
        providerSessionId: 'sess_abc',
        cwd: 'C:/repo',
        summary: 'Existing Kiro Session',
        messageCount: 3,
        lastActivity: '2026-03-09T00:00:00Z',
        model: 'claude-sonnet-4.5',
      },
    ]);

    const res = await app.request('/kiro/sessions/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: 'C:/repo' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      sessions: Array<{ providerSessionId: string; origin: string; controlMode: string; resumeStrategy: string }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].providerSessionId).toBe('sess_abc');
    expect(body.sessions[0].origin).toBe('discovered');
    expect(body.sessions[0].controlMode).toBe('resume_only');
    expect(body.sessions[0].resumeStrategy).toBe('provider_session');
    expect(registry.list({ provider: 'kiro' })).toHaveLength(1);
  });

  it('passes startIfNeeded=false to Kiro manual discovery', async () => {
    vi.mocked(kiroNative.listSessions).mockResolvedValue([]);

    const res = await app.request('/kiro/sessions/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: 'C:/repo', startIfNeeded: false }),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(kiroNative.listSessions)).toHaveBeenCalledWith(
      'C:/repo',
      { startIfNeeded: false },
    );
  });

  it('inspects Kiro model options for the configured runtime', async () => {
    const res = await app.request('/kiro/models');

    expect(res.status).toBe(200);
    const body = await res.json() as {
      instance: string;
      runtime: { mode: string; distro?: string };
      source: string;
      models: string[];
    };
    expect(body.instance).toBe('native');
    expect(body.runtime).toEqual({
      mode: 'native',
    });
    expect(body.source).toBe('static');
    // Complete Kiro 2.27.1 picker order, raw IDs verbatim.
    expect(body.models).toEqual([
      'auto', 'claude-opus-5.5', 'claude-sonnet-5.5', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4.8',
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'claude-opus-4.7', 'claude-opus-4.6',
      'claude-sonnet-4.6', 'claude-opus-4.5', 'claude-sonnet-4.5', 'claude-sonnet-4',
      'claude-haiku-4.5', 'deepseek-3.2', 'minimax-m2.5', 'minimax-m2.1', 'glm-5', 'qwen3-coder-next',
    ]);
  });

  it('returns 400 when a requested Kiro instance does not exist', async () => {
    const res = await app.request('/kiro/models?instance=missing');
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("Unknown kiro instance 'missing'");
  });

  it('resumes any discovered Kiro session by id, newest in its workspace or not', async () => {
    registry.upsertDiscovered('sess_new', {
      providerName: 'kiro',
      cwd: 'C:/repo',
      summary: 'Newer Kiro Session',
      messageCount: 1,
      lastActivity: '2026-10-13T13:00:00Z',
    });
    const older = registry.upsertDiscovered('sess_old', {
      providerName: 'kiro',
      cwd: 'C:/repo',
      summary: 'Older Kiro Session',
      messageCount: 1,
      lastActivity: '2026-10-13T12:00:00Z',
    });

    const res = await app.request(`/sessions/${older!.id}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.controlMode).toBe('full');
    expect(body.ownership).toBe('logical_session');
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      older!.id,
      'kiro',
      expect.objectContaining({
        cwd: 'C:/repo',
        resumeSessionId: 'sess_old',
      }),
      undefined,
    );
    // The generic CLI resume path reports ready once the worker's first event arrives.
    expect(registry.get(older!.id)?.status).toBe('initializing');
  });
});
