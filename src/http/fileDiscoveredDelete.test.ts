import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRuntimeApp as createApp } from './app.js';
import { CodexSessionScanner } from '../backends/cli/discovery/CodexSessionScanner.js';
import { SessionScanner } from '../backends/cli/discovery/SessionScanner.js';
import { JunieSessionScanner } from '../backends/cli/junie/JunieSessionScanner.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';

describe('file-discovered session deletion', () => {
  let registry: SessionRegistry;
  let pool: WorkerPool;
  let cursorNative: CursorNativeSessionService;
  let kiroNative: KiroNativeSessionService;
  let auggieSessions: AuggieSessionService;
  let opencodeNative: OpencodeNativeSessionService;
  let app: ReturnType<typeof createApp>;
  let claudeProjectsDir: string;
  let codexSessionsDir: string;
  let copilotSessionsDir: string;
  let geminiRootDir: string;
  let geminiSessionsDir: string;
  let junieSessionsDir: string;
  let sessionBaseDir: string;

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
    auggieSessionsDir: '',
    claudeProjectsDir,
    codexSessionsDir,
    copilotSessionsDir,
    cursorChatsDir: '~/.cursor/chats',
    cursorRuntime: {
      mode: 'wsl',
      distro: 'Ubuntu',
    },
    geminiSessionsDir,
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
      kiro: { path: 'kiro-cli', runner: 'auto', runtime: { mode: 'native' } },
      opencode: { path: 'opencode', runner: 'auto', runtime: { mode: 'native' } },
    },
  });

  beforeEach(() => {
    claudeProjectsDir = join(tmpdir(), `claude-delete-test-${Date.now()}`);
    codexSessionsDir = join(tmpdir(), `codex-delete-test-${Date.now()}`);
    copilotSessionsDir = join(tmpdir(), `copilot-delete-test-${Date.now()}`);
    geminiRootDir = join(tmpdir(), `gemini-delete-test-${Date.now()}`);
    geminiSessionsDir = join(geminiRootDir, 'tmp');
    junieSessionsDir = join(tmpdir(), `junie-delete-test-${Date.now()}`);
    sessionBaseDir = join(tmpdir(), `cats-runtime-delete-test-${Date.now()}`, 'sessions');
    mkdirSync(claudeProjectsDir, { recursive: true });
    mkdirSync(codexSessionsDir, { recursive: true });
    mkdirSync(copilotSessionsDir, { recursive: true });
    mkdirSync(geminiSessionsDir, { recursive: true });
    mkdirSync(junieSessionsDir, { recursive: true });
    mkdirSync(sessionBaseDir, { recursive: true });

    registry = new SessionRegistry(undefined, sessionBaseDir);
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
    rmSync(claudeProjectsDir, { recursive: true, force: true });
    rmSync(codexSessionsDir, { recursive: true, force: true });
    rmSync(copilotSessionsDir, { recursive: true, force: true });
    rmSync(geminiRootDir, { recursive: true, force: true });
    rmSync(junieSessionsDir, { recursive: true, force: true });
    rmSync(sessionBaseDir, { recursive: true, force: true });
  });

  it('deletes discovered Claude sessions without leaving sessions-index entries behind', async () => {
    const projectDir = join(claudeProjectsDir, '-repo');
    mkdirSync(projectDir, { recursive: true });

    const sourcePath = join(projectDir, 'claude-delete.jsonl');
    const keepPath = join(projectDir, 'claude-keep.jsonl');
    writeFileSync(
      sourcePath,
      JSON.stringify({ type: 'user', message: { content: 'Delete me' }, cwd: 'C:/repo' }) + '\n',
    );
    writeFileSync(
      keepPath,
      JSON.stringify({ type: 'user', message: { content: 'Keep me' }, cwd: 'C:/repo' }) + '\n',
    );
    writeFileSync(
      join(projectDir, 'sessions-index.json'),
      JSON.stringify({
        'claude-delete': {
          cwd: 'C:/repo',
          summary: 'Delete me',
          message_count: 1,
          last_message_at: '2026-03-11T08:00:00Z',
        },
        'claude-keep': {
          cwd: 'C:/repo',
          summary: 'Keep me',
          message_count: 1,
          last_message_at: '2026-03-11T08:01:00Z',
        },
      }, null, 2),
    );

    const session = registry.upsertDiscovered('claude-delete', {
      providerName: 'claude',
      cwd: 'C:/repo',
      summary: 'Delete me',
      sourcePath,
      messageCount: 1,
    });

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(registry.get(session!.id)).toBeUndefined();
    expect(existsSync(sourcePath)).toBe(false);
    expect(existsSync(keepPath)).toBe(true);

    const discovered = await new SessionScanner(claudeProjectsDir).scan();
    expect(discovered.some((item) => item.providerSessionId === 'claude-delete')).toBe(false);
    expect(discovered.some((item) => item.providerSessionId === 'claude-keep')).toBe(true);
  });

  it('deletes runtime-owned Claude sessions before they can be rediscovered from provider files', async () => {
    const projectDir = join(claudeProjectsDir, '-repo');
    mkdirSync(projectDir, { recursive: true });

    const providerSourcePath = join(projectDir, 'claude-runtime-delete.jsonl');
    writeFileSync(
      providerSourcePath,
      JSON.stringify({ type: 'user', message: { content: 'Delete me' }, cwd: 'C:/repo' }) + '\n',
    );
    writeFileSync(
      join(projectDir, 'sessions-index.json'),
      JSON.stringify({
        'claude-runtime-delete': {
          cwd: 'C:/repo',
          summary: 'Delete me',
          message_count: 1,
          last_message_at: '2026-03-11T08:05:00Z',
        },
      }, null, 2),
    );

    const session = registry.create({
      id: 'runtime-claude-delete',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    registry.updateStatus(session.id, 'closed');
    registry.setProviderSessionId(session.id, 'claude-runtime-delete');

    const runtimeSourcePath = join(sessionBaseDir, 'history', `${session.id}.jsonl`);
    mkdirSync(join(sessionBaseDir, 'history'), { recursive: true });
    writeFileSync(
      runtimeSourcePath,
      JSON.stringify({ type: 'user', message: { content: 'Delete me' }, cwd: 'C:/repo' }) + '\n',
    );
    registry.setSourcePath(session.id, runtimeSourcePath);

    const res = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(body.cleanup).toEqual(expect.objectContaining({
      providerDiscoveryCleared: true,
      providerDiscoveryDeleteMode: 'full',
      providerDiscoveryHydration: {
        status: 'resolved_from_scan',
        attempted: true,
        sourcePathPresentBeforeDelete: false,
        sourcePathPresentAfterHydration: true,
      },
    }));
    expect(body.maintenance).toEqual(expect.objectContaining({
      cleanup: expect.objectContaining({
        providerDiscoveryCleared: true,
        providerDiscoveryDeleteMode: 'full',
        providerDiscoveryHydration: {
          status: 'resolved_from_scan',
          attempted: true,
          sourcePathPresentBeforeDelete: false,
          sourcePathPresentAfterHydration: true,
        },
      }),
    }));
    expect(registry.get(session.id)).toBeUndefined();
    expect(existsSync(runtimeSourcePath)).toBe(false);
    expect(existsSync(providerSourcePath)).toBe(false);

    const discovered = await new SessionScanner(claudeProjectsDir).scan();
    expect(discovered.some((item) => item.providerSessionId === 'claude-runtime-delete')).toBe(false);
  });

  it('uses registry-owned provider discovery locators before falling back to provider scans', async () => {
    const providerSourcePath = join(
      tmpdir(),
      `claude-runtime-delete-cached-${Date.now()}.jsonl`,
    );
    writeFileSync(
      providerSourcePath,
      JSON.stringify({ type: 'user', message: { content: 'Delete me' }, cwd: 'C:/repo' }) + '\n',
    );

    const session = registry.create({
      id: 'runtime-claude-delete-cached',
      providerName: 'claude',
      cwd: 'C:/repo',
    });

    const runtimeSourcePath = join(sessionBaseDir, 'history', `${session.id}.jsonl`);
    mkdirSync(join(sessionBaseDir, 'history'), { recursive: true });
    writeFileSync(
      runtimeSourcePath,
      JSON.stringify({ type: 'user', message: { content: 'Delete me' }, cwd: 'C:/repo' }) + '\n',
    );
    registry.setSourcePath(session.id, runtimeSourcePath);

    const merged = registry.upsertDiscovered('claude-runtime-delete-cached', {
      providerName: 'claude',
      cwd: 'C:/repo',
      sourcePath: providerSourcePath,
    });
    expect(merged?.id).toBe(session.id);
    registry.updateStatus(session.id, 'closed');

    const res = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(body.cleanup).toEqual(expect.objectContaining({
      providerDiscoveryCleared: true,
      providerDiscoveryDeleteMode: 'full',
      providerDiscoveryHydration: {
        status: 'resolved_from_registry_cache',
        attempted: true,
        sourcePathPresentBeforeDelete: false,
        sourcePathPresentAfterHydration: true,
      },
    }));
    expect(registry.get(session.id)).toBeUndefined();
    expect(existsSync(runtimeSourcePath)).toBe(false);
    expect(existsSync(providerSourcePath)).toBe(false);
  });

  it('surfaces registry-only delete diagnostics when provider discovery hydration cannot resolve a source path', async () => {
    const session = registry.create({
      id: 'runtime-claude-delete-unresolved',
      providerName: 'claude',
      cwd: 'C:/repo',
    });
    registry.updateStatus(session.id, 'closed');
    registry.setProviderSessionId(session.id, 'claude-runtime-delete-unresolved');

    const runtimeSourcePath = join(sessionBaseDir, 'history', `${session.id}.jsonl`);
    mkdirSync(join(sessionBaseDir, 'history'), { recursive: true });
    writeFileSync(
      runtimeSourcePath,
      JSON.stringify({ type: 'user', message: { content: 'Delete me' }, cwd: 'C:/repo' }) + '\n',
    );
    registry.setSourcePath(session.id, runtimeSourcePath);

    const res = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(body.cleanup).toEqual(expect.objectContaining({
      providerDiscoveryCleared: false,
      providerDiscoveryDeleteMode: 'registry_only',
      providerDiscoveryHydration: {
        status: 'unresolved',
        attempted: true,
        sourcePathPresentBeforeDelete: false,
        sourcePathPresentAfterHydration: false,
      },
    }));
    expect(body.maintenance).toEqual(expect.objectContaining({
      cleanup: expect.objectContaining({
        providerDiscoveryCleared: false,
        providerDiscoveryDeleteMode: 'registry_only',
        providerDiscoveryHydration: {
          status: 'unresolved',
          attempted: true,
          sourcePathPresentBeforeDelete: false,
          sourcePathPresentAfterHydration: false,
        },
      }),
    }));
    expect(registry.get(session.id)).toBeUndefined();
    expect(existsSync(runtimeSourcePath)).toBe(false);
  });

  it('deletes runtime-owned Codex sessions before they can be rediscovered from rollout files', async () => {
    const providerSourcePath = join(
      codexSessionsDir,
      '2026',
      '03',
      '11',
      'rollout-thread-runtime-delete.jsonl',
    );
    mkdirSync(join(codexSessionsDir, '2026', '03', '11'), { recursive: true });
    writeFileSync(
      providerSourcePath,
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: 'thread-runtime-delete', cwd: 'C:/repo' },
          timestamp: '2026-03-11T08:10:00.000Z',
        }),
        JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: 'Delete me' },
          timestamp: '2026-03-11T08:10:01.000Z',
        }),
      ].join('\n') + '\n',
    );

    const session = registry.create({
      id: 'runtime-codex-delete',
      providerName: 'codex',
      cwd: 'C:/repo',
    });
    registry.updateStatus(session.id, 'closed');
    registry.setProviderSessionId(session.id, 'thread-runtime-delete');

    const runtimeSourcePath = join(sessionBaseDir, 'history', `${session.id}.jsonl`);
    mkdirSync(join(sessionBaseDir, 'history'), { recursive: true });
    writeFileSync(
      runtimeSourcePath,
      JSON.stringify({ type: 'user', message: { content: 'Delete me' }, cwd: 'C:/repo' }) + '\n',
    );
    registry.setSourcePath(session.id, runtimeSourcePath);

    const res = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(registry.get(session.id)).toBeUndefined();
    expect(existsSync(runtimeSourcePath)).toBe(false);
    expect(existsSync(providerSourcePath)).toBe(false);

    const discovered = await new CodexSessionScanner(codexSessionsDir).scan();
    expect(discovered.some((item) => item.providerSessionId === 'thread-runtime-delete')).toBe(false);
  });

  it('deletes discovered Copilot directory sessions so they cannot be rediscovered', async () => {
    const sessionDir = join(copilotSessionsDir, 'copilot-delete');
    const workspacePath = join(sessionDir, 'workspace.yaml');
    const eventsPath = join(sessionDir, 'events.jsonl');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      workspacePath,
      [
        'id: copilot-delete',
        'cwd: C:/repo',
        'summary: Delete me',
        'updated_at: 2026-03-11T08:00:00Z',
      ].join('\n'),
    );
    writeFileSync(
      eventsPath,
      JSON.stringify({ type: 'user.message', data: { timestamp: '2026-03-11T08:00:01Z' } }) + '\n',
    );

    const session = registry.upsertDiscovered('copilot-delete', {
      providerName: 'copilot',
      cwd: 'C:/repo',
      summary: 'Delete me',
      sourcePath: workspacePath,
      messageCount: 1,
    });

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(registry.get(session!.id)).toBeUndefined();
    expect(existsSync(workspacePath)).toBe(false);
    expect(existsSync(eventsPath)).toBe(false);
  });

  it('deletes discovered Gemini session files so they cannot be rediscovered', async () => {
    const historyDir = join(geminiRootDir, 'history', 'repo-slug');
    const chatsDir = join(geminiSessionsDir, 'repo-slug', 'chats');
    mkdirSync(historyDir, { recursive: true });
    mkdirSync(chatsDir, { recursive: true });
    writeFileSync(join(historyDir, '.project_root'), 'C:/repo');

    const sourcePath = join(chatsDir, 'session-gemini-delete.json');
    writeFileSync(
      sourcePath,
      JSON.stringify({
        sessionId: 'gemini-delete',
        messages: [
          {
            type: 'user',
            content: 'Delete me',
            timestamp: '2026-03-11T08:10:00Z',
          },
        ],
      }),
    );

    const session = registry.upsertDiscovered('gemini-delete', {
      providerName: 'gemini',
      cwd: 'C:/repo',
      summary: 'Delete me',
      sourcePath,
      messageCount: 1,
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

  it('deletes discovered Junie sessions without leaving index entries behind', async () => {
    const sessionDir = join(junieSessionsDir, 'junie-delete');
    const keepDir = join(junieSessionsDir, 'junie-keep');
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(keepDir, { recursive: true });

    const sourcePath = join(sessionDir, 'events.jsonl');
    const keepPath = join(keepDir, 'events.jsonl');
    writeFileSync(sourcePath, JSON.stringify({ type: 'user', text: 'Delete me' }) + '\n');
    writeFileSync(keepPath, JSON.stringify({ type: 'user', text: 'Keep me' }) + '\n');
    writeFileSync(
      join(junieSessionsDir, 'index.jsonl'),
      [
        JSON.stringify({
          sessionId: 'junie-delete',
          createdAt: '2026-03-11T08:20:00Z',
          updatedAt: '2026-03-11T08:21:00Z',
          projectDir: 'C:/repo',
          taskName: 'Delete me',
        }),
        JSON.stringify({
          sessionId: 'junie-keep',
          createdAt: '2026-03-11T08:30:00Z',
          updatedAt: '2026-03-11T08:31:00Z',
          projectDir: 'C:/repo',
          taskName: 'Keep me',
        }),
      ].join('\n') + '\n',
    );

    const session = registry.upsertDiscovered('junie-delete', {
      providerName: 'junie',
      cwd: 'C:/repo',
      summary: 'Delete me',
      sourcePath,
      messageCount: 1,
    });

    const res = await app.request(`/sessions/${session!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('deleted');
    expect(registry.get(session!.id)).toBeUndefined();
    expect(existsSync(sourcePath)).toBe(false);
    expect(existsSync(keepPath)).toBe(true);

    const discovered = await new JunieSessionScanner(junieSessionsDir).scan();
    expect(discovered.some((item) => item.providerSessionId === 'junie-delete')).toBe(false);
    expect(discovered.some((item) => item.providerSessionId === 'junie-keep')).toBe(true);
  });
});
