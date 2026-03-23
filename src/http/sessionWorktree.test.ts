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
    const prepared = await prepareSessionWorkspace({
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

  it('retains a worktree-backed session when reset requests preserve semantics', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-reset-preserve');
    const prepared = await prepareSessionWorkspace({
      sessionId: 'worktree-reset-preserve',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    const session = registry.create({
      id: 'worktree-reset-preserve',
      providerName: 'codex',
      cwd: prepared.cwd,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      hydration: buildHydration(prepared.cwd, repoDir),
    });
    registry.setProviderSessionId(session.id, 'thread-reset-preserve');
    registry.updateStatus(session.id, 'closed');

    writeFileSync(join(prepared.cwd, 'tracked.txt'), 'preserve me\n', 'utf8');

    const response = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'preserve',
        maintenance: {
          reason: 'owner_requested_preserve',
          hookPayloads: [{
            kind: 'memory_flush',
            payload: {
              scope: 'summary',
            },
          }],
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      action: string;
      status: string;
      reason: string;
      session: {
        cwd: string;
        inspection: {
          maintenance: {
            lastRequest: {
              action: string;
              worktreeDisposition?: string;
              reason?: string;
            };
            lastLifecycle: {
              status: string;
              cleanup: {
                workspaceCleaned: boolean;
                worktreeDetached: boolean;
                worktreeCleanupPolicy: string;
              };
            };
          };
        };
      };
    };
    expect(body.action).toBe('reset');
    expect(body.status).toBe('retained');
    expect(body.reason).toContain('intentionally preserved');
    expect(body.session.cwd).toBe(prepared.workspaceIsolation.worktree!.worktreePath);
    expect(body.session.inspection.maintenance.lastRequest).toEqual(expect.objectContaining({
      action: 'reset',
      worktreeDisposition: 'preserve',
      reason: 'owner_requested_preserve',
    }));
    expect(body.session.inspection.maintenance.lastLifecycle).toEqual(expect.objectContaining({
      status: 'retained',
      cleanup: expect.objectContaining({
        workspaceCleaned: false,
        worktreeDetached: false,
        worktreeCleanupPolicy: 'preserve',
      }),
    }));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(true);
    expect(readFileSync(join(prepared.cwd, 'tracked.txt'), 'utf8')).toBe('preserve me\n');

    const stored = registry.get(session.id);
    expect(stored?.cwd).toBe(prepared.workspaceIsolation.worktree!.worktreePath);
    expect(stored?.workspaceIsolation?.worktree?.lastCleanup).toEqual(expect.objectContaining({
      policy: 'preserve',
      status: 'retained',
      reasonCodes: ['worktree_preserved'],
    }));
  });

  it('rejects invalid worktree cleanup policies for reset, delete, and retry routes', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-invalid-worktree-policy');
    const prepared = await prepareSessionWorkspace({
      sessionId: 'worktree-invalid-policy',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    const session = registry.create({
      id: 'worktree-invalid-policy',
      providerName: 'codex',
      cwd: prepared.cwd,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      hydration: buildHydration(prepared.cwd, repoDir),
    });
    registry.updateStatus(session.id, 'closed');

    const invalidReset = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'drop',
      }),
    });
    expect(invalidReset.status).toBe(400);
    await expect(invalidReset.json()).resolves.toEqual({
      error: 'Error: worktreeCleanupPolicy must be one of: discard, merge, preserve',
    });

    const invalidDelete = await app.request(`/sessions/${session.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'drop',
      }),
    });
    expect(invalidDelete.status).toBe(400);
    await expect(invalidDelete.json()).resolves.toEqual({
      error: 'Error: worktreeCleanupPolicy must be one of: discard, merge, preserve',
    });

    const retainResponse = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'preserve',
      }),
    });
    expect(retainResponse.status).toBe(200);

    const invalidRetry = await app.request(`/sessions/${session.id}/workspace/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'drop',
      }),
    });
    expect(invalidRetry.status).toBe(400);
    await expect(invalidRetry.json()).resolves.toEqual({
      error: 'Error: worktreeCleanupPolicy must be one of: discard, merge, preserve',
    });
  });

  it('retries retained worktree cleanup without replaying reset follow-through', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-cleanup-retry');
    const prepared = await prepareSessionWorkspace({
      sessionId: 'worktree-cleanup-retry',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    const session = registry.create({
      id: 'worktree-cleanup-retry',
      providerName: 'codex',
      cwd: prepared.cwd,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      hydration: buildHydration(prepared.cwd, repoDir),
    });
    registry.setProviderSessionId(session.id, 'thread-cleanup-retry');
    registry.updateStatus(session.id, 'closed');

    writeFileSync(join(prepared.cwd, 'tracked.txt'), 'cleanup retry me\n', 'utf8');

    const retainedResponse = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'preserve',
      }),
    });

    expect(retainedResponse.status).toBe(200);

    const response = await app.request(`/sessions/${session.id}/workspace/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'discard',
        maintenance: {
          reason: 'operator_retry_cleanup',
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      action: string;
      status: string;
      reasonCodes: string[];
      cleanup: {
        workspaceCleaned: boolean;
        worktreeDetached: boolean;
        worktreeCleanupPolicy: string;
        worktreeMergedPaths: number;
      };
      maintenance: {
        lastRequest: {
          action: string;
          reason?: string;
          worktreeDisposition?: string;
        };
      };
      session: {
        cwd: string;
        hydration: {
          workspace: {
            runtimeCwd: string;
            sourceCwd: string;
            sourceOfTruth: string;
          };
        };
      };
    };
    expect(body.action).toBe('cleanup_workspace');
    expect(body.status).toBe('completed');
    expect(body.reasonCodes).toContain('worktree_changes_discarded');
    expect(body.cleanup).toEqual(expect.objectContaining({
      workspaceCleaned: true,
      worktreeDetached: true,
      worktreeCleanupPolicy: 'discard',
      worktreeMergedPaths: 0,
    }));
    expect(body.maintenance.lastRequest).toEqual(expect.objectContaining({
      action: 'cleanup_workspace',
      reason: 'operator_retry_cleanup',
      worktreeDisposition: 'discard',
    }));
    expect(body.session.cwd).toBe(repoDir);
    expect(body.session.hydration.workspace).toEqual(expect.objectContaining({
      runtimeCwd: repoDir,
      sourceCwd: repoDir,
      sourceOfTruth: 'runtime_cwd',
    }));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(false);

    const stored = registry.get(session.id);
    expect(stored?.cwd).toBe(repoDir);
    expect(stored?.providerSessionId).toBe('thread-cleanup-retry');
    expect(stored?.workspaceIsolation?.worktree?.lastCleanup).toEqual(expect.objectContaining({
      policy: 'discard',
      status: 'completed',
    }));
    expect(stored?.hydration?.workspace).toEqual(expect.objectContaining({
      runtimeCwd: repoDir,
      sourceCwd: repoDir,
      sourceOfTruth: 'runtime_cwd',
    }));
  });

  it('keeps retained worktree cleanup retry bounded when merge still sees a dirty source repo', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-cleanup-retry-dirty');
    const prepared = await prepareSessionWorkspace({
      sessionId: 'worktree-cleanup-retry-dirty',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    const session = registry.create({
      id: 'worktree-cleanup-retry-dirty',
      providerName: 'codex',
      cwd: prepared.cwd,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      hydration: buildHydration(prepared.cwd, repoDir),
    });
    registry.updateStatus(session.id, 'closed');

    writeFileSync(join(prepared.cwd, 'tracked.txt'), 'preserve before merge retry\n', 'utf8');

    const retainedResponse = await app.request(`/sessions/${session.id}/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'preserve',
      }),
    });

    expect(retainedResponse.status).toBe(200);
    writeFileSync(join(repoDir, 'dirty-source.txt'), 'dirty\n', 'utf8');

    const response = await app.request(`/sessions/${session.id}/workspace/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        worktreeCleanupPolicy: 'merge',
        maintenance: {
          reason: 'retry_after_manual_review',
        },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as {
      action: string;
      status: string;
      reason: string;
      reasonCodes: string[];
      cleanup: {
        workspaceCleaned: boolean;
        worktreeDetached: boolean;
        worktreeCleanupPolicy: string;
        worktreeMergedPaths: number;
      };
      maintenance: {
        lastRequest: {
          action: string;
          reason?: string;
          worktreeDisposition?: string;
        };
      };
      session: {
        cwd: string;
        hydration: {
          workspace: {
            runtimeCwd: string;
            sourceCwd: string;
            sourceOfTruth: string;
          };
        };
      };
    };
    expect(body.action).toBe('cleanup_workspace');
    expect(body.status).toBe('retained');
    expect(body.reason).toContain('could not be completed');
    expect(body.reasonCodes).toContain('source_workspace_dirty');
    expect(body.cleanup).toEqual(expect.objectContaining({
      workspaceCleaned: false,
      worktreeDetached: false,
      worktreeCleanupPolicy: 'merge',
      worktreeMergedPaths: 0,
    }));
    expect(body.maintenance.lastRequest).toEqual(expect.objectContaining({
      action: 'cleanup_workspace',
      reason: 'retry_after_manual_review',
      worktreeDisposition: 'merge',
    }));
    expect(body.session.cwd).toBe(prepared.workspaceIsolation.worktree!.worktreePath);
    expect(body.session.hydration.workspace).toEqual(expect.objectContaining({
      runtimeCwd: prepared.workspaceIsolation.worktree!.worktreePath,
      sourceCwd: repoDir,
      sourceOfTruth: 'source_workspace',
    }));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(true);

    const stored = registry.get(session.id);
    expect(stored?.cwd).toBe(prepared.workspaceIsolation.worktree!.worktreePath);
    expect(stored?.workspaceIsolation?.worktree?.lastCleanup).toEqual(expect.objectContaining({
      policy: 'merge',
      status: 'retained',
      reasonCodes: ['source_workspace_dirty'],
    }));
  });

  it('re-prepares a missing worktree before resuming a closed session', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-resume');
    const prepared = await prepareSessionWorkspace({
      sessionId: 'worktree-resume',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });
    const cleanup = await cleanupSessionWorkspace({
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

  it('fails fork before preparing a worktree when the target cannot honor read_only permissions', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-fork-readonly');
    const session = registry.create({
      id: 'worktree-fork-readonly',
      providerName: 'codex',
      cwd: repoDir,
      workspaceMode: 'shared',
    });
    vi.mocked(pool.getCapabilities).mockImplementation(() => ({
      resume: true,
      fork: true,
      permissions: false,
    }));

    const response = await app.request(`/sessions/${session.id}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workspaceMode: 'read_only',
        workspaceIsolation: 'worktree',
      }),
    });

    expect(response.status).toBe(400);
    expect(existsSync(join(sessionBaseDir, 'worktrees'))).toBe(false);
  });

  it('cleans up a recreated worktree when resume cannot persist the prepared workspace', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-resume-failure');
    const prepared = await prepareSessionWorkspace({
      sessionId: 'worktree-resume-failure',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });
    const cleanup = await cleanupSessionWorkspace({
      sessionId: 'worktree-resume-failure',
      sessionBaseDir,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      worktreeCleanupPolicy: 'discard',
    });

    const session = registry.create({
      id: 'worktree-resume-failure',
      providerName: 'codex',
      cwd: cleanup.nextCwd || repoDir,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: cleanup.nextWorkspaceIsolation,
    });
    registry.setProviderSessionId(session.id, 'thread-resume-failure');
    registry.updateStatus(session.id, 'closed');
    vi.spyOn(registry, 'updateWorkspace').mockReturnValue(false);

    const response = await app.request(`/sessions/${session.id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(500);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('Failed to prepare workspace for resume');
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(false);
  });

  it('merges a worktree back into the source repo during DELETE cleanup', async () => {
    const repoDir = createGitWorkspace(rootDir, 'repo-delete');
    const prepared = await prepareSessionWorkspace({
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
