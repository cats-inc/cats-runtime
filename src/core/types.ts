import type {
  ProviderModelResolution,
  ProviderModelSelection,
} from './models/providerSelectionResolution.js';

export type {
  ProviderModelResolution,
  ProviderModelSelection,
} from './models/providerSelectionResolution.js';

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
export type RuntimeExecutionStrategyId = 'simple_tool_call' | 'react' | 'pdca' | (string & {});
export type RuntimeExecutionStrategyResolutionSource =
  | 'explicit_request'
  | 'runtime_preference'
  | 'compatibility_fallback';
export type RuntimeExecutionStrategyStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface RuntimeExecutionStrategyRequest {
  requestedStrategy?: RuntimeExecutionStrategyId;
  acceptanceCriteria?: string;
  strategyContext?: Record<string, unknown>;
  correlation?: Record<string, unknown>;
}

export interface RuntimeExecutionStrategySummary {
  status: RuntimeExecutionStrategyStatus;
  stepCount: number;
  resolutionSource: RuntimeExecutionStrategyResolutionSource;
  stepLimit?: number;
  timeoutMs?: number;
  duplicateStepCount?: number;
  stuckDetected?: boolean;
  failureReason?: string;
  lastStepSignature?: string;
  lastEvent?: string;
  updatedAt: string;
}

export interface RuntimeExecutionStrategyState {
  preferredStrategy?: RuntimeExecutionStrategyId;
  request?: RuntimeExecutionStrategyRequest;
  effectiveStrategy?: RuntimeExecutionStrategyId;
  resolutionSource?: RuntimeExecutionStrategyResolutionSource;
  summary?: RuntimeExecutionStrategySummary;
  localState?: Record<string, unknown>;
  updatedAt: string;
}

export type WorkspaceKind = 'source' | 'sandbox' | 'worktree';
export type WorkspaceAccess = 'read_write' | 'read_only';
export type WorkspaceMode = 'isolated' | 'shared' | 'read_only';
export type WorkspaceIsolationMode = 'shared' | 'isolated' | 'worktree';
export type WorktreeCleanupPolicy = 'discard' | 'merge' | 'preserve';
export type WorktreeCleanupStatus = 'completed' | 'retained';
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
export type RuntimeDeliveryExecutionMode = 'preview' | 'apply';
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
export type RuntimePreviewSurfaceKind = 'service' | 'artifact' | 'browser_page';
export type RuntimePreviewSurfaceSource =
  | 'session_service'
  | 'session_artifact'
  | 'request_service'
  | 'request_artifact'
  | 'published_artifact'
  | 'browser_page';
export type RuntimePreviewSurfaceRenderHint =
  | 'iframe'
  | 'open_external'
  | 'download'
  | 'none';
export type RuntimeBrowserDriverKind = 'manual' | 'service_preview_only' | 'noop' | (string & {});
export type RuntimeBrowserDriverStatus = 'ready' | 'degraded' | 'unsupported';
export type RuntimeBrowserSessionStatus = 'ready' | 'closed';
export type RuntimeBrowserPageStatus = 'open' | 'closed';
export type RuntimeBrowserPageBindingKind =
  | 'manual_url'
  | 'session_service'
  | 'session_artifact';
export type RuntimeUsageSourceConfidence =
  | 'reported'
  | 'aggregated'
  | 'estimated'
  | 'unknown';
export type RuntimeIncidentClassification =
  | 'rate_limited'
  | 'quota_exhausted'
  | 'cooldown_active'
  | 'concurrency_limited';
export type RuntimeIncidentScope =
  | 'session'
  | 'provider_instance'
  | 'workspace'
  | 'runtime_global';
export type RuntimeGuardrailScope = RuntimeIncidentScope;
export type RuntimeGuardrailMetric =
  | 'total_tokens'
  | 'estimated_cost'
  | 'rate_limit_incidents'
  | 'active_concurrency';
export type RuntimeGuardrailAction = 'warn' | 'block' | 'cooldown';
export type RuntimeGuardrailOutcome = 'allowed' | 'warned' | 'blocked' | 'cooldown';
export type RuntimeProgressKind =
  | 'status'
  | 'plan'
  | 'reasoning'
  | 'strategy'
  | 'tool'
  | 'command'
  | 'files'
  | 'provider_cache'
  | 'model_state'
  | 'guardrail'
  | 'session';
export type RuntimeProgressStatus =
  | 'started'
  | 'running'
  | 'updated'
  | 'created'
  | 'reused'
  | 'fallback'
  | 'hinted'
  | 'completed'
  | 'failed'
  | 'warned'
  | 'blocked'
  | 'cooldown';
export type SessionBranchMode = 'native_fork' | 'context_transplant';
export type SessionBranchPreference = 'auto' | SessionBranchMode;
export type RuntimeSkillDeliveryMode = 'filesystem' | 'instructions' | 'none';
export type RuntimeSkillResolutionStatus = 'resolved';
export type RuntimeSkillDeliveryStatus = 'applied' | 'degraded' | 'unsupported';

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
  mode: RuntimeDeliveryExecutionMode;
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
  browserSessionId?: string;
  browserPageId?: string;
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

export interface RuntimeBrowserDriverCapabilities {
  persistentSessions: boolean;
  manualUrlEntry: boolean;
  serviceBindings: boolean;
  artifactBindings: boolean;
  liveAutomation: boolean;
}

export interface RuntimeBrowserDriverDescriptor {
  id: string;
  kind: RuntimeBrowserDriverKind;
  status: RuntimeBrowserDriverStatus;
  title: string;
  summary: string;
  capabilities: RuntimeBrowserDriverCapabilities;
  warnings: string[];
  metadata?: Record<string, unknown>;
}

export interface RuntimeBrowserPageBinding {
  kind: RuntimeBrowserPageBindingKind;
  runtimeSessionId?: string;
  serviceId?: string;
  artifactId?: string;
}

export interface RuntimeBrowserPage {
  id: string;
  browserSessionId: string;
  status: RuntimeBrowserPageStatus;
  label?: string;
  title?: string;
  url?: string;
  path?: string;
  mediaType?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  binding: RuntimeBrowserPageBinding;
  previewSurface: RuntimePreviewSurface;
  metadata?: Record<string, unknown>;
}

export interface RuntimeBrowserSessionInspection {
  driver: RuntimeBrowserDriverDescriptor;
  openPageCount: number;
  closedPageCount: number;
  previewSurfaces: RuntimePreviewSurface[];
}

export interface RuntimeBrowserSessionView {
  id: string;
  driverId: string;
  status: RuntimeBrowserSessionStatus;
  runtimeSessionId?: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  pages: RuntimeBrowserPage[];
  inspection: RuntimeBrowserSessionInspection;
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
  workspaceKind?: WorkspaceKind;
  workspaceAccess?: WorkspaceAccess;
  workspaceMode?: WorkspaceMode;
  workspaceIsolation?: WorkspaceIsolationMode;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  group?: string;
  instructions?: string;
  skills?: RuntimeSkillManifest;
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

export type RuntimeWakeupStatus =
  | 'scheduled'
  | 'triggering'
  | 'triggered'
  | 'cancelled'
  | 'failed';
export type RuntimeWakeupTriggerSource = 'timer' | 'manual';
export type RuntimeWakeupTriggerOutcome = 'resumed' | 'already_awake';

export interface RuntimeWakeupRecurrence {
  kind: 'cron';
  expression: string;
  timezone?: 'UTC';
}

export interface RuntimeWakeupTarget {
  kind: 'session';
  sessionId: string;
}

export interface RuntimeWakeupExecution {
  source: RuntimeWakeupTriggerSource;
  triggeredAt: string;
  sessionId: string;
  providerSessionId?: string;
  outcome?: RuntimeWakeupTriggerOutcome;
  error?: string;
}

export interface RuntimeWakeupRequest {
  id: string;
  reason: string;
  target: RuntimeWakeupTarget;
  scheduleAt: string;
  recurrence?: RuntimeWakeupRecurrence;
  coalesceKey?: string;
  status: RuntimeWakeupStatus;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  coalescedCount: number;
  lastExecution?: RuntimeWakeupExecution;
}

export interface SessionWakeupState {
  pending: boolean;
  pendingRequestCount: number;
  nextScheduledAt?: string;
  lastRequest?: RuntimeWakeupRequest;
}

export type SessionHydrationTrigger = 'create' | 'resume' | 'fork' | 'message';
export type SessionHydrationSkillSource = 'request' | 'session_state';
export type SessionHydrationWorkspaceSource = 'runtime_cwd' | 'source_workspace';

export interface SessionWorktreeCleanupState {
  policy: WorktreeCleanupPolicy;
  status: WorktreeCleanupStatus;
  observedAt: string;
  reasonCodes: string[];
  mergedPathCount: number;
}

export interface SessionWorktreeState {
  id: string;
  sourceRepoRoot: string;
  sourceHeadOid?: string;
  sourceHeadRef?: string | null;
  relativeCwd?: string;
  worktreePath: string;
  preparedAt: string;
  lastCleanup?: SessionWorktreeCleanupState;
}

export interface SessionWorkspaceState {
  kind: WorkspaceKind;
  access: WorkspaceAccess;
  runtimeCwd: string;
  sourceCwd?: string;
  worktree?: SessionWorktreeState;
}

export interface SessionWorkspaceIsolationState {
  mode: WorkspaceIsolationMode;
  sourceCwd?: string;
  worktree?: SessionWorktreeState;
}

export interface SessionWorkspaceHydrationSubstrateState {
  auditPath: string;
  profile: WorkspaceSubstrateProfileId;
  status: WorkspaceSubstrateAuditStatus;
  checkedAt: string;
  changedPaths: string[];
  reviewCopyPaths: string[];
  findingCounts: Record<WorkspaceSubstrateFindingStatus, number>;
}

export interface SessionWorkspaceHydrationState {
  kind: WorkspaceKind;
  access: WorkspaceAccess;
  isolationMode?: WorkspaceIsolationMode;
  runtimeCwd: string;
  sourceCwd?: string;
  sourceOfTruth: SessionHydrationWorkspaceSource;
  substrate: SessionWorkspaceHydrationSubstrateState;
  warnings: string[];
}

export interface SessionSkillHydrationState {
  source: SessionHydrationSkillSource;
  requestedSkills: string[];
  requestedSkillRefs?: RequestedSessionSkillRef[];
  resolvedSkills: ResolvedRuntimeSkill[];
  appliedSkillIds: string[];
  provider: string;
  backend: ProviderBackend;
  preferredMode: RuntimeSkillDeliveryMode;
  mode: RuntimeSkillDeliveryMode;
  status: RuntimeSkillDeliveryStatus;
  warnings: string[];
}

export interface SessionHydrationState {
  trigger: SessionHydrationTrigger;
  updatedAt: string;
  workspace: SessionWorkspaceHydrationState;
  skills?: SessionSkillHydrationState;
  metadata?: Record<string, unknown>;
}

export interface RuntimeSkillManifestContext {
  catId?: string;
  roomMode?: 'boss_chat' | 'direct_cat_chat' | 'transport_inbox';
  transport?: 'telegram' | 'line' | 'web' | null;
  labels?: string[];
  metadata?: Record<string, unknown>;
}

export interface RuntimeRequestedSkillRef {
  id?: string;
  family?: string;
  slug?: string;
  version?: string;
  fingerprint?: string;
}

export interface RequestedSessionSkillRef {
  id: string;
  slug: string;
  family?: string;
  version?: string;
  fingerprint?: string;
  requestedAs: string;
}

export interface RuntimeSkillManifest {
  profileId?: string;
  requestedSkills: Array<string | RuntimeRequestedSkillRef>;
  context?: RuntimeSkillManifestContext;
  strict?: boolean;
}

export type RuntimeSkillFamily = 'base' | 'orchestration' | 'work' | 'chat' | 'code';

export type RuntimeSkillPackageKind = 'base' | 'role' | 'bundle';

export interface RuntimeSkillLibraryMetadata {
  family: RuntimeSkillFamily;
  slug: string;
  role: string;
  packageKind: RuntimeSkillPackageKind;
  version: string;
  capabilityTags: string[];
  productTags: string[];
  deliveryHints: RuntimeSkillDeliveryMode[];
  recommendedCompanions: string[];
}

export interface ResolvedRuntimeSkill {
  id: string;
  slug: string;
  family?: string;
  version?: string;
  title: string;
  description: string;
  status: RuntimeSkillResolutionStatus;
  source: 'runtime_catalog';
  sourcePath: string;
  entryFile: string;
  fingerprint: string;
  library: RuntimeSkillLibraryMetadata;
}

export type RuntimeSkillCatalogEntry = ResolvedRuntimeSkill;

export interface RuntimeSkillFilesystemMaterialization {
  rootPath: string;
  entryPaths: string[];
}

export interface RuntimeSkillInstructionMaterialization {
  filePath?: string;
  byteLength: number;
}

export interface RuntimeSkillDeliveryState {
  provider: string;
  backend: ProviderBackend;
  preferredMode: RuntimeSkillDeliveryMode;
  mode: RuntimeSkillDeliveryMode;
  status: RuntimeSkillDeliveryStatus;
  warnings: string[];
  filesystem?: RuntimeSkillFilesystemMaterialization;
  instructions?: RuntimeSkillInstructionMaterialization;
}

export interface SessionSkillState {
  profileId?: string;
  requestedSkills: string[];
  requestedSkillRefs?: RequestedSessionSkillRef[];
  context?: RuntimeSkillManifestContext;
  resolvedSkills: ResolvedRuntimeSkill[];
  strict: boolean;
  delivery: RuntimeSkillDeliveryState;
  warnings: string[];
  appliedSkillIds: string[];
  updatedAt: string;
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

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  estimatedCost?: number;
  currency?: string;
  latencyMs?: number;
  sourceConfidence?: RuntimeUsageSourceConfidence;
}

export interface RuntimeUsageSignal {
  totalTokens?: number;
  estimatedCost?: number;
  currency?: string;
  latencyMs?: number;
  sourceConfidence?: RuntimeUsageSourceConfidence;
  quota?: Record<string, string | number | boolean>;
}

export interface RuntimeUsageRecord extends RuntimeUsageSignal {
  id: string;
  provider: string;
  instance: string;
  backend: ProviderBackend;
  sessionId?: string;
  providerSessionId?: string;
  workspaceKey?: string;
  callerTags?: Record<string, string>;
  observedAt: string;
  inputTokens?: number;
  outputTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeRateLimitIncident {
  id: string;
  provider: string;
  instance: string;
  backend: ProviderBackend;
  sessionId?: string;
  providerSessionId?: string;
  workspaceKey?: string;
  classification: RuntimeIncidentClassification;
  scope: RuntimeIncidentScope;
  observedAt: string;
  retryAfterMs?: number;
  retryAt?: string;
  evidenceSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeUsageGuardrail {
  scope: RuntimeGuardrailScope;
  metric: RuntimeGuardrailMetric;
  threshold: number;
  action: RuntimeGuardrailAction;
  cooldownMs?: number;
}

export interface RuntimeGuardrailResult {
  outcome: RuntimeGuardrailOutcome;
  scope: RuntimeGuardrailScope;
  metric: RuntimeGuardrailMetric;
  action: RuntimeGuardrailAction;
  provider?: string;
  instance?: string;
  backend?: ProviderBackend;
  sessionId?: string;
  workspaceKey?: string;
  threshold?: number;
  currentValue?: number;
  observedAt: string;
  reason: string;
  cooldownUntil?: string;
  incidentId?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeUsageAggregate extends RuntimeUsageSignal {
  provider: string;
  instance: string;
  backend: ProviderBackend;
  sessionId?: string;
  workspaceKey?: string;
  observationCount: number;
  inputTokens: number;
  outputTokens: number;
  confidenceCounts: Record<RuntimeUsageSourceConfidence, number>;
  lastObservedAt?: string;
}

export interface RuntimeUsageTotals extends RuntimeUsageSignal {
  observationCount: number;
  inputTokens: number;
  outputTokens: number;
  confidenceCounts: Record<RuntimeUsageSourceConfidence, number>;
  lastObservedAt?: string;
}

export interface RuntimeMeteringSummary {
  status: 'ok' | 'degraded';
  summary: string;
  usageRecords: number;
  incidents: number;
  activeGuardrails: number;
  activeCooldowns: number;
  activeBlocks: number;
}

export interface RuntimeMeteringSnapshot {
  summary: RuntimeMeteringSummary;
  usage: {
    totals: RuntimeUsageTotals;
    byProviderInstance: RuntimeUsageAggregate[];
    bySession: RuntimeUsageAggregate[];
  };
  incidents: {
    recent: RuntimeRateLimitIncident[];
    active: RuntimeGuardrailResult[];
  };
  guardrails: {
    configured: RuntimeUsageGuardrail[];
    active: RuntimeGuardrailResult[];
  };
}

export type RuntimeSessionExecutionState =
  | 'idle'
  | 'running'
  | 'canceling'
  | 'closing'
  | 'closed';

export type RuntimeRunStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'blocked'
  | 'cooldown';

export type RuntimeSessionMaintenanceStatus =
  | 'clean'
  | 'attention'
  | 'cleanup_ready';

export type RuntimeSessionCompactionStatus =
  | 'not_ready'
  | 'ready'
  | 'recommended';

export type RuntimeSessionCleanupStatus =
  | 'clean'
  | 'recommended'
  | 'ready';

export type RuntimeSessionLifecycleAction = 'close' | 'reset' | 'delete';
export type RuntimeSessionLifecycleBoundary = 'soft_close' | 'hard_reset' | 'permanent_delete';
export type RuntimeSessionLifecycleStatus = 'completed' | 'retained';
// Reserved for a future hook-only pre-compaction handshake if runtime later
// distinguishes "prepare" from the external compaction trigger itself.
export type RuntimeSessionMaintenanceAction =
  | RuntimeSessionLifecycleAction
  | 'cleanup_workspace'
  | 'prepare_compaction'
  | 'compact';

export interface RuntimeWakeReason {
  source?: SessionInvocationContext['source'];
  reason?: string;
  taskId?: string;
  issueId?: string;
  commentId?: string;
  approvalId?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
}

export interface RuntimeProgressSnapshot {
  updatedAt: string;
  eventType: StreamEvent['type'];
  text?: string;
  summary?: string;
  toolName?: string;
  toolId?: string;
  isError?: boolean;
  kind?: RuntimeProgressKind;
  status?: RuntimeProgressStatus;
  metadata?: Record<string, unknown>;
}

export interface RuntimeEventExcerpt {
  observedAt: string;
  eventType: StreamEvent['type'];
  text?: string;
  summary?: string;
  toolName?: string;
  toolId?: string;
  isError?: boolean;
  kind?: RuntimeProgressKind;
  status?: RuntimeProgressStatus;
}

export interface RuntimeSessionMaintenanceMarker {
  code: string;
  observedAt: string;
  status: 'observed' | 'completed';
  details?: Record<string, unknown>;
}

export interface RuntimeSessionLifecycleCleanupSummary {
  workerDetached?: boolean;
  providerResumeCleared?: boolean;
  providerStateCleared?: boolean;
  wakeupsCleared?: boolean;
  browserSessionsCleared?: number;
  workspaceCleaned?: boolean;
  worktreeDetached?: boolean;
  worktreeCleanupPolicy?: WorktreeCleanupPolicy;
  worktreeMergedPaths?: number;
  managedTranscriptDeleted?: boolean;
  providerDiscoveryCleared?: boolean;
  registryDropped?: boolean;
  runStateCleared?: boolean;
}

export interface RuntimeSessionLifecycleContract {
  action: RuntimeSessionLifecycleAction;
  boundary: RuntimeSessionLifecycleBoundary;
  status: RuntimeSessionLifecycleStatus;
  observedAt: string;
  reasonCodes: string[];
  cleanup: RuntimeSessionLifecycleCleanupSummary;
}

export interface RuntimeSessionMaintenanceHookPayload {
  kind: string;
  payload?: unknown;
  payloadStatus?: 'stored' | 'redacted' | 'truncated' | 'redacted_and_truncated' | 'omitted';
  payloadWarnings?: string[];
  payloadBytes?: number;
}

export interface RuntimeSessionMaintenanceRequest {
  action: RuntimeSessionMaintenanceAction;
  sessionId: string;
  requestedAt: string;
  workspaceKind: WorkspaceKind;
  workspaceAccess: WorkspaceAccess;
  workspaceMode?: WorkspaceMode;
  isolationMode?: WorkspaceIsolationMode;
  runtimeCwd: string;
  sourceCwd?: string;
  worktreePath?: string;
  reason?: string;
  reasonTruncated?: boolean;
  worktreeDisposition?: WorktreeCleanupPolicy;
  hookPayloads: RuntimeSessionMaintenanceHookPayload[];
}

export type RuntimeSessionMaintenanceFollowThroughOutcome =
  | 'acknowledged'
  | 'retry_requested'
  | 'completed';

export interface RuntimeSessionMaintenanceFollowThrough {
  action: RuntimeSessionMaintenanceAction;
  phase: RuntimeSessionHookContract['phase'];
  sessionId: string;
  observedAt: string;
  outcome: RuntimeSessionMaintenanceFollowThroughOutcome;
  reason?: string;
  reasonTruncated?: boolean;
  hookPayloads: RuntimeSessionMaintenanceHookPayload[];
}

export type RuntimeSessionHookId = 'memory_flush' | (string & {});
export type RuntimeSessionHookOwner = 'product_memory' | (string & {});

export interface RuntimeSessionHookContract {
  id: RuntimeSessionHookId;
  phase: 'pre_reset' | 'pre_compaction' | 'pre_flush';
  status: 'pending';
  owner: RuntimeSessionHookOwner;
  reason: string;
}

export interface RuntimeSessionHookGroup {
  available: boolean;
  pending: RuntimeSessionHookContract[];
}

export interface RuntimeSessionMaintenanceState {
  lastRequest?: RuntimeSessionMaintenanceRequest;
  lastFollowThrough?: RuntimeSessionMaintenanceFollowThrough;
  lastResetAt?: string;
  lastLifecycle?: RuntimeSessionLifecycleContract;
  lastCompaction?: RuntimeSessionCompactionRecord;
  markers: RuntimeSessionMaintenanceMarker[];
}

export interface RuntimeSessionCompactionRecord {
  compactedAt: string;
  transcriptPath: string;
  baselineMessageCount: number;
  baselineTotalTokens: number;
  compactedEntryCount: number;
  retainedEntryCount: number;
  repairedLineCount: number;
  aggressivePassCount: number;
  archivePath?: string;
}

export interface RuntimeSessionCompactionContract {
  status: RuntimeSessionCompactionStatus;
  reasonCodes: string[];
  messageCount: number;
  totalTokens: number;
  lastCompaction?: RuntimeSessionCompactionRecord;
}

export interface RuntimeSessionResetBoundary {
  status: 'none' | 'cleared';
  lastResetAt?: string;
  reasonCodes: string[];
}

export interface RuntimeSessionCleanupContract {
  status: RuntimeSessionCleanupStatus;
  reasonCodes: string[];
  retryCleanupPath?: string;
}

export interface RuntimeSessionFlushContract {
  status: 'idle' | 'pending' | 'acknowledged' | 'retry_requested' | 'completed';
  phase: 'pre_flush';
  hookCount: number;
  reasonCodes: string[];
  action?: Extract<RuntimeSessionMaintenanceAction, 'delete' | 'cleanup_workspace'>;
  lastRequestedAt?: string;
  lastFollowThrough?: RuntimeSessionMaintenanceFollowThrough;
}

export interface RuntimeSessionMaintenance {
  status: RuntimeSessionMaintenanceStatus;
  compaction: RuntimeSessionCompactionContract;
  hooks: {
    preReset: RuntimeSessionHookGroup;
    preCompaction: RuntimeSessionHookGroup;
    preFlush: RuntimeSessionHookGroup;
  };
  resetBoundary: RuntimeSessionResetBoundary;
  cleanup: RuntimeSessionCleanupContract;
  flush: RuntimeSessionFlushContract;
  markers: RuntimeSessionMaintenanceMarker[];
  lastRequest?: RuntimeSessionMaintenanceRequest;
  lastFollowThrough?: RuntimeSessionMaintenanceFollowThrough;
  lastLifecycle?: RuntimeSessionLifecycleContract;
}

export interface RuntimeRunInspection {
  id: string;
  status: RuntimeRunStatus;
  startedAt: string;
  endedAt?: string;
  providerSessionId?: string;
  wake?: RuntimeWakeReason | null;
  inputPreview?: string;
  resultSummary?: string;
  error?: string;
  progress?: RuntimeProgressSnapshot;
  usage?: RuntimeUsageSignal;
  guardrail?: RuntimeGuardrailResult;
  incident?: RuntimeRateLimitIncident;
  artifacts?: SessionArtifact[];
  services?: AgentRuntimeService[];
  previewSurfaces?: RuntimePreviewSurface[];
}

export interface RuntimeSessionMeteringSnapshot {
  usage?: RuntimeUsageAggregate;
  preflight: RuntimeGuardrailResult;
  activeGuardrails: RuntimeGuardrailResult[];
  recentIncidents: RuntimeRateLimitIncident[];
}

export interface RuntimeSessionInspectionActions {
  canClose: boolean;
  canDelete: boolean;
  canResume: boolean;
  canRefresh: boolean;
  canCancel: boolean;
  canReset: boolean;
  canRetry: boolean;
}

export interface RuntimeExecutionStrategyInspection {
  requestedStrategy?: RuntimeExecutionStrategyId;
  effectiveStrategy?: RuntimeExecutionStrategyId;
  acceptanceCriteria?: string;
  strategyContext?: Record<string, unknown>;
  correlation?: Record<string, unknown>;
  state?: RuntimeExecutionStrategyState;
}

export interface RuntimeSessionInspection {
  state: RuntimeSessionExecutionState;
  attached: boolean;
  busy: boolean;
  wake: RuntimeWakeReason | null;
  currentRun?: RuntimeRunInspection;
  lastRun?: RuntimeRunInspection;
  progress?: RuntimeProgressSnapshot;
  recentEvents: RuntimeEventExcerpt[];
  metering: RuntimeSessionMeteringSnapshot;
  maintenance: RuntimeSessionMaintenance;
  strategy?: RuntimeExecutionStrategyInspection;
  skills?: SessionSkillState;
  artifacts: SessionArtifact[];
  services: AgentRuntimeService[];
  previewSurfaces: RuntimePreviewSurface[];
  browserSessions?: RuntimeBrowserSessionView[];
  actions: RuntimeSessionInspectionActions;
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
  strategy?: RuntimeExecutionStrategyState;
  status: SessionStatus;
  origin: SessionOrigin;
  cwd: string;
  workspace: SessionWorkspaceState;
  workspaceMode?: WorkspaceMode;
  workspaceIsolation?: SessionWorkspaceIsolationState;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  model?: string;
  modelSelection?: ProviderModelSelection;
  modelResolution?: ProviderModelResolution;
  group?: string;
  instructions?: string;
  skills?: SessionSkillState;
  hydration?: SessionHydrationState;
  maintenanceState?: RuntimeSessionMaintenanceState;
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
  workspaceKind?: WorkspaceKind;
  workspaceAccess?: WorkspaceAccess;
  workspaceMode?: WorkspaceMode;
  model?: string;
  resumeSessionId?: string;
  resumeSourcePath?: string;
  forkSession?: boolean;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  instructionsFile?: string;
}

export interface ProviderTurnOptions extends ProviderSpawnOptions {
  signal?: AbortSignal;
}

export interface ProviderMessage {
  role: 'user';
  content: string;
}

export interface TurnInput extends RuntimeExecutionStrategyRequest {
  message: string;
  sessionInstructions?: string;
  instructions?: string;
  skills?: SessionSkillState;
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
  usage?: StreamUsage;
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
