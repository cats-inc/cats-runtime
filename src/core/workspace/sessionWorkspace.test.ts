import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanupSessionWorkspace,
  cleanupOrphanedWorktree,
  copyWorkspaceSnapshot,
  prepareSessionWorkspace,
} from './sessionWorkspace.js';

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
  rootDir: string;
  repoDir: string;
  sessionBaseDir: string;
} {
  const rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-worktree-'));
  cleanupPaths.push(rootDir);

  const repoDir = join(rootDir, 'repo');
  const sessionBaseDir = join(rootDir, 'sessions');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(sessionBaseDir, { recursive: true });

  writeFileSync(join(repoDir, 'tracked.txt'), 'initial\n', 'utf8');
  writeFileSync(join(repoDir, 'delete-me.txt'), 'remove me\n', 'utf8');
  mkdirSync(join(repoDir, 'subdir'), { recursive: true });
  writeFileSync(join(repoDir, 'subdir', 'nested.txt'), 'nested\n', 'utf8');

  runGit(repoDir, ['init']);
  runGit(repoDir, ['config', 'user.email', 'cats-runtime@example.test']);
  runGit(repoDir, ['config', 'user.name', 'Cats Runtime Test']);
  runGit(repoDir, ['add', '.']);
  runGit(repoDir, ['commit', '-m', 'initial']);

  return {
    rootDir,
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

describe('sessionWorkspace', () => {
  it('prepares a deterministic worktree-backed runtime cwd', async () => {
    const { repoDir, sessionBaseDir } = createGitWorkspace();
    const sourceCwd = join(repoDir, 'subdir');

    const prepared = await prepareSessionWorkspace({
      sessionId: 'session-1',
      sessionBaseDir,
      cwd: sourceCwd,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
      permissionMode: 'skip',
      now: new Date('2026-03-23T00:00:00.000Z'),
    });

    expect(prepared.workspaceMode).toBe('shared');
    expect(prepared.permissionMode).toBe('skip');
    expect(prepared.sourceCwd).toBe(sourceCwd);
    expect(prepared.workspaceIsolation).toEqual(expect.objectContaining({
      mode: 'worktree',
      sourceCwd,
      worktree: expect.objectContaining({
        id: expect.stringContaining('repo-session-1'),
        relativeCwd: 'subdir',
        worktreePath: expect.stringContaining(join('worktrees', 'repo-')),
        preparedAt: '2026-03-23T00:00:00.000Z',
      }),
    }));
    expect(prepared.cwd).toBe(join(
      prepared.workspaceIsolation.worktree!.worktreePath,
      'subdir',
    ));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(true);
    expect(existsSync(join(prepared.cwd, 'nested.txt'))).toBe(true);
  });

  it('discards a prepared worktree and removes its runtime cwd', async () => {
    const { repoDir, sessionBaseDir } = createGitWorkspace();
    const prepared = await prepareSessionWorkspace({
      sessionId: 'session-discard',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    writeFileSync(join(prepared.cwd, 'tracked.txt'), 'discarded change\n', 'utf8');

    const cleanup = await cleanupSessionWorkspace({
      sessionId: 'session-discard',
      sessionBaseDir,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      worktreeCleanupPolicy: 'discard',
      now: new Date('2026-03-23T01:00:00.000Z'),
    });

    expect(cleanup).toEqual(expect.objectContaining({
      status: 'completed',
      workspaceCleaned: true,
      worktreeDetached: true,
      mergedPathCount: 0,
      policy: 'discard',
      reasonCodes: ['worktree_changes_discarded'],
      nextCwd: repoDir,
      nextWorkspaceIsolation: expect.objectContaining({
        mode: 'worktree',
        sourceCwd: repoDir,
        worktree: expect.objectContaining({
          lastCleanup: expect.objectContaining({
            policy: 'discard',
            status: 'completed',
            observedAt: '2026-03-23T01:00:00.000Z',
            reasonCodes: ['worktree_changes_discarded'],
            mergedPathCount: 0,
          }),
        }),
      }),
    }));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(false);
    expect(runGit(repoDir, ['status', '--porcelain'])).toBe('');
  });

  it('merges worktree changes back into the source repository before cleanup', { timeout: 15_000 }, async () => {
    const { repoDir, sessionBaseDir } = createGitWorkspace();
    const prepared = await prepareSessionWorkspace({
      sessionId: 'session-merge',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    writeFileSync(join(prepared.cwd, 'tracked.txt'), 'merged change\n', 'utf8');
    writeFileSync(join(prepared.cwd, 'new-file.txt'), 'new file\n', 'utf8');
    rmSync(join(prepared.cwd, 'delete-me.txt'));

    const cleanup = await cleanupSessionWorkspace({
      sessionId: 'session-merge',
      sessionBaseDir,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      worktreeCleanupPolicy: 'merge',
      now: new Date('2026-03-23T02:00:00.000Z'),
    });

    expect(cleanup).toEqual(expect.objectContaining({
      status: 'completed',
      workspaceCleaned: true,
      worktreeDetached: true,
      mergedPathCount: 3,
      policy: 'merge',
      nextCwd: repoDir,
    }));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(false);
    expect(runGit(repoDir, ['status', '--porcelain'])).toContain('tracked.txt');
    expect(runGit(repoDir, ['status', '--porcelain'])).toContain('new-file.txt');
    expect(runGit(repoDir, ['status', '--porcelain'])).toContain('delete-me.txt');
  });

  it('preserves a prepared worktree for manual handling without changing the runtime cwd', async () => {
    const { repoDir, sessionBaseDir } = createGitWorkspace();
    const prepared = await prepareSessionWorkspace({
      sessionId: 'session-preserve',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    writeFileSync(join(prepared.cwd, 'tracked.txt'), 'preserved change\n', 'utf8');

    const cleanup = await cleanupSessionWorkspace({
      sessionId: 'session-preserve',
      sessionBaseDir,
      workspaceMode: prepared.workspaceMode,
      workspaceIsolation: prepared.workspaceIsolation,
      worktreeCleanupPolicy: 'preserve',
      now: new Date('2026-03-23T03:00:00.000Z'),
    });

    expect(cleanup).toEqual(expect.objectContaining({
      status: 'retained',
      workspaceCleaned: false,
      worktreeDetached: false,
      mergedPathCount: 0,
      policy: 'preserve',
      reasonCodes: ['worktree_preserved'],
      nextCwd: prepared.workspaceIsolation.worktree!.worktreePath,
      nextWorkspaceIsolation: expect.objectContaining({
        mode: 'worktree',
        sourceCwd: repoDir,
        worktree: expect.objectContaining({
          worktreePath: prepared.workspaceIsolation.worktree!.worktreePath,
          lastCleanup: expect.objectContaining({
            policy: 'preserve',
            status: 'retained',
            observedAt: '2026-03-23T03:00:00.000Z',
            reasonCodes: ['worktree_preserved'],
            mergedPathCount: 0,
          }),
        }),
      }),
    }));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(true);
    expect(readFileSync(join(prepared.cwd, 'tracked.txt'), 'utf8')).toBe('preserved change\n');
  });

  it('captures workspace snapshot copy stats while skipping git metadata', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'cats-runtime-workspace-copy-'));
    cleanupPaths.push(rootDir);
    const sourceDir = join(rootDir, 'source');
    const targetDir = join(rootDir, 'target');
    mkdirSync(join(sourceDir, '.git'), { recursive: true });
    mkdirSync(join(sourceDir, 'nested'), { recursive: true });
    writeFileSync(join(sourceDir, 'alpha.txt'), 'alpha\n', 'utf8');
    writeFileSync(join(sourceDir, 'nested', 'beta.txt'), 'beta\n', 'utf8');
    writeFileSync(join(sourceDir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');

    const result = await copyWorkspaceSnapshot(sourceDir, targetDir, {
      skipGitMetadata: true,
    });

    expect(result).toEqual({
      copiedFileCount: 2,
      copiedByteCount: Buffer.byteLength('alpha\n', 'utf8') + Buffer.byteLength('beta\n', 'utf8'),
      skippedGitMetadata: true,
    });
    expect(existsSync(join(targetDir, 'alpha.txt'))).toBe(true);
    expect(existsSync(join(targetDir, 'nested', 'beta.txt'))).toBe(true);
    expect(existsSync(join(targetDir, '.git'))).toBe(false);
  });

  it('removes orphaned worktree directories without a registered session', async () => {
    const { repoDir, sessionBaseDir } = createGitWorkspace();
    const prepared = await prepareSessionWorkspace({
      sessionId: 'orphaned-session',
      sessionBaseDir,
      cwd: repoDir,
      workspaceMode: 'shared',
      workspaceIsolationMode: 'worktree',
    });

    const result = await cleanupOrphanedWorktree(prepared.workspaceIsolation.worktree!.worktreePath);

    expect(result).toEqual(expect.objectContaining({
      removed: true,
      reasonCodes: expect.arrayContaining(['orphaned_worktree_detached']),
      sourceRepoRoot: repoDir,
    }));
    expect(existsSync(prepared.workspaceIsolation.worktree!.worktreePath)).toBe(false);
  });
});
