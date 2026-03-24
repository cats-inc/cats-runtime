import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import { RuntimeWorktreeMaintenanceService } from './RuntimeWorktreeMaintenanceService.js';
import { prepareSessionWorkspace } from './sessionWorkspace.js';

const cleanupPaths: string[] = [];

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

function createGitWorkspace(): {
  repoDir: string;
  sessionBaseDir: string;
} {
  const rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-worktree-maintenance-'));
  cleanupPaths.push(rootDir);
  const repoDir = join(rootDir, 'repo');
  const sessionBaseDir = join(rootDir, 'sessions');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(sessionBaseDir, { recursive: true });
  writeFileSync(join(repoDir, 'tracked.txt'), 'initial\n', 'utf8');

  runGit(repoDir, ['init']);
  runGit(repoDir, ['config', 'user.email', 'cats-runtime@example.test']);
  runGit(repoDir, ['config', 'user.name', 'Cats Runtime Test']);
  runGit(repoDir, ['add', '.']);
  runGit(repoDir, ['commit', '-m', 'initial']);

  return {
    repoDir,
    sessionBaseDir,
  };
}

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

describe('RuntimeWorktreeMaintenanceService', () => {
  it('removes orphaned worktrees during a sweep', async () => {
    const { repoDir, sessionBaseDir } = createGitWorkspace();
    const prepared = await prepareSessionWorkspace({
      sessionId: 'orphaned-session',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });
    const service = new RuntimeWorktreeMaintenanceService({
      sessionBaseDir,
      registry: new SessionRegistry(),
      runtime: {
        isAttached: vi.fn(() => false),
      } as never,
      now: () => new Date('2026-03-24T00:00:00.000Z'),
    });

    const result = await service.sweep();

    expect(result).toEqual(expect.objectContaining({
      orphanedWorktreeCount: 1,
      removedOrphanedWorktreeCount: 1,
      failedOrphanedWorktreeCount: 0,
      orphanedWorktreePaths: [prepared.workspaceIsolation.worktree!.worktreePath],
    }));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(false);
  });

  it('surfaces expired retained worktree sessions for operator follow-through', async () => {
    const { repoDir, sessionBaseDir } = createGitWorkspace();
    const registry = new SessionRegistry();
    const prepared = await prepareSessionWorkspace({
      sessionId: 'retained-session',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
      now: new Date('2026-03-22T00:00:00.000Z'),
    });

    registry.create({
      id: 'retained-session',
      providerName: 'codex',
      cwd: prepared.cwd,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: {
        ...prepared.workspaceIsolation,
        worktree: {
          ...prepared.workspaceIsolation.worktree!,
          lastCleanup: {
            policy: 'preserve',
            status: 'retained',
            observedAt: '2026-03-22T00:00:00.000Z',
            reasonCodes: ['worktree_preserved'],
            mergedPathCount: 0,
          },
        },
      },
    });
    registry.updateStatus('retained-session', 'closed');

    const service = new RuntimeWorktreeMaintenanceService({
      sessionBaseDir,
      registry,
      runtime: {
        isAttached: vi.fn(() => false),
      } as never,
      retainedTtlMs: 60 * 60 * 1000,
      now: () => new Date('2026-03-24T00:00:00.000Z'),
    });

    const result = await service.sweep();

    expect(result).toEqual(expect.objectContaining({
      retainedSessionCount: 1,
      expiredRetainedSessionCount: 1,
      expiredRetainedSessionIds: ['retained-session'],
    }));
  });
});
