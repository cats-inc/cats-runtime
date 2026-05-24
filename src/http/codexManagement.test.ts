import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeApp as createApp } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';

describe('codex management', () => {
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
    opencodePath: 'opencode',
    opencodeServerHost: '127.0.0.1',
    opencodeServerPort: 4097,
    opencodeServerStartupTimeoutMs: 10000,
    auggieSessionsDir: '~/.augment/sessions',
    claudeProjectsDir: '',
    codexSessionsDir: codexSessionsDir,
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
  let codexSessionsDir: string;
  let codexUbuntuSessionsDir: string;

  beforeEach(() => {
    runtimeRootDir = mkdtempSync(join(tmpdir(), 'codex-management-runtime-'));
    dataDir = join(runtimeRootDir, 'data');
    sessionBaseDir = join(runtimeRootDir, 'sessions');
    codexSessionsDir = join(tmpdir(), `codex-management-test-${Date.now()}`);
    codexUbuntuSessionsDir = join(tmpdir(), `codex-management-test-ubuntu-${Date.now()}`);
    mkdirSync(codexSessionsDir, { recursive: true });
    mkdirSync(codexUbuntuSessionsDir, { recursive: true });

    registry = new SessionRegistry();
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => undefined),
      spawn: vi.fn(),
      kill: vi.fn(),
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
    rmSync(codexSessionsDir, { recursive: true, force: true });
    rmSync(codexUbuntuSessionsDir, { recursive: true, force: true });
  });

  function writeCodexSessionFile(input: {
    sessionId: string;
    cwd: string;
    summary: string;
    timestamp: string;
  }, baseDir = codexSessionsDir): void {
    const dayDir = join(baseDir, '2026', '03', '11');
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(
      join(dayDir, `rollout-${input.sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: '2026-03-11T08:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: input.sessionId,
            cwd: input.cwd,
          },
        }),
        JSON.stringify({
          timestamp: input.timestamp,
          type: 'event_msg',
          payload: { type: 'user_message', message: input.summary },
        }),
      ].join('\n') + '\n',
    );
  }

  it('inspects Codex sessions from rollout files without mutating the registry', async () => {
    writeCodexSessionFile({
      sessionId: 'thread-inspect',
      cwd: 'C:/repo',
      summary: 'Inspect me',
      timestamp: '2026-03-11T08:01:00.000Z',
    });

    const res = await app.request('/codex/sessions?cwd=C:/repo');
    const body = await res.json() as {
      sessions: Array<{ providerSessionId: string; cwd: string }>;
      count: number;
    };

    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.sessions[0]).toMatchObject({
      providerSessionId: 'thread-inspect',
      cwd: 'C:/repo',
    });
    expect(registry.list()).toHaveLength(0);
  });

  it('discovers Codex sessions into the registry on demand', async () => {
    writeCodexSessionFile({
      sessionId: 'thread-discover',
      cwd: 'C:/repo',
      summary: 'Discover me',
      timestamp: '2026-03-11T08:02:00.000Z',
    });

    const res = await app.request('/codex/sessions/discover', {
      method: 'POST',
      body: JSON.stringify({ cwd: 'C:/repo', group: 'backend' }),
      headers: { 'content-type': 'application/json' },
    });
    const body = await res.json() as {
      sessions: Array<{ providerName: string; controlMode: string; group?: string }>;
      count: number;
    };

    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.sessions[0].providerName).toBe('codex');
    expect(body.sessions[0].controlMode).toBe('resume_only');
    expect(body.sessions[0].group).toBe('backend');
    expect(registry.list({ provider: 'codex' })).toHaveLength(1);
  });

  it('uses the requested Codex instance for inspect and manual discovery', async () => {
    writeCodexSessionFile({
      sessionId: 'thread-ubuntu',
      cwd: 'C:/repo',
      summary: 'Ubuntu only',
      timestamp: '2026-03-11T08:02:00.000Z',
    }, codexUbuntuSessionsDir);

    const config = makeConfig();
    config.providerDefaultInstances = {
      codex: 'native',
    };
    config.providerInstances = {
      codex: {
        native: {
          id: 'native',
          providerName: 'codex',
          commandConfig: config.providerCommands.codex,
          codexSessionsDir,
        },
        ubuntu: {
          id: 'ubuntu',
          providerName: 'codex',
          commandConfig: {
            ...config.providerCommands.codex,
            runtime: { mode: 'wsl', distro: 'Ubuntu' },
          },
          codexSessionsDir: codexUbuntuSessionsDir,
        },
      },
    };
    app = createApp({
      config,
      registry,
      pool,
      cursorNative,
      kiroNative,
      auggieSessions,
      opencodeNative,
    });

    const inspectRes = await app.request('/codex/sessions?instance=ubuntu');
    const inspectBody = await inspectRes.json() as {
      sessions: Array<{ providerSessionId: string }>;
      count: number;
    };
    expect(inspectRes.status).toBe(200);
    expect(inspectBody.count).toBe(1);
    expect(inspectBody.sessions[0].providerSessionId).toBe('thread-ubuntu');

    const discoverRes = await app.request('/codex/sessions/discover', {
      method: 'POST',
      body: JSON.stringify({ instance: 'ubuntu' }),
      headers: { 'content-type': 'application/json' },
    });
    const discoverBody = await discoverRes.json() as {
      sessions: Array<{ providerInstanceId?: string; providerSessionId: string }>;
      count: number;
    };
    expect(discoverRes.status).toBe(200);
    expect(discoverBody.count).toBe(1);
    expect(discoverBody.sessions[0].providerSessionId).toBe('thread-ubuntu');
    expect(discoverBody.sessions[0].providerInstanceId).toBe('ubuntu');
    expect(registry.list({ provider: 'codex' })[0]?.providerInstanceId).toBe('ubuntu');
  });

  it('returns 400 when a requested Codex instance does not exist', async () => {
    const res = await app.request('/codex/sessions?instance=missing');
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("Unknown codex instance 'missing'");
  });

  it('serializes discovered Codex sessions as resume_only', async () => {
    registry.upsertDiscovered('thread-123', {
      cwd: 'C:/repo',
      providerName: 'codex',
      summary: 'Investigate build issue',
      messageCount: 4,
      sourcePath: 'C:/Users/test/.codex/sessions/2026/03/11/thread-123.jsonl',
    });

    const res = await app.request('/sessions');
    const body = await res.json() as {
      sessions: Array<{ providerName: string; controlMode: string; resumeStrategy: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.sessions[0].providerName).toBe('codex');
    expect(body.sessions[0].controlMode).toBe('resume_only');
    expect(body.sessions[0].resumeStrategy).toBe('provider_session');
  });

  it('fully deletes a session with no transcript or native state', async () => {
    const session = registry.create({
      providerName: 'codex',
      cwd: 'C:/repo',
    });

    const res = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(body.hadTranscript).toBe(false);
    expect(body.fileDeleted).toBe(false);
    expect(registry.get(session.id)).toBeUndefined();
  });

  it('deletes discovered Codex rollout files so they cannot be rediscovered', async () => {
    writeCodexSessionFile({
      sessionId: 'thread-delete',
      cwd: 'C:/repo',
      summary: 'Delete me',
      timestamp: '2026-03-11T08:03:00.000Z',
    });

    const sourcePath = join(codexSessionsDir, '2026', '03', '11', 'rollout-thread-delete.jsonl');
    const session = registry.upsertDiscovered('thread-delete', {
      cwd: 'C:/repo',
      providerName: 'codex',
      summary: 'Delete me',
      messageCount: 1,
      sourcePath,
    });

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(registry.get(session!.id)).toBeUndefined();
    expect(existsSync(sourcePath)).toBe(false);
  });

  it('resumes a discovered Codex session through the generic resume route', async () => {
    const session = registry.upsertDiscovered('thread-456', {
      cwd: 'C:/repo',
      providerName: 'codex',
      sourcePath: 'C:/Users/test/.codex/sessions/2026/03/11/thread-456.jsonl',
    });

    const res = await app.request(`/sessions/${session!.id}/resume`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(session!.id, 'codex', {
      cwd: 'C:/repo',
      workspaceMode: 'shared',
      model: undefined,
      resumeSessionId: 'thread-456',
      permissionMode: 'skip',
    }, undefined);
  });

  it('forks a runtime-owned Codex session through the generic fork route', async () => {
    const session = registry.create({
      id: 'codex-runtime-1',
      providerName: 'codex',
      cwd: 'C:/repo',
      workspaceMode: 'shared',
      model: 'gpt-5.4',
    });
    registry.setProviderSessionId(session.id, 'thread-parent');
    registry.updateStatus(session.id, 'closed');

    const res = await app.request(`/sessions/${session.id}/fork`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(201);
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      expect.any(String),
      'codex',
      {
        cwd: 'C:/repo',
        workspaceMode: 'shared',
        model: 'gpt-5.4',
        resumeSessionId: 'thread-parent',
        forkSession: true,
        permissionMode: 'skip',
      },
      'native',
    );
  });
});
