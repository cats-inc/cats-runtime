import { mkdirSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceMode } from './types.js';
import type { PermissionMode } from '../providers/types.js';

export interface ResolveWorkspaceInput {
  sessionId: string;
  sessionBaseDir: string;
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  permissionMode?: PermissionMode;
}

export interface ResolveWorkspaceResult {
  cwd: string;
  sourceCwd?: string;
  workspaceMode: WorkspaceMode;
  permissionMode: PermissionMode;
}

export function resolveWorkspace(input: ResolveWorkspaceInput): ResolveWorkspaceResult {
  let { workspaceMode, permissionMode } = input;
  const { sessionId, sessionBaseDir, cwd } = input;

  // Infer workspace mode if not specified
  if (!workspaceMode) {
    workspaceMode = cwd ? 'shared' : 'isolated';
  }

  switch (workspaceMode) {
    case 'isolated': {
      const sandboxDir = join(sessionBaseDir, sessionId);
      mkdirSync(sandboxDir, { recursive: true });
      return {
        cwd: sandboxDir,
        ...(cwd ? { sourceCwd: cwd } : {}),
        workspaceMode: 'isolated',
        permissionMode: 'skip',
      };
    }

    case 'shared': {
      if (!cwd) {
        throw new Error('cwd is required for shared workspace mode');
      }
      return {
        cwd,
        sourceCwd: cwd,
        workspaceMode: 'shared',
        permissionMode: permissionMode ?? 'skip',
      };
    }

    case 'read_only': {
      if (!cwd) {
        throw new Error('cwd is required for read_only workspace mode');
      }
      return {
        cwd,
        sourceCwd: cwd,
        workspaceMode: 'read_only',
        permissionMode: 'default',
      };
    }
  }
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
