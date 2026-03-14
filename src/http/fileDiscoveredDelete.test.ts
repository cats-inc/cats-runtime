import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

describe('file-discovered session deletion', () => {
  let registry: SessionRegistry;
  let pool: WorkerPool;
  let cursorNative: CursorNativeSessionService;
  let kiroNative: KiroNativeSessionService;
  let auggieSessions: AuggieSessionService;
  let opencodeNative: OpencodeNativeSessionService;
  let app: ReturnType<typeof createApp>;
  let copilotSessionsDir: string;
  let geminiRootDir: string;
  let geminiSessionsDir: string;

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
    claudeProjectsDir: '',
    codexSessionsDir: '',
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

  beforeEach(() => {
    copilotSessionsDir = join(tmpdir(), `copilot-delete-test-${Date.now()}`);
    geminiRootDir = join(tmpdir(), `gemini-delete-test-${Date.now()}`);
    geminiSessionsDir = join(geminiRootDir, 'tmp');
    mkdirSync(copilotSessionsDir, { recursive: true });
    mkdirSync(geminiSessionsDir, { recursive: true });

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
    rmSync(copilotSessionsDir, { recursive: true, force: true });
    rmSync(geminiRootDir, { recursive: true, force: true });
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
});
