export type { CliRuntimeConfig as RuntimeConfig } from '../backends/cli/config.js';

export type SessionStatus =
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'closing'
  | 'closed';

export type SessionOrigin = 'runtime' | 'discovered';
export type SessionActivity = 'interactive' | 'tearing_down' | 'inactive';
export type SessionOwnership = 'persistent_process' | 'logical_session' | 'workspace_latest';
export type SessionResumeStrategy = 'none' | 'provider_session' | 'latest_in_workspace';
export type SessionControlMode = 'full' | 'resume_only' | 'observe_only';
export type ProviderBackend = 'cli' | 'api' | 'local' | 'agent';
export type SessionReusePolicy = 'create_new' | 'prefer_existing' | 'require_existing';

export type WorkspaceMode = 'isolated' | 'shared' | 'read_only';
export type WorkspaceSubstrateOperation =
  | 'init-workspace'
  | 'audit-workspace'
  | 'update-workspace';
export type WorkspaceSubstrateProfileId = 'minimal' | 'standard' | 'a2a-enabled';
export type WorkspaceSubstrateAuditStatus =
  | 'missing'
  | 'partial'
  | 'present'
  | 'drifted'
  | 'conflicting';
export type WorkspaceSubstrateFindingStatus =
  | 'missing'
  | 'present'
  | 'drifted'
  | 'conflicting';
export type WorkspaceSubstrateActionType =
  | 'create'
  | 'update'
  | 'skip'
  | 'warn'
  | 'write_sidecar';
export type WorkspaceSubstrateActorRole =
  | 'boss_cat'
  | 'specialist_cat'
  | 'system'
  | 'owner'
  | 'product_host'
  | 'operator';
export type SessionBranchMode = 'native_fork' | 'context_transplant';
export type SessionBranchPreference = 'auto' | SessionBranchMode;

export interface WorkspaceSubstrateHints {
  projectType?: 'single-project' | 'monorepo';
  purpose?: string;
  background?: string;
  technologyLabels?: string[];
  documentationStyle?: string;
}

export interface WorkspaceSubstrateAuthorizationInput {
  actorRole?: WorkspaceSubstrateActorRole;
  approved?: boolean;
}

export interface WorkspaceSubstrateAuthorization {
  actorRole?: WorkspaceSubstrateActorRole;
  approved: boolean;
  canApply: boolean;
  requiresApproval: boolean;
  reason: string;
}

export interface WorkspaceSubstrateRequest {
  operation: WorkspaceSubstrateOperation;
  workspacePath: string;
  profile?: WorkspaceSubstrateProfileId;
  enabledAgents?: Array<'claude' | 'gemini' | 'codex'>;
  includeA2A?: boolean;
  apply?: boolean;
  hints?: WorkspaceSubstrateHints;
  authorization?: WorkspaceSubstrateAuthorizationInput;
}

export interface WorkspaceSubstrateFinding {
  path: string;
  status: WorkspaceSubstrateFindingStatus;
  reason: string;
  managed?: boolean;
  actualHash?: string;
  desiredHash?: string;
  reviewCopyPath?: string;
}

export interface WorkspaceSubstrateAction {
  type: WorkspaceSubstrateActionType;
  path: string;
  reason: string;
  preview?: string;
  diff?: string;
  reviewCopyPath?: string;
  requiresApproval?: boolean;
}

export interface WorkspaceSubstrateSummary {
  expectedFileCount: number;
  changedPaths: string[];
  findingCounts: Record<WorkspaceSubstrateFindingStatus, number>;
  actionCounts: Record<WorkspaceSubstrateActionType, number>;
}

export interface WorkspaceSubstrateResult {
  operation: WorkspaceSubstrateOperation;
  workspacePath: string;
  profile: WorkspaceSubstrateProfileId;
  enabledAgents: Array<'claude' | 'gemini' | 'codex'>;
  includeA2A: boolean;
  status: WorkspaceSubstrateAuditStatus;
  authorization: WorkspaceSubstrateAuthorization;
  findings: WorkspaceSubstrateFinding[];
  actions: WorkspaceSubstrateAction[];
  applied: boolean;
  summary: WorkspaceSubstrateSummary;
}

export interface SessionContextTransplantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionContextTransplant {
  summary?: string;
  checkpoint?: string;
  transcriptExcerpt?: SessionContextTransplantMessage[];
  structuredBlocks?: unknown[];
  artifacts?: SessionArtifact[];
  labels?: string[];
  metadata?: Record<string, unknown>;
}

export interface SessionLineageNode {
  sessionId: string;
  provider: string;
}

export interface SessionBranchLineage {
  rootSessionId: string;
  parentSessionId: string;
  branchMode: SessionBranchMode;
  parentProvider: string;
  childProvider: string;
  createdAt: string;
  depth: number;
  chain: SessionLineageNode[];
}

export interface SessionBranchRequest {
  mode?: SessionBranchPreference;
  provider?: string;
  instance?: string;
  model?: string;
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  group?: string;
  instructions?: string;
  context?: SessionInvocationContext;
  outputDir?: string;
  transplant?: SessionContextTransplant;
}

export interface GeminiCachedContentState {
  name: string;
  key: string;
  model: string;
  prefixMessageCount: number;
  expiresAt?: string;
}

export interface SessionInvocationWorkspace {
  cwd?: string;
  workspaceId?: string;
  repoUrl?: string;
  repoRef?: string;
}

export interface SessionInvocationContext {
  source?: 'interactive' | 'timer' | 'callback' | 'assignment' | 'automation';
  reason?: string;
  taskId?: string;
  issueId?: string;
  commentId?: string;
  approvalId?: string;
  workspace?: SessionInvocationWorkspace;
  labels?: string[];
  metadata?: Record<string, unknown>;
}

export interface SessionArtifact {
  id: string;
  kind?: string;
  label?: string;
  path?: string;
  uri?: string;
  mediaType?: string;
  createdAt?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeService {
  id: string;
  name: string;
  url?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentSessionState {
  providerSessionId?: string;
  sessionKey?: string;
  runId?: string;
  status?: string;
  summary?: string;
  services?: AgentRuntimeService[];
  adapterState?: Record<string, unknown>;
}

export interface SessionProviderState {
  geminiCachedContent?: GeminiCachedContentState;
  agentSession?: AgentSessionState;
}

export interface SessionControls {
  canSend: boolean;
  canResume: boolean;
  canClose: boolean;
  canDelete: boolean;
  canRefresh: boolean;
}

export interface SessionInfo {
  id: string;
  providerName: string;
  providerBackend?: ProviderBackend;
  providerInstanceId?: string;
  providerSessionId?: string;
  providerState?: SessionProviderState;
  sessionKey?: string;
  reusePolicy?: SessionReusePolicy;
  status: SessionStatus;
  origin: SessionOrigin;
  cwd: string;
  workspaceMode?: WorkspaceMode;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  model?: string;
  group?: string;
  instructions?: string;
  context?: SessionInvocationContext;
  outputDir?: string;
  artifacts?: SessionArtifact[];
  // Deprecated legacy flag kept only for backward-compat payload tolerance.
  managed?: boolean;
  summary?: string;
  sourcePath?: string;
  providerSourcePath?: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  createdAt: string;
  updatedAt: string;
  lastActivity?: string;
}

export interface SessionView extends SessionInfo {
  workspaceKey: string;
  activity: SessionActivity;
  ownership: SessionOwnership;
  resumeStrategy: SessionResumeStrategy;
  controlMode: SessionControlMode;
  attached: boolean;
  controls: SessionControls;
}

export interface ProviderCapabilities {
  resume: boolean;
  fork: boolean;
  permissions: boolean;
}

export type PermissionMode = 'skip' | 'whitelist' | 'default';

export interface ProviderSpawnOptions {
  cwd: string;
  workspaceMode?: WorkspaceMode;
  model?: string;
  resumeSessionId?: string;
  resumeSourcePath?: string;
  forkSession?: boolean;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
}

export interface ProviderTurnOptions extends ProviderSpawnOptions {
  signal?: AbortSignal;
}

export interface ProviderMessage {
  role: 'user';
  content: string;
}

export interface TurnInput {
  message: string;
  instructions?: string;
  context?: SessionInvocationContext;
  outputDir?: string;
}

export interface StreamEvent {
  type: 'init' | 'text' | 'tool_use' | 'tool_result' | 'result' | 'error' | 'raw' | 'progress';
  sessionId?: string;
  providerSessionId?: string;
  text?: string;
  toolName?: string;
  toolId?: string;
  toolArgs?: Record<string, unknown>;
  isError?: boolean;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  summary?: string;
  artifacts?: SessionArtifact[];
  services?: AgentRuntimeService[];
  providerState?: SessionProviderState;
  metadata?: Record<string, unknown>;
  raw?: unknown;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unavailable';
  checkedAt: string;
  details?: string;
}

export interface ExecutionHandle {
  readonly active: boolean;
  readonly busy: boolean;
  streamMessage(input: string | TurnInput): AsyncGenerator<StreamEvent>;
  kill(): void;
  on(event: 'event' | 'exit' | 'error', listener: (...args: unknown[]) => void): this;
  off(event: 'event' | 'exit' | 'error', listener: (...args: unknown[]) => void): this;
}
