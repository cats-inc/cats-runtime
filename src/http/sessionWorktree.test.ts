import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeApp as createApp, type AppContext } from './app.js';
import { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import { RuntimeWakeupService } from '../core/wakeup/RuntimeWakeupService.js';
import {
  cleanupSessionWorkspace,
  prepareSessionWorkspace,
} from '../core/workspace/sessionWorkspace.js';

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  }

  return result.stdout.trim();
}

function createGitWorkspace(rootDir: string, repoName: string): string {
  const repoDir = join(rootDir, repoName);
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(repoDir, 'tracked.txt'), 'initial\n', 'utf8');

  runGit(repoDir, ['init']);
  runGit(repoDir, ['config', 'user.email', 'cats-runtime@example.test']);
  runGit(repoDir, ['config', 'user.name', 'Cats Runtime Test']);
  runGit(repoDir, ['add', '.']);
  runGit(repoDir, ['commit', '-m', 'initial']);

  return repoDir;
}

function buildHydration(runtimeCwd: string, sourceCwd: string) {
  return {
    trigger: 'create' as const,
    updatedAt: '2026-03-23T00:00:00.000Z',
    workspace: {
      isolationMode: 'worktree' as const,
      runtimeCwd,
      sourceCwd,
      sourceOfTruth: 'source_workspace' as const,
      substrate: {
        auditPath: sourceCwd,
        profile: 'standard' as const,
        status: 'present' as const,
        checkedAt: '2026-03-23T00:00:00.000Z',
        changedPaths: [],
        reviewCopyPaths: [],
        findingCounts: {
          missing: 0,
          present: 0,
          drifted: 0,
          conflicting: 0,
        },
      },
      warnings: [],
    },
  };
}

describe('session worktree routes', () => {
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
  let rootDir: string;
  let sessionBaseDir: string;
  let dataDir: string;
  let wakeup: RuntimeWakeupService;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-session-worktree-'));
    sessionBaseDir = join(rootDir, 'sessions');
    dataDir = join(rootDir, 'data');
    mkdirSync(sessionBaseDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });

    registry = new SessionRegistry();
    pool = {
      getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
      get: vi.fn(() => undefined),
      isAttached: vi.fn(() => false),
      spawn: vi.fn(),
      cancel: vi.fn(),
      kill: vi.fn(),
      killAll: vi.fn(),
      status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
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

  it('creates a worktree-backed runtime session through POST /sessions', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-create');

    const response = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'codex',
        cwd: repoDir,
        workspaceMode: 'shared',
        workspaceIsolation: 'worktree',
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      id: string;
      cwd: string;
      workspaceMode: string;
      workspaceIsolation: {
        mode: string;
        sourceCwd: string;
        worktree: { worktreePath: string };
      };
      hydration: {
        workspace: {
          isolationMode: string;
          runtimeCwd: string;
          sourceCwd: string;
        };
      };
    };
    expect(body.workspaceMode).toBe('shared');
    expect(body.workspaceIsolation.mode).toBe('worktree');
    expect(body.workspaceIsolation.sourceCwd).toBe(repoDir);
    expect(body.hydration.workspace).toEqual(expect.objectContaining({
      isolationMode: 'worktree',
      runtimeCwd: body.cwd,
      sourceCwd: repoDir,
    }));
    expect(body.cwd).toContain(join('sessions', 'worktrees'));
    expect(existsSync(body.workspaceIsolation.worktree.worktreePath)).toBe(true);
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      body.id,
      'codex',
      expect.objectContaining({
        cwd: body.cwd,
        workspaceMode: 'shared',
      }),
      undefined,
    );
  });

  it('resets a worktree-backed session and discards the runtime worktree', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-reset');
    const prepared = prepareSessionWorkspace({
      sessionId: 'worktree-reset',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    const session = registry.create({
      id: 'worktree-reset',
      providerName: 'codex',
      cwd: prepared.cwd,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      hydration: buildHydration(prepared.cwd, repoDir),
    });
    registry.setProviderSessionId(session.id, 'thread-reset');
    registry.setProviderState(session.id, {
      geminiCachedContent: {
        name: 'cachedContents/worktree-reset',
        key: 'cache-key',
        model: 'gemini-3-flash-preview',
        prefixMessageCount: 1,
      },
    });
    registry.updateStatus(session.id, 'closed');

    writeFileSync(join(prepared.cwd, 'tracked.txt'), 'discard me\n', 'utf8');

    const response = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'discard',
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      action: string;
      providerSessionId?: string;
      hydration?: unknown;
      inspection: {
        maintenance: {
          lastLifecycle: {
            cleanup: {
              workspaceCleaned: boolean;
              worktreeDetached: boolean;
              worktreeCleanupPolicy: string;
              worktreeMergedPaths: number;
              providerResumeCleared: boolean;
            };
          };
        };
      };
    };
    expect(body.action).toBe('reset');
    expect(body.providerSessionId).toBeUndefined();
    expect(body.hydration).toBeUndefined();
    expect(body.inspection.maintenance.lastLifecycle.cleanup).toEqual(expect.objectContaining({
      workspaceCleaned: true,
      worktreeDetached: true,
      worktreeCleanupPolicy: 'discard',
      worktreeMergedPaths: 0,
      providerResumeCleared: true,
    }));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(false);
    const stored = registry.get(session.id);
    expect(stored?.cwd).toBe(repoDir);
    expect(stored?.providerSessionId).toBeUndefined();
    expect(stored?.hydration).toBeUndefined();
    expect(stored?.workspaceIsolation?.worktree?.lastCleanup).toEqual(expect.objectContaining({
      policy: 'discard',
      status: 'completed',
    }));
  });

  it('re-prepares a missing worktree before resuming a closed session', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-resume');
    const prepared = prepareSessionWorkspace({
      sessionId: 'worktree-resume',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });
    const cleanup = cleanupSessionWorkspace({
      sessionId: 'worktree-resume',
      sessionBaseDir,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      worktreeCleanupPolicy: 'discard',
    });

    const session = registry.create({
      id: 'worktree-resume',
      providerName: 'codex',
      cwd: cleanup.nextCwd || repoDir,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: cleanup.nextWorkspaceIsolation,
      hydration: undefined,
    });
    registry.setProviderSessionId(session.id, 'thread-resume');
    registry.updateStatus(session.id, 'closed');

    const response = await app.request(`/sessions/${session.id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      cwd: string;
      hydration: {
        workspace: {
          isolationMode: string;
          sourceCwd: string;
        };
      };
    };
    expect(body.cwd).toContain(join('sessions', 'worktrees'));
    expect(body.hydration.workspace).toEqual(expect.objectContaining({
      isolationMode: 'worktree',
      sourceCwd: repoDir,
    }));
    expect(vi.mocked(pool.spawn)).toHaveBeenCalledWith(
      session.id,
      'codex',
      expect.objectContaining({
        cwd: body.cwd,
        resumeSessionId: 'thread-resume',
      }),
      undefined,
    );
    expect(existsSync(registry.get(session.id)?.workspaceIsolation?.worktree?.worktreePath || '')).toBe(true);
  });

  it('merges a worktree back into the source repo during DELETE cleanup', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-delete');
    const prepared = prepareSessionWorkspace({
      sessionId: 'worktree-delete',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    const session = registry.create({
      id: 'worktree-delete',
      providerName: 'codex',
      cwd: prepared.cwd,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
    });
    registry.updateStatus(session.id, 'closed');

    writeFileSync(join(prepared.cwd, 'tracked.txt'), 'merged from delete\n', 'utf8');
    writeFileSync(join(prepared.cwd, 'new-delete.txt'), 'new file\n', 'utf8');

    const response = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'merge',
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      status: string;
      workspaceCleaned: boolean;
      cleanup: {
        worktreeDetached: boolean;
        worktreeCleanupPolicy: string;
        worktreeMergedPaths: number;
      };
    };
    expect(body.status).toBe('deleted');
    expect(body.workspaceCleaned).toBe(true);
    expect(body.cleanup).toEqual(expect.objectContaining({
      worktreeDetached: true,
      worktreeCleanupPolicy: 'merge',
      worktreeMergedPaths: 2,
    }));
    expect(registry.get(session.id)).toBeUndefined();
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(false);
    expect(readFileSync(join(repoDir, 'tracked.txt'), 'utf8')).toBe('merged from delete\n');
    expect(readFileSync(join(repoDir, 'new-delete.txt'), 'utf8')).toBe('new file\n');
  });
});
