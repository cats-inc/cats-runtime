import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type {
  PermissionMode,
  SessionWorkspaceIsolationState,
  SessionWorkspaceState,
  WorktreeCleanupPolicy,
  WorktreeCleanupStatus,
  WorkspaceAccess,
  WorkspaceKind,
  WorkspaceIsolationMode,
  WorkspaceMode,
} from '../types.js';
import {
  deriveWorkspaceIsolationMode,
  resolveLegacyWorkspaceRequest,
  toLegacyWorkspaceIsolationState,
  toLegacyWorkspaceMode,
} from './legacyWorkspace.js';
export { deriveWorkspaceIsolationMode } from './legacyWorkspace.js';

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
  workspaceKind?: WorkspaceKind;
  workspaceAccess?: WorkspaceAccess;
  workspaceMode?: WorkspaceMode;
  workspaceIsolationMode?: WorkspaceIsolationMode;
  permissionMode?: PermissionMode;
  now?: Date;
}

export interface PrepareSessionWorkspaceResult {
  cwd: string;
  sourceCwd?: string;
  permissionMode: PermissionMode;
  workspace: SessionWorkspaceState;
  workspaceMode: WorkspaceMode;
  workspaceIsolation: SessionWorkspaceIsolationState;
}

export interface CleanupSessionWorkspaceInput {
  sessionId: string;
  sessionBaseDir: string;
  workspace?: SessionWorkspaceState;
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
  nextWorkspace?: SessionWorkspaceState;
  nextWorkspaceIsolation?: SessionWorkspaceIsolationState;
}

export interface CopyWorkspaceSnapshotResult {
  copiedFileCount: number;
  copiedByteCount: number;
  skippedGitMetadata: boolean;
}

export interface CleanupOrphanedWorktreeResult {
  removed: boolean;
  reasonCodes: string[];
  sourceRepoRoot?: string;
}

export async function prepareSessionWorkspace(
  input: PrepareSessionWorkspaceInput,
): Promise<PrepareSessionWorkspaceResult> {
  const resolvedLegacy = resolveLegacyWorkspaceRequest(
    input.workspaceMode,
    input.workspaceIsolationMode,
  );
  const requestedKind = input.workspaceKind
    ?? resolvedLegacy.workspaceKind
    ?? (input.cwd ? 'source' : 'sandbox');
  const requestedAccess = input.workspaceAccess
    ?? resolvedLegacy.workspaceAccess
    ?? 'read_write';
  const permissionMode = resolvePermissionMode(requestedKind, requestedAccess, input.permissionMode);
  const now = (input.now ?? new Date()).toISOString();

  if (requestedKind === 'sandbox') {
    const sandboxDir = join(input.sessionBaseDir, input.sessionId);
    await mkdir(sandboxDir, { recursive: true });
    return {
      cwd: sandboxDir,
      ...(input.cwd ? { sourceCwd: input.cwd } : {}),
      permissionMode,
      workspaceMode: toLegacyWorkspaceMode('sandbox', requestedAccess),
      workspaceIsolation: toLegacyWorkspaceIsolationState({
        kind: 'sandbox',
        access: requestedAccess,
        runtimeCwd: sandboxDir,
        ...(input.cwd ? { sourceCwd: input.cwd } : {}),
      }),
      workspace: {
        kind: 'sandbox',
        access: requestedAccess,
        runtimeCwd: sandboxDir,
        ...(input.cwd ? { sourceCwd: input.cwd } : {}),
      },
    };
  }

  if (!input.cwd) {
    throw new Error(`cwd is required for workspaceKind=${requestedKind}`);
  }

  if (requestedKind === 'source') {
    return {
      cwd: input.cwd,
      sourceCwd: input.cwd,
      permissionMode,
      workspaceMode: toLegacyWorkspaceMode('source', requestedAccess),
      workspaceIsolation: toLegacyWorkspaceIsolationState({
        kind: 'source',
        access: requestedAccess,
        runtimeCwd: input.cwd,
        sourceCwd: input.cwd,
      }),
      workspace: {
        kind: 'source',
        access: requestedAccess,
        runtimeCwd: input.cwd,
        sourceCwd: input.cwd,
      },
    };
  }

  const sourceCwd = input.cwd;
  const sourceRepoRoot = await resolveGitRepoRoot(sourceCwd);
  const relativeCwd = resolveRelativeRepoPath(sourceRepoRoot, sourceCwd);
  const worktreePath = buildWorktreePath(input.sessionBaseDir, sourceRepoRoot, input.sessionId);

  if (!(await pathExists(worktreePath))) {
    await mkdir(dirname(worktreePath), { recursive: true });
    const addResult = await runGit(sourceRepoRoot, ['worktree', 'add', '--detach', worktreePath, 'HEAD']);
    if (addResult.code !== 0) {
      throw new Error(addResult.stderr.trim() || 'Failed to prepare git worktree');
    }
  }

  const runtimeCwd = relativeCwd ? join(worktreePath, relativeCwd) : worktreePath;
  const sourceHeadRef = await readGitValue(sourceRepoRoot, ['symbolic-ref', '-q', '--short', 'HEAD']);
  const sourceHeadOid = await readGitValue(sourceRepoRoot, ['rev-parse', 'HEAD']);

  const workspace: SessionWorkspaceState = {
    kind: 'worktree',
    access: requestedAccess,
    runtimeCwd,
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
  };

  return {
    cwd: runtimeCwd,
    sourceCwd,
    permissionMode,
    workspaceMode: toLegacyWorkspaceMode('worktree', requestedAccess),
    workspaceIsolation: toLegacyWorkspaceIsolationState(workspace),
    workspace,
  };
}

export async function cleanupSessionWorkspace(
  input: CleanupSessionWorkspaceInput,
): Promise<CleanupSessionWorkspaceResult> {
  const workspace = input.workspace ?? normalizeLegacyWorkspaceState(input);
  if (workspace?.kind === 'worktree' && workspace.worktree) {
    return cleanupWorktreeWorkspace(
      input,
      workspace as SessionWorkspaceState & {
        kind: 'worktree';
        worktree: NonNullable<SessionWorkspaceState['worktree']>;
      },
    );
  }

  if (workspace?.kind === 'sandbox') {
    const sandboxDir = join(input.sessionBaseDir, input.sessionId);
    try {
      await rm(sandboxDir, { recursive: true, force: true });
      return {
        status: 'completed',
        workspaceCleaned: true,
        worktreeDetached: false,
        mergedPathCount: 0,
        reasonCodes: ['sandbox_workspace_removed'],
        nextWorkspaceIsolation: undefined,
      };
    } catch {
      return {
        status: 'retained',
        workspaceCleaned: false,
        worktreeDetached: false,
        mergedPathCount: 0,
        reasonCodes: ['sandbox_workspace_cleanup_failed'],
        nextWorkspaceIsolation: undefined,
      };
    }
  }

  return {
    status: 'completed',
    workspaceCleaned: false,
    worktreeDetached: false,
    mergedPathCount: 0,
    reasonCodes: ['source_workspace_retained'],
    nextWorkspaceIsolation: undefined,
  };
}

export async function copyWorkspaceSnapshot(
  sourceCwd: string,
  targetCwd: string,
  options: {
    skipGitMetadata?: boolean;
  } = {},
): Promise<CopyWorkspaceSnapshotResult> {
  if (!(await pathExists(sourceCwd))) {
    return {
      copiedFileCount: 0,
      copiedByteCount: 0,
      skippedGitMetadata: Boolean(options.skipGitMetadata),
    };
  }

  const queue: Array<{ source: string; target: string }> = [
    { source: sourceCwd, target: targetCwd },
  ];
  let copiedFileCount = 0;
  let copiedByteCount = 0;

  while (queue.length > 0) {
    const current = queue.pop()!;
    await mkdir(current.target, { recursive: true });
    const entries = await readdir(current.source, { withFileTypes: true });
    for (const entry of entries) {
      if (options.skipGitMetadata && entry.name === '.git') {
        continue;
      }

      const sourcePath = join(current.source, entry.name);
      const targetPath = join(current.target, entry.name);
      if (entry.isDirectory()) {
        queue.push({ source: sourcePath, target: targetPath });
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      const sourceStats = await stat(sourcePath);
      copiedFileCount += 1;
      copiedByteCount += sourceStats.size;
    }
  }

  return {
    copiedFileCount,
    copiedByteCount,
    skippedGitMetadata: Boolean(options.skipGitMetadata),
  };
}

export async function cleanupOrphanedWorktree(
  worktreePath: string,
): Promise<CleanupOrphanedWorktreeResult> {
  if (!(await pathExists(worktreePath))) {
    return {
      removed: true,
      reasonCodes: ['worktree_missing'],
    };
  }

  const sourceRepoRoot = await resolveWorktreeSourceRepoRoot(worktreePath);
  if (sourceRepoRoot) {
    const detached = await detachWorktree(sourceRepoRoot, worktreePath);
    if (detached) {
      return {
        removed: true,
        reasonCodes: ['orphaned_worktree_detached'],
        sourceRepoRoot,
      };
    }
  }

  try {
    await rm(worktreePath, { recursive: true, force: true });
    return {
      removed: true,
      reasonCodes: sourceRepoRoot
        ? ['orphaned_worktree_removed_after_detach_failed']
        : ['orphaned_worktree_removed_without_repo_metadata'],
      ...(sourceRepoRoot ? { sourceRepoRoot } : {}),
    };
  } catch {
    return {
      removed: false,
      reasonCodes: sourceRepoRoot
        ? ['orphaned_worktree_cleanup_failed']
        : ['orphaned_worktree_cleanup_failed_without_repo_metadata'],
      ...(sourceRepoRoot ? { sourceRepoRoot } : {}),
    };
  }
}

async function cleanupWorktreeWorkspace(
  input: CleanupSessionWorkspaceInput,
  workspace: SessionWorkspaceState & {
    kind: 'worktree';
    worktree: NonNullable<SessionWorkspaceState['worktree']>;
  },
): Promise<CleanupSessionWorkspaceResult> {
  const policy = input.worktreeCleanupPolicy ?? 'discard';
  const observedAt = (input.now ?? new Date()).toISOString();
  const reasonCodes: string[] = [];
  const worktree = workspace.worktree;
  const sourceCwd = workspace.sourceCwd ?? worktree.sourceRepoRoot;
  let mergedPathCount = 0;

  if (policy === 'merge') {
    if (!(await sourceRepoIsClean(worktree.sourceRepoRoot))) {
      return {
        status: 'retained',
        workspaceCleaned: false,
        worktreeDetached: false,
        mergedPathCount: 0,
        policy,
        reasonCodes: ['source_workspace_dirty'],
        nextCwd: worktree.worktreePath,
        nextWorkspace: {
          ...workspace,
          runtimeCwd: worktree.worktreePath,
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
        nextWorkspaceIsolation: toLegacyWorkspaceIsolationState({
          ...workspace,
          runtimeCwd: worktree.worktreePath,
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
        }),
      };
    }

    try {
      const changes = await collectWorktreeChanges(worktree.worktreePath);
      mergedPathCount = await applyWorktreeMerge(
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
        nextCwd: worktree.worktreePath,
        nextWorkspace: {
          ...workspace,
          runtimeCwd: worktree.worktreePath,
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
        nextWorkspaceIsolation: toLegacyWorkspaceIsolationState({
          ...workspace,
          runtimeCwd: worktree.worktreePath,
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
        }),
      };
    }
  } else if (policy === 'preserve') {
    return {
      status: 'retained',
      workspaceCleaned: false,
      worktreeDetached: false,
      mergedPathCount: 0,
      policy,
      reasonCodes: ['worktree_preserved'],
      nextCwd: worktree.worktreePath,
      nextWorkspace: {
        ...workspace,
        runtimeCwd: worktree.worktreePath,
        worktree: {
          ...worktree,
          lastCleanup: {
            policy,
            status: 'retained',
            observedAt,
            reasonCodes: ['worktree_preserved'],
            mergedPathCount: 0,
          },
        },
      },
      nextWorkspaceIsolation: toLegacyWorkspaceIsolationState({
        ...workspace,
        runtimeCwd: worktree.worktreePath,
        worktree: {
          ...worktree,
          lastCleanup: {
            policy,
            status: 'retained',
            observedAt,
            reasonCodes: ['worktree_preserved'],
            mergedPathCount: 0,
          },
        },
      }),
    };
  } else {
    reasonCodes.push('worktree_changes_discarded');
  }

  const detached = await detachWorktree(worktree.sourceRepoRoot, worktree.worktreePath);
  if (!detached) {
    return {
      status: 'retained',
      workspaceCleaned: false,
      worktreeDetached: false,
      mergedPathCount: 0,
      policy,
      reasonCodes: [...reasonCodes, 'worktree_detach_failed'],
      nextCwd: worktree.worktreePath,
      nextWorkspace: {
        ...workspace,
        runtimeCwd: worktree.worktreePath,
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
      nextWorkspaceIsolation: toLegacyWorkspaceIsolationState({
        ...workspace,
        runtimeCwd: worktree.worktreePath,
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
      }),
    };
  }

  const nextWorkspace: SessionWorkspaceState = {
    kind: 'worktree',
    access: workspace.access,
    runtimeCwd: sourceCwd,
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
  };

  return {
    status: 'completed',
    workspaceCleaned: true,
    worktreeDetached: true,
    mergedPathCount,
    policy,
    reasonCodes,
    nextCwd: sourceCwd,
    nextWorkspace,
    nextWorkspaceIsolation: toLegacyWorkspaceIsolationState(nextWorkspace),
  };
}

function normalizeLegacyWorkspaceState(
  input: CleanupSessionWorkspaceInput,
): SessionWorkspaceState | undefined {
  const resolvedLegacy = resolveLegacyWorkspaceRequest(
    input.workspaceMode,
    input.workspaceIsolation?.mode,
  );
  if (!resolvedLegacy.workspaceKind) {
    return undefined;
  }

  const sourceCwd = input.workspaceIsolation?.sourceCwd;
  if (resolvedLegacy.workspaceKind === 'sandbox') {
    return {
      kind: 'sandbox',
      access: resolvedLegacy.workspaceAccess ?? 'read_write',
      runtimeCwd: join(input.sessionBaseDir, input.sessionId),
      ...(sourceCwd ? { sourceCwd } : {}),
    };
  }

  if (resolvedLegacy.workspaceKind === 'worktree') {
    const worktree = input.workspaceIsolation?.worktree;
    const runtimeCwd = worktree
      ? worktree.relativeCwd
        ? join(worktree.worktreePath, worktree.relativeCwd)
        : worktree.worktreePath
      : sourceCwd ?? join(input.sessionBaseDir, input.sessionId);
    return {
      kind: 'worktree',
      access: resolvedLegacy.workspaceAccess ?? 'read_write',
      runtimeCwd,
      ...(sourceCwd ? { sourceCwd } : {}),
      ...(worktree ? { worktree: structuredClone(worktree) } : {}),
    };
  }

  return {
    kind: 'source',
    access: resolvedLegacy.workspaceAccess ?? 'read_write',
    runtimeCwd: sourceCwd ?? join(input.sessionBaseDir, input.sessionId),
    ...(sourceCwd ? { sourceCwd } : {}),
  };
}

function resolvePermissionMode(
  workspaceKind: WorkspaceKind,
  workspaceAccess: WorkspaceAccess,
  permissionMode?: PermissionMode,
): PermissionMode {
  if (workspaceKind === 'sandbox' && workspaceAccess !== 'read_only') {
    return 'skip';
  }
  return workspaceAccess === 'read_only'
    ? 'default'
    : permissionMode ?? 'skip';
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
  if (normalized.length === 0 || normalized === '.' || normalized === '..') {
    return 'workspace';
  }
  return normalized;
}

async function resolveGitRepoRoot(cwd: string): Promise<string> {
  const result = await runGit(cwd, ['rev-parse', '--show-toplevel']);
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

async function readGitValue(cwd: string, args: string[]): Promise<string | undefined> {
  const result = await runGit(cwd, args);
  if (result.code !== 0) {
    return undefined;
  }
  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

async function resolveWorktreeSourceRepoRoot(
  worktreePath: string,
): Promise<string | undefined> {
  const commonDir = await readGitValue(worktreePath, ['rev-parse', '--git-common-dir']);
  if (commonDir) {
    const resolvedCommonDir = resolve(worktreePath, commonDir);
    if (basename(resolvedCommonDir).toLowerCase() === '.git') {
      return dirname(resolvedCommonDir);
    }
  }

  const gitFilePath = join(worktreePath, '.git');
  if (!(await pathExists(gitFilePath))) {
    return undefined;
  }

  try {
    const raw = await readFile(gitFilePath, 'utf8');
    const match = raw.match(/gitdir:\s*(.+)\s*$/i);
    if (!match?.[1]) {
      return undefined;
    }
    const resolvedGitDir = resolve(worktreePath, match[1].trim());
    const normalizedGitDir = resolvedGitDir.replace(/\\/g, '/');
    const worktreesMarker = normalizedGitDir.lastIndexOf('/.git/worktrees/');
    if (worktreesMarker < 0) {
      return undefined;
    }
    return resolvedGitDir.slice(0, worktreesMarker);
  } catch {
    return undefined;
  }
}

async function sourceRepoIsClean(sourceRepoRoot: string): Promise<boolean> {
  const result = await runGit(sourceRepoRoot, ['status', '--porcelain']);
  return result.code === 0 && result.stdout.trim().length === 0;
}

async function collectWorktreeChanges(worktreePath: string): Promise<WorktreeChange[]> {
  const changes: WorktreeChange[] = [];
  const tracked = await runGit(worktreePath, ['diff', '--name-status', '--find-renames=50%', 'HEAD']);
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

  const untracked = await runGit(worktreePath, ['ls-files', '--others', '--exclude-standard']);
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

async function applyWorktreeMerge(
  worktreePath: string,
  sourceRepoRoot: string,
  changes: WorktreeChange[],
  sessionBaseDir: string,
  sessionId: string,
): Promise<number> {
  if (changes.length === 0) {
    return 0;
  }

  const backupRoot = join(sessionBaseDir, '.worktree-merge-backups', sessionId);
  await mkdir(backupRoot, { recursive: true });
  const backups: BackupEntry[] = [];
  const createdPaths: string[] = [];

  try {
    for (const change of changes) {
      if (change.kind === 'rename' && change.previousPath) {
        const previousTarget = resolveRepoFilePath(sourceRepoRoot, change.previousPath);
        await backupExisting(previousTarget, backupRoot, backups);
        await removePathIfPresent(previousTarget);
      }

      if (change.kind === 'delete') {
        const targetPath = resolveRepoFilePath(sourceRepoRoot, change.path);
        await backupExisting(targetPath, backupRoot, backups);
        await removePathIfPresent(targetPath);
        continue;
      }

      const sourcePath = resolveRepoFilePath(worktreePath, change.path);
      const targetPath = resolveRepoFilePath(sourceRepoRoot, change.path);
      const existed = await pathExists(targetPath);
      await backupExisting(targetPath, backupRoot, backups);
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      if (!existed) {
        createdPaths.push(targetPath);
      }
    }
  } catch (error) {
    await rollbackMerge(createdPaths, backups);
    await rm(backupRoot, { recursive: true, force: true });
    throw error;
  }

  await rm(backupRoot, { recursive: true, force: true });
  return changes.length;
}

async function rollbackMerge(
  createdPaths: string[],
  backups: BackupEntry[],
): Promise<void> {
  for (const createdPath of createdPaths) {
    await removePathIfPresent(createdPath);
  }
  for (const backup of [...backups].reverse()) {
    if (!(await pathExists(backup.backupPath))) {
      continue;
    }
    await mkdir(dirname(backup.originalPath), { recursive: true });
    await rename(backup.backupPath, backup.originalPath);
  }
}

async function backupExisting(
  targetPath: string,
  backupRoot: string,
  backups: BackupEntry[],
): Promise<void> {
  if (!(await pathExists(targetPath))) {
    return;
  }

  const backupPath = join(
    backupRoot,
    createHash('sha1').update(targetPath).digest('hex'),
    basename(targetPath),
  );
  await mkdir(dirname(backupPath), { recursive: true });
  await rename(targetPath, backupPath);
  backups.push({
    originalPath: targetPath,
    backupPath,
  });
}

async function removePathIfPresent(targetPath: string): Promise<void> {
  if (!(await pathExists(targetPath))) {
    return;
  }

  const stats = await stat(targetPath);
  if (stats.isDirectory()) {
    await rm(targetPath, { recursive: true, force: true });
    return;
  }

  await unlink(targetPath);
}

async function detachWorktree(sourceRepoRoot: string, worktreePath: string): Promise<boolean> {
  const removeResult = await runGit(sourceRepoRoot, ['worktree', 'remove', '--force', worktreePath]);
  if (removeResult.code !== 0 && await pathExists(worktreePath)) {
    return false;
  }

  await runGit(sourceRepoRoot, ['worktree', 'prune']);
  return !(await pathExists(worktreePath));
}

function resolveRepoFilePath(rootPath: string, relativePath: string): string {
  return join(rootPath, ...relativePath.split('/'));
}

async function pathExists(path: string | undefined): Promise<boolean> {
  if (!path) {
    return false;
  }
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runGit(cwd: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, GIT_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveResult({
        code,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}
