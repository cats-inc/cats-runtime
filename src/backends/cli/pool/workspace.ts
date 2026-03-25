import { mkdirSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import type {
  WorkspaceAccess,
  WorkspaceIsolationMode,
  WorkspaceKind,
  WorkspaceMode,
} from './types.js';
import type { PermissionMode } from '../providers/types.js';

export interface ResolveWorkspaceInput {
  sessionId: string;
  sessionBaseDir: string;
  cwd?: string;
  workspaceKind?: WorkspaceKind;
  workspaceAccess?: WorkspaceAccess;
  workspaceMode?: WorkspaceMode;
  workspaceIsolation?: WorkspaceIsolationMode;
  permissionMode?: PermissionMode;
}

export interface ResolveWorkspaceResult {
  cwd: string;
  sourceCwd?: string;
  workspaceKind: WorkspaceKind;
  workspaceAccess: WorkspaceAccess;
  workspaceMode: WorkspaceMode;
  permissionMode: PermissionMode;
}

export function resolveWorkspace(input: ResolveWorkspaceInput): ResolveWorkspaceResult {
  const legacy = resolveLegacyWorkspaceRequest(input.workspaceMode, input.workspaceIsolation);
  const workspaceKind = input.workspaceKind ?? legacy.workspaceKind ?? (input.cwd ? 'source' : 'sandbox');
  const workspaceAccess = input.workspaceAccess ?? legacy.workspaceAccess ?? 'read_write';
  const workspaceMode = toLegacyWorkspaceMode(workspaceKind, workspaceAccess);
  const permissionMode = resolvePermissionMode(workspaceKind, workspaceAccess, input.permissionMode);
  const { sessionId, sessionBaseDir, cwd } = input;

  switch (workspaceKind) {
    case 'sandbox': {
      const sandboxDir = join(sessionBaseDir, sessionId);
      mkdirSync(sandboxDir, { recursive: true });
      return {
        cwd: sandboxDir,
        ...(cwd ? { sourceCwd: cwd } : {}),
        workspaceKind: 'sandbox',
        workspaceAccess,
        workspaceMode,
        permissionMode,
      };
    }

    case 'source': {
      if (!cwd) {
        throw new Error(`cwd is required for ${workspaceMode} workspace mode`);
      }
      return {
        cwd,
        sourceCwd: cwd,
        workspaceKind: 'source',
        workspaceAccess,
        workspaceMode,
        permissionMode,
      };
    }

    case 'worktree':
      throw new Error('CLI pool workspace resolver does not support workspaceKind=worktree');
  }
}

function resolveLegacyWorkspaceRequest(
  workspaceMode: WorkspaceMode | undefined,
  workspaceIsolation: WorkspaceIsolationMode | undefined,
): {
  workspaceKind?: WorkspaceKind;
  workspaceAccess?: WorkspaceAccess;
} {
  if (!workspaceMode && !workspaceIsolation) {
    return {};
  }

  const resolvedIsolation = workspaceIsolation
    ?? (workspaceMode === 'isolated' ? 'isolated' : 'shared');
  return {
    workspaceKind: resolvedIsolation === 'isolated'
      ? 'sandbox'
      : resolvedIsolation === 'worktree'
        ? 'worktree'
        : 'source',
    workspaceAccess: workspaceMode === 'read_only' ? 'read_only' : 'read_write',
  };
}

function toLegacyWorkspaceMode(
  workspaceKind: WorkspaceKind,
  workspaceAccess: WorkspaceAccess,
): WorkspaceMode {
  if (workspaceKind === 'sandbox') {
    return 'isolated';
  }
  return workspaceAccess === 'read_only' ? 'read_only' : 'shared';
}

function resolvePermissionMode(
  workspaceKind: WorkspaceKind,
  workspaceAccess: WorkspaceAccess,
  permissionMode?: PermissionMode,
): PermissionMode {
  if (workspaceKind === 'sandbox') {
    return 'skip';
  }
  return workspaceAccess === 'read_only' ? 'default' : permissionMode ?? 'skip';
}

/**
 * Copy the contents of a parent isolated sandbox into a new sandbox
 * so that a forked session inherits the parent's file-system state.
 */
export function copyIsolatedWorkspace(sessionBaseDir: string, parentSessionId: string, childSessionId: string): void {
  const src = join(sessionBaseDir, parentSessionId);
  const dst = join(sessionBaseDir, childSessionId);
  mkdirSync(dst, { recursive: true });
  try {
    cpSync(src, dst, { recursive: true });
  } catch {
    // Source may be empty or missing — child gets an empty sandbox
  }
}

export function cleanupIsolatedWorkspace(sessionBaseDir: string, sessionId: string): boolean {
  const sandboxDir = join(sessionBaseDir, sessionId);
  try {
    rmSync(sandboxDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
