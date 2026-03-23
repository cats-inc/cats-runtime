import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
  PermissionMode,
  SessionWorkspaceIsolationState,
  WorktreeCleanupPolicy,
  WorktreeCleanupStatus,
  WorkspaceIsolationMode,
  WorkspaceMode,
} from '../types.js';

const GIT_TIMEOUT_MS = 15_000;

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface WorktreeChange {
  kind: 'add' | 'modify' | 'delete' | 'rename' | 'untracked';
  path: string;
  previousPath?: string;
}

interface BackupEntry {
  originalPath: string;
  backupPath: string;
}

export interface PrepareSessionWorkspaceInput {
  sessionId: string;
  sessionBaseDir: string;
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  workspaceIsolationMode?: WorkspaceIsolationMode;
  permissionMode?: PermissionMode;
  now?: Date;
}

export interface PrepareSessionWorkspaceResult {
  cwd: string;
  sourceCwd?: string;
  workspaceMode: WorkspaceMode;
  permissionMode: PermissionMode;
  workspaceIsolation: SessionWorkspaceIsolationState;
}

export interface CleanupSessionWorkspaceInput {
  sessionId: string;
  sessionBaseDir: string;
  workspaceMode?: WorkspaceMode;
  workspaceIsolation?: SessionWorkspaceIsolationState;
  worktreeCleanupPolicy?: WorktreeCleanupPolicy;
  now?: Date;
}

export interface CleanupSessionWorkspaceResult {
  status: WorktreeCleanupStatus;
  workspaceCleaned: boolean;
  worktreeDetached: boolean;
  mergedPathCount: number;
  reasonCodes: string[];
  policy?: WorktreeCleanupPolicy;
  nextCwd?: string;
  nextWorkspaceIsolation?: SessionWorkspaceIsolationState;
}

export function prepareSessionWorkspace(
  input: PrepareSessionWorkspaceInput,
): PrepareSessionWorkspaceResult {
  const requestedIsolation = input.workspaceIsolationMode
    ?? deriveWorkspaceIsolationMode(input.workspaceMode);
  const requestedMode = input.workspaceMode;
  const now = (input.now ?? new Date()).toISOString();

  if (requestedIsolation === 'isolated') {
    const sandboxDir = join(input.sessionBaseDir, input.sessionId);
    mkdirSync(sandboxDir, { recursive: true });
    return {
      cwd: sandboxDir,
      ...(input.cwd ? { sourceCwd: input.cwd } : {}),
      workspaceMode: 'isolated',
      permissionMode: 'skip',
      workspaceIsolation: {
        mode: 'isolated',
        ...(input.cwd ? { sourceCwd: input.cwd } : {}),
      },
    };
  }

  if (!input.cwd) {
    throw new Error(`cwd is required for ${requestedIsolation} workspace isolation`);
  }

  if (requestedIsolation === 'shared') {
    return {
      cwd: input.cwd,
      sourceCwd: input.cwd,
      workspaceMode: requestedMode === 'read_only' ? 'read_only' : 'shared',
      permissionMode: requestedMode === 'read_only'
        ? 'default'
        : input.permissionMode ?? 'skip',
      workspaceIsolation: {
        mode: 'shared',
        sourceCwd: input.cwd,
      },
    };
  }

  if (requestedMode === 'isolated') {
    throw new Error('workspaceMode=isolated cannot be combined with worktree isolation');
  }

  const sourceCwd = input.cwd;
  const sourceRepoRoot = resolveGitRepoRoot(sourceCwd);
  const relativeCwd = resolveRelativeRepoPath(sourceRepoRoot, sourceCwd);
  const worktreePath = buildWorktreePath(input.sessionBaseDir, sourceRepoRoot, input.sessionId);

  if (!existsSync(worktreePath)) {
    mkdirSync(dirname(worktreePath), { recursive: true });
    const addResult = runGit(sourceRepoRoot, ['worktree', 'add', '--detach', worktreePath, 'HEAD']);
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr.trim() || 'Failed to prepare git worktree');
    }
  }

  const runtimeCwd = relativeCwd ? join(worktreePath, relativeCwd) : worktreePath;
  const sourceHeadRef = readGitValue(sourceRepoRoot, ['symbolic-ref', '-q', '--short', 'HEAD']);
  const sourceHeadOid = readGitValue(sourceRepoRoot, ['rev-parse', 'HEAD']);

  return {
    cwd: runtimeCwd,
    sourceCwd,
    workspaceMode: requestedMode === 'read_only' ? 'read_only' : 'shared',
    permissionMode: requestedMode === 'read_only'
      ? 'default'
      : input.permissionMode ?? 'skip',
    workspaceIsolation: {
      mode: 'worktree',
      sourceCwd,
      worktree: {
        id: buildWorktreeId(sourceRepoRoot, input.sessionId),
        sourceRepoRoot,
        ...(sourceHeadOid ? { sourceHeadOid } : {}),
        sourceHeadRef,
        ...(relativeCwd ? { relativeCwd } : {}),
        worktreePath,
        preparedAt: now,
      },
    },
  };
}

export function cleanupSessionWorkspace(
  input: CleanupSessionWorkspaceInput,
): CleanupSessionWorkspaceResult {
  const isolation = input.workspaceIsolation;
  if (isolation?.mode === 'worktree' && isolation.worktree) {
    return cleanupWorktreeWorkspace(
      input,
      isolation as SessionWorkspaceIsolationState & {
        mode: 'worktree';
        worktree: NonNullable<SessionWorkspaceIsolationState['worktree']>;
      },
    );
  }

  if ((isolation?.mode ?? deriveWorkspaceIsolationMode(input.workspaceMode)) === 'isolated') {
    const sandboxDir = join(input.sessionBaseDir, input.sessionId);
    try {
      rmSync(sandboxDir, { recursive: true, force: true });
      return {
        status: 'completed',
        workspaceCleaned: true,
        worktreeDetached: false,
        mergedPathCount: 0,
        reasonCodes: ['isolated_workspace_removed'],
      };
    } catch {
      return {
        status: 'retained',
        workspaceCleaned: false,
        worktreeDetached: false,
        mergedPathCount: 0,
        reasonCodes: ['isolated_workspace_cleanup_failed'],
      };
    }
  }

  return {
    status: 'completed',
    workspaceCleaned: false,
    worktreeDetached: false,
    mergedPathCount: 0,
    reasonCodes: ['shared_workspace_retained'],
  };
}

export function copyWorkspaceSnapshot(
  sourceCwd: string,
  targetCwd: string,
  options: {
    skipGitMetadata?: boolean;
  } = {},
): void {
  if (!existsSync(sourceCwd)) {
    return;
  }

  mkdirSync(targetCwd, { recursive: true });
  for (const entry of readdirSync(sourceCwd, { withFileTypes: true })) {
    if (options.skipGitMetadata && entry.name === '.git') {
      continue;
    }

    const sourcePath = join(sourceCwd, entry.name);
    const targetPath = join(targetCwd, entry.name);
    if (entry.isDirectory()) {
      copyWorkspaceSnapshot(sourcePath, targetPath, options);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function cleanupWorktreeWorkspace(
  input: CleanupSessionWorkspaceInput,
  isolation: SessionWorkspaceIsolationState & { mode: 'worktree'; worktree: NonNullable<SessionWorkspaceIsolationState['worktree']> },
): CleanupSessionWorkspaceResult {
  const policy = input.worktreeCleanupPolicy ?? 'discard';
  const observedAt = (input.now ?? new Date()).toISOString();
  const reasonCodes: string[] = [];
  const worktree = isolation.worktree;
  const sourceCwd = isolation.sourceCwd ?? worktree.sourceRepoRoot;
  let mergedPathCount = 0;

  if (policy === 'merge') {
    if (!sourceRepoIsClean(worktree.sourceRepoRoot)) {
      return {
        status: 'retained',
        workspaceCleaned: false,
        worktreeDetached: false,
        mergedPathCount: 0,
        policy,
        reasonCodes: ['source_workspace_dirty'],
        nextCwd: sourceCwd,
        nextWorkspaceIsolation: {
          ...isolation,
          worktree: {
            ...worktree,
            lastCleanup: {
              policy,
              status: 'retained',
              observedAt,
              reasonCodes: ['source_workspace_dirty'],
              mergedPathCount: 0,
            },
          },
        },
      };
    }

    try {
      const changes = collectWorktreeChanges(worktree.worktreePath);
      mergedPathCount = applyWorktreeMerge(
        worktree.worktreePath,
        worktree.sourceRepoRoot,
        changes,
        input.sessionBaseDir,
        input.sessionId,
      );
      reasonCodes.push(changes.length > 0 ? 'worktree_changes_merged' : 'worktree_already_clean');
    } catch (error) {
      return {
        status: 'retained',
        workspaceCleaned: false,
        worktreeDetached: false,
        mergedPathCount: 0,
        policy,
        reasonCodes: [
          'worktree_merge_failed',
          error instanceof Error ? error.message : String(error),
        ],
        nextCwd: sourceCwd,
        nextWorkspaceIsolation: {
          ...isolation,
          worktree: {
            ...worktree,
            lastCleanup: {
              policy,
              status: 'retained',
              observedAt,
              reasonCodes: [
                'worktree_merge_failed',
                error instanceof Error ? error.message : String(error),
              ],
              mergedPathCount: 0,
            },
          },
        },
      };
    }
  } else {
    reasonCodes.push('worktree_changes_discarded');
  }

  const detached = detachWorktree(worktree.sourceRepoRoot, worktree.worktreePath);
  if (!detached) {
    return {
      status: 'retained',
      workspaceCleaned: false,
      worktreeDetached: false,
      mergedPathCount: 0,
      policy,
      reasonCodes: [...reasonCodes, 'worktree_detach_failed'],
      nextCwd: sourceCwd,
      nextWorkspaceIsolation: {
        ...isolation,
        worktree: {
          ...worktree,
          lastCleanup: {
            policy,
            status: 'retained',
            observedAt,
            reasonCodes: [...reasonCodes, 'worktree_detach_failed'],
            mergedPathCount: 0,
          },
        },
      },
    };
  }

  return {
    status: 'completed',
    workspaceCleaned: true,
    worktreeDetached: true,
    mergedPathCount,
    policy,
    reasonCodes,
    nextCwd: sourceCwd,
    nextWorkspaceIsolation: {
      mode: 'worktree',
      sourceCwd,
      worktree: {
        ...worktree,
        lastCleanup: {
          policy,
          status: 'completed',
          observedAt,
          reasonCodes,
          mergedPathCount,
        },
      },
    },
  };
}

function deriveWorkspaceIsolationMode(
  workspaceMode: WorkspaceMode | undefined,
): WorkspaceIsolationMode {
  return workspaceMode === 'isolated' ? 'isolated' : 'shared';
}

function buildWorktreeId(sourceRepoRoot: string, sessionId: string): string {
  return `${sanitizePathSegment(basename(sourceRepoRoot))}-${sessionId}`;
}

function buildWorktreePath(
  sessionBaseDir: string,
  sourceRepoRoot: string,
  sessionId: string,
): string {
  const repoHash = createHash('sha1')
    .update(sourceRepoRoot.toLowerCase())
    .digest('hex')
    .slice(0, 10);
  return join(
    sessionBaseDir,
    'worktrees',
    `${sanitizePathSegment(basename(sourceRepoRoot))}-${repoHash}`,
    sessionId,
  );
}

function sanitizePathSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'workspace';
}

function resolveGitRepoRoot(cwd: string): string {
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (result.code !== 0) {
    throw new Error(`worktree isolation requires a Git workspace: ${result.stderr.trim() || result.stdout.trim() || cwd}`);
  }
  return result.stdout.trim();
}

function resolveRelativeRepoPath(sourceRepoRoot: string, cwd: string): string | undefined {
  const repoRoot = resolve(sourceRepoRoot);
  const target = resolve(cwd);
  const relativePath = relative(repoRoot, target);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`cwd '${cwd}' is not inside repo root '${sourceRepoRoot}'`);
  }
  return relativePath.length > 0 ? relativePath : undefined;
}

function readGitValue(cwd: string, args: string[]): string | undefined {
  const result = runGit(cwd, args);
  if (result.code !== 0) {
    return undefined;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

function sourceRepoIsClean(sourceRepoRoot: string): boolean {
  const result = runGit(sourceRepoRoot, ['status', '--porcelain']);
  return result.code === 0 && result.stdout.trim().length === 0;
}

function collectWorktreeChanges(worktreePath: string): WorktreeChange[] {
  const changes: WorktreeChange[] = [];
  const tracked = runGit(worktreePath, ['diff', '--name-status', '--find-renames=50%', 'HEAD']);
  if (tracked.code !== 0) {
    throw new Error(tracked.stderr.trim() || 'Failed to inspect worktree diff');
  }

  const seenPaths = new Set<string>();
  for (const line of tracked.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split('\t');
    const status = parts[0];
    if (status.startsWith('R') && parts[1] && parts[2]) {
      changes.push({
        kind: 'rename',
        previousPath: parts[1],
        path: parts[2],
      });
      seenPaths.add(parts[2]);
      continue;
    }
    const path = parts[1];
    if (!path) {
      continue;
    }
    const kind = status.startsWith('A')
      ? 'add'
      : status.startsWith('D')
        ? 'delete'
        : 'modify';
    changes.push({ kind, path });
    seenPaths.add(path);
  }

  const untracked = runGit(worktreePath, ['ls-files', '--others', '--exclude-standard']);
  if (untracked.code !== 0) {
    throw new Error(untracked.stderr.trim() || 'Failed to inspect untracked worktree files');
  }
  for (const line of untracked.stdout.split(/\r?\n/)) {
    const path = line.trim();
    if (!path || seenPaths.has(path)) {
      continue;
    }
    changes.push({ kind: 'untracked', path });
  }

  return changes;
}

function applyWorktreeMerge(
  worktreePath: string,
  sourceRepoRoot: string,
  changes: WorktreeChange[],
  sessionBaseDir: string,
  sessionId: string,
): number {
  if (changes.length === 0) {
    return 0;
  }

  const backupRoot = join(sessionBaseDir, '.worktree-merge-backups', sessionId);
  mkdirSync(backupRoot, { recursive: true });
  const backups: BackupEntry[] = [];
  const createdPaths: string[] = [];

  try {
    for (const change of changes) {
      if (change.kind === 'rename' && change.previousPath) {
        const previousTarget = resolveRepoFilePath(sourceRepoRoot, change.previousPath);
        backupExisting(previousTarget, backupRoot, backups);
        removePathIfPresent(previousTarget);
      }

      if (change.kind === 'delete') {
        const targetPath = resolveRepoFilePath(sourceRepoRoot, change.path);
        backupExisting(targetPath, backupRoot, backups);
        removePathIfPresent(targetPath);
        continue;
      }

      const sourcePath = resolveRepoFilePath(worktreePath, change.path);
      const targetPath = resolveRepoFilePath(sourceRepoRoot, change.path);
      const existed = existsSync(targetPath);
      backupExisting(targetPath, backupRoot, backups);
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
      if (!existed) {
        createdPaths.push(targetPath);
      }
    }
  } catch (error) {
    rollbackMerge(createdPaths, backups);
    rmSync(backupRoot, { recursive: true, force: true });
    throw error;
  }

  rmSync(backupRoot, { recursive: true, force: true });
  return changes.length;
}

function rollbackMerge(
  createdPaths: string[],
  backups: BackupEntry[],
): void {
  for (const createdPath of createdPaths) {
    removePathIfPresent(createdPath);
  }
  for (const backup of [...backups].reverse()) {
    if (!existsSync(backup.backupPath)) {
      continue;
    }
    mkdirSync(dirname(backup.originalPath), { recursive: true });
    renameSync(backup.backupPath, backup.originalPath);
  }
}

function backupExisting(
  targetPath: string,
  backupRoot: string,
  backups: BackupEntry[],
): void {
  if (!existsSync(targetPath)) {
    return;
  }

  const backupPath = join(
    backupRoot,
    createHash('sha1').update(targetPath).digest('hex'),
    basename(targetPath),
  );
  mkdirSync(dirname(backupPath), { recursive: true });
  renameSync(targetPath, backupPath);
  backups.push({
    originalPath: targetPath,
    backupPath,
  });
}

function removePathIfPresent(targetPath: string): void {
  if (!existsSync(targetPath)) {
    return;
  }

  const stats = statSync(targetPath);
  if (stats.isDirectory()) {
    rmSync(targetPath, { recursive: true, force: true });
    return;
  }

  unlinkSync(targetPath);
}

function detachWorktree(sourceRepoRoot: string, worktreePath: string): boolean {
  const removeResult = runGit(sourceRepoRoot, ['worktree', 'remove', '--force', worktreePath]);
  if (removeResult.code !== 0 && existsSync(worktreePath)) {
    return false;
  }

  runGit(sourceRepoRoot, ['worktree', 'prune']);
  return !existsSync(worktreePath);
}

function resolveRepoFilePath(rootPath: string, relativePath: string): string {
  return join(rootPath, ...relativePath.split('/'));
}

function runGit(cwd: string, args: string[]): CommandResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });

  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    timedOut: result.signal === 'SIGTERM',
  };
}
