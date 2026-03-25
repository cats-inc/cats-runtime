import type {
  SessionWorkspaceIsolationState,
  SessionWorkspaceState,
  WorkspaceAccess,
  WorkspaceIsolationMode,
  WorkspaceKind,
  WorkspaceMode,
} from '../types.js';

export function deriveWorkspaceIsolationMode(
  workspaceMode: WorkspaceMode | undefined,
): WorkspaceIsolationMode {
  return workspaceMode === 'isolated' ? 'isolated' : 'shared';
}

export function resolveLegacyWorkspaceRequest(
  workspaceMode: WorkspaceMode | undefined,
  workspaceIsolationMode: WorkspaceIsolationMode | undefined,
): {
  workspaceKind?: WorkspaceKind;
  workspaceAccess?: WorkspaceAccess;
} {
  if (!workspaceMode && !workspaceIsolationMode) {
    return {};
  }

  const requestedIsolation = workspaceIsolationMode ?? deriveWorkspaceIsolationMode(workspaceMode);
  return {
    workspaceKind: requestedIsolation === 'isolated'
      ? 'sandbox'
      : requestedIsolation === 'worktree'
        ? 'worktree'
        : 'source',
    workspaceAccess: workspaceMode
      ? (workspaceMode === 'read_only' ? 'read_only' : 'read_write')
      : undefined,
  };
}

export function toLegacyWorkspaceMode(
  workspaceKind: WorkspaceKind,
  workspaceAccess: WorkspaceAccess,
): WorkspaceMode {
  if (workspaceKind === 'sandbox') {
    return 'isolated';
  }

  return workspaceAccess === 'read_only' ? 'read_only' : 'shared';
}

export function toLegacyWorkspaceIsolationState(
  workspace: SessionWorkspaceState,
): SessionWorkspaceIsolationState {
  return {
    mode: workspace.kind === 'sandbox'
      ? 'isolated'
      : workspace.kind === 'worktree'
        ? 'worktree'
        : 'shared',
    ...(workspace.sourceCwd ? { sourceCwd: workspace.sourceCwd } : {}),
    ...(workspace.worktree ? { worktree: structuredClone(workspace.worktree) } : {}),
  };
}
