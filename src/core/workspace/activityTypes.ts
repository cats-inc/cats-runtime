export type WorkspaceActivityCoverageStatus =
  | 'available' | 'partial' | 'unsupported' | 'unavailable';

export interface WorkspaceActivityCoverage {
  status: WorkspaceActivityCoverageStatus;
  reason?: string;
}

export interface RuntimeWorkspaceOperation {
  id: string;
  toolId?: string;
  executionId: string;
  kind: 'read' | 'write' | 'test' | 'git' | 'shell' | 'other';
  state: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  evidence: 'runtime_tool' | 'provider_structured';
  startedAt: string;
  endedAt?: string;
}

export interface RuntimeWorkspaceIdentity {
  checkoutId: string;
  executionLocationId: string;
  path: string;
  repository: {
    id: string;
    label: string;
    sourceRoot?: string;
  } | null;
  kind: 'original' | 'worktree' | 'non_git' | 'unknown';
  branch: string | null;
  detachedCommit: string | null;
  management: 'runtime_managed' | 'unmanaged' | 'unknown';
  verification: 'verified' | 'unverified' | 'unavailable';
}

export interface RuntimeObservedWorkspace extends RuntimeWorkspaceIdentity {
  /** Time identity/branch was probed; operation completion does not refresh it. */
  identityObservedAt: string;
  association: 'session_binding' | 'observed_operation';
  firstObservedAt: string;
  lastObservedAt: string;
  runningOperations: RuntimeWorkspaceOperation[];
  recentOperations: RuntimeWorkspaceOperation[];
}

export interface RuntimeWorkspaceActivitySnapshot {
  schemaVersion: 1;
  sessionId: string;
  observationEpoch: string;
  revision: number;
  observedAt: string;
  startupCwd: string;
  runtimeCwd: string;
  coverage: WorkspaceActivityCoverage;
  workspaces: RuntimeObservedWorkspace[];
  truncated: boolean;
}

export interface WorkspaceIdentityContext {
  cwd: string;
  executionLocationId: string;
  /** True only for a verified local execution mapping, never inferred from a path. */
  local: boolean;
  /** Trusted Runtime lifecycle state; observing a path cannot supply ownership. */
  managedWorktree?: { path: string; sourceRepoRoot: string };
}

export interface WorkspaceIdentityResult {
  workspace: RuntimeWorkspaceIdentity | null;
  reason?: 'unmapped_execution_location' | 'path_unavailable'
    | 'git_metadata_unavailable' | 'git_metadata_target';
}
