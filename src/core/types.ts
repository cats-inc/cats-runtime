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
export type WorkspaceSubstrateExecutionMode = 'preview' | 'apply';
export type WorkspaceSubstrateApplyDecision =
  | 'not_requested'
  | 'read_only_operation'
  | 'blocked'
  | 'applied';
export type WorkspaceSubstrateMergeStrategy =
  | 'create'
  | 'update_managed'
  | 'review_copy'
  | 'noop';
export type WorkspaceSubstrateActorRole =
  | 'boss_cat'
  | 'specialist_cat'
  | 'system'
  | 'owner'
  | 'product_host'
  | 'operator';
export type RuntimeDeliveryAction =
  | 'audit-delivery-target'
  | 'publish-artifacts'
  | 'inspect-repo-status'
  | 'create-commit'
  | 'push-branch';
export type RuntimeDeliveryState =
  | 'ready'
  | 'blocked'
  | 'unsupported'
  | 'degraded'
  | 'completed';
export type RuntimeDeliveryCapabilityState =
  | 'ready'
  | 'blocked'
  | 'unsupported'
  | 'degraded';
export type RuntimeDeliveryApplyDecision =
  | 'not_requested'
  | 'read_only_operation'
  | 'blocked'
  | 'applied';
export type RuntimePreviewSurfaceKind = 'service' | 'artifact';
export type RuntimePreviewSurfaceSource =
  | 'session_service'
  | 'session_artifact'
  | 'request_service'
  | 'request_artifact'
  | 'published_artifact';
export type RuntimePreviewSurfaceRenderHint =
  | 'iframe'
  | 'open_external'
  | 'download'
  | 'none';
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

export interface WorkspaceSubstrateContract {
  mode: WorkspaceSubstrateExecutionMode;
  safeDefaultMode: 'preview';
  applyRequested: boolean;
  applyDecision: WorkspaceSubstrateApplyDecision;
  readOnly: boolean;
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

export interface WorkspaceSubstrateDiffStats {
  changed: boolean;
  addedLines: number;
  removedLines: number;
}

export interface WorkspaceSubstrateAction {
  type: WorkspaceSubstrateActionType;
  path: string;
  reason: string;
  outputPath?: string;
  mergeStrategy?: WorkspaceSubstrateMergeStrategy;
  managed?: boolean;
  actualHash?: string;
  desiredHash?: string;
  preview?: string;
  diff?: string;
  diffStats?: WorkspaceSubstrateDiffStats;
  reviewCopyPath?: string;
  requiresApproval?: boolean;
}

export interface WorkspaceSubstrateApplyPayload {
  operation: 'init-workspace' | 'update-workspace';
  workspacePath: string;
  profile: WorkspaceSubstrateProfileId;
  enabledAgents: Array<'claude' | 'gemini' | 'codex'>;
  includeA2A: boolean;
  hints?: WorkspaceSubstrateHints;
  apply: true;
}

export interface WorkspaceSubstratePlan {
  stepCount: number;
  changedPaths: string[];
  reviewCopyPaths: string[];
  pendingApprovalPaths: string[];
  requiresApproval: boolean;
  applyPayload?: WorkspaceSubstrateApplyPayload;
}

export interface WorkspaceSubstrateApprovalPayload {
  required: boolean;
  reason: string;
  privilegedActorRoles: Array<'boss_cat' | 'system' | 'owner'>;
  blockedPaths: string[];
  applyPayload?: WorkspaceSubstrateApplyPayload;
}

export interface WorkspaceSubstrateSummary {
  expectedFileCount: number;
  changedPaths: string[];
  reviewCopyPaths: string[];
  pendingApprovalPaths: string[];
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
  contract: WorkspaceSubstrateContract;
  authorization: WorkspaceSubstrateAuthorization;
  plan: WorkspaceSubstratePlan;
  approval: WorkspaceSubstrateApprovalPayload;
  findings: WorkspaceSubstrateFinding[];
  actions: WorkspaceSubstrateAction[];
  applied: boolean;
  summary: WorkspaceSubstrateSummary;
}

export interface RuntimeDeliveryAuthorizationInput {
  actorRole?: WorkspaceSubstrateActorRole;
  approved?: boolean;
}

export interface RuntimeDeliveryAuthorization {
  actorRole?: WorkspaceSubstrateActorRole;
  approved: boolean;
  canApply: boolean;
  requiresApproval: boolean;
  reason: string;
}

export interface RuntimeDeliveryContract {
  mode: WorkspaceSubstrateExecutionMode;
  safeDefaultMode: 'preview';
  applyRequested: boolean;
  applyDecision: RuntimeDeliveryApplyDecision;
  readOnly: boolean;
}

export interface RuntimeDeliveryIssue {
  code: string;
  state: Exclude<RuntimeDeliveryCapabilityState, 'ready'>;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeDeliveryWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeDeliveryCapability {
  supported: boolean;
  available: boolean;
  state: RuntimeDeliveryCapabilityState;
  reason?: string;
}

export interface RuntimeDeliveryCapabilities {
  artifactPublication: RuntimeDeliveryCapability;
  repoStatus: RuntimeDeliveryCapability;
  commit: RuntimeDeliveryCapability;
  push: RuntimeDeliveryCapability;
  previewSurfaces: RuntimeDeliveryCapability;
}

export interface RuntimeDeliveryApplyPayload {
  action: RuntimeDeliveryAction;
  workspacePath?: string;
  sessionId?: string;
  artifactIds?: string[];
  apply: true;
  authorization?: RuntimeDeliveryAuthorizationInput;
  publication?: RuntimeArtifactPublicationRequest;
  repo?: RuntimeRepoDeliveryRequest;
  preview?: RuntimePreviewCollectionRequest;
  context?: Record<string, unknown>;
}

export interface RuntimeDeliveryApprovalPayload {
  required: boolean;
  reason: string;
  privilegedActorRoles: Array<'boss_cat' | 'system' | 'owner'>;
  applyPayload?: RuntimeDeliveryApplyPayload;
}

export interface RuntimePreviewSurfaceProvenance {
  sessionId?: string;
  provider?: string;
  workspacePath?: string;
  artifactId?: string;
  serviceId?: string;
  publicationDirectory?: string;
}

export interface RuntimePreviewSurface {
  id: string;
  kind: RuntimePreviewSurfaceKind;
  source: RuntimePreviewSurfaceSource;
  status: RuntimeDeliveryCapabilityState;
  label?: string;
  renderHint: RuntimePreviewSurfaceRenderHint;
  url?: string;
  artifactId?: string;
  path?: string;
  mediaType?: string;
  provenance?: RuntimePreviewSurfaceProvenance;
  metadata?: Record<string, unknown>;
}

export interface RuntimeArtifactPublicationRequest {
  directory?: string;
  manifestFileName?: string;
  publicBaseUrl?: string;
}

export interface RuntimeArtifactPublicationRecord {
  id: string;
  label?: string;
  sourcePath?: string;
  sourceUri?: string;
  outputPath?: string;
  publicUrl?: string;
  mediaType?: string;
  sizeBytes?: number;
  copied: boolean;
  previewSurfaceId?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeRepoDeliveryRequest {
  message?: string;
  stageAll?: boolean;
  allowEmpty?: boolean;
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  forceWithLease?: boolean;
}

export interface RuntimePreviewCollectionRequest {
  includeSessionArtifacts?: boolean;
  includeSessionServices?: boolean;
}

export interface RuntimeRepoRemoteStatus {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface RuntimeRepoStatus {
  supported: boolean;
  repository: boolean;
  rootPath?: string;
  branch?: string | null;
  detached: boolean;
  clean?: boolean;
  stagedCount?: number;
  modifiedCount?: number;
  untrackedCount?: number;
  ahead?: number;
  behind?: number;
  remotes: RuntimeRepoRemoteStatus[];
  defaultRemote?: string;
  headOid?: string;
}

export interface RuntimeDeliveryRequest {
  action: RuntimeDeliveryAction;
  workspacePath?: string;
  sessionId?: string;
  artifactIds?: string[];
  artifacts?: SessionArtifact[];
  services?: AgentRuntimeService[];
  apply?: boolean;
  strict?: boolean;
  authorization?: RuntimeDeliveryAuthorizationInput;
  publication?: RuntimeArtifactPublicationRequest;
  repo?: RuntimeRepoDeliveryRequest;
  preview?: RuntimePreviewCollectionRequest;
  context?: Record<string, unknown>;
}

export interface RuntimeDeliverySummary {
  artifactCount: number;
  publishedArtifactCount: number;
  previewSurfaceCount: number;
  readyPreviewSurfaceCount: number;
  blockedReasonCount: number;
  capabilityGapCount: number;
}

export interface RuntimeDeliveryResult {
  action: RuntimeDeliveryAction;
  state: RuntimeDeliveryState;
  contract: RuntimeDeliveryContract;
  authorization: RuntimeDeliveryAuthorization;
  approval: RuntimeDeliveryApprovalPayload;
  sessionId?: string;
  workspacePath?: string;
  capabilities: RuntimeDeliveryCapabilities;
  warnings: RuntimeDeliveryWarning[];
  blockedReasons: RuntimeDeliveryIssue[];
  capabilityGaps: RuntimeDeliveryIssue[];
  repo: RuntimeRepoStatus;
  artifacts: RuntimeArtifactPublicationRecord[];
  previewSurfaces: RuntimePreviewSurface[];
  summary: RuntimeDeliverySummary;
  metadata?: Record<string, unknown>;
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

export interface SessionBranchTarget {
  provider: string;
  backend: ProviderBackend;
  instance: string;
}

export interface SessionBranchNativeForkCapabilityTruth {
  supported: boolean;
  compatible: boolean;
  available: boolean;
  errorKind?: SessionBranchErrorKind;
  reason?: string;
}

export interface SessionBranchContextTransplantCapabilityTruth {
  supported: boolean;
}

export interface SessionBranchCapabilityTruth {
  nativeFork: SessionBranchNativeForkCapabilityTruth;
  contextTransplant: SessionBranchContextTransplantCapabilityTruth;
}

export type SessionContextTransplantSource = 'none' | 'default' | 'request' | 'merged';

export interface SessionContextTransplantSummary {
  provided: boolean;
  source: SessionContextTransplantSource;
  summaryPresent: boolean;
  checkpointPresent: boolean;
  transcriptExcerptCount: number;
  structuredBlockCount: number;
  artifactCount: number;
  labels: string[];
}

export interface SessionBranchOperationResult {
  requestedMode: SessionBranchPreference;
  resolvedMode?: SessionBranchMode;
  fallbackApplied: boolean;
  fallbackReason?: string;
  target: SessionBranchTarget;
  capabilityTruth: SessionBranchCapabilityTruth;
  transplant?: SessionContextTransplantSummary;
}

export interface SessionBranchDecision extends SessionBranchOperationResult {
  warnings: string[];
  error?: {
    status: 400 | 409 | 500 | 501;
    kind: SessionBranchErrorKind;
    message: string;
  };
}

export interface SessionBranchObservability {
  capabilities?: SessionBranchCapabilityTruth;
  lineage?: SessionBranchLineage;
  transplant?: SessionContextTransplant;
}

export type SessionBranchErrorKind =
  | 'provider_not_implemented'
  | 'provider_unsupported'
  | 'missing_provider_session'
  | 'target_incompatible'
  | 'capability_unavailable';

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
