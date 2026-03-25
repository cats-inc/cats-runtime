import type {
  RuntimeDeliveryCapabilityState,
  RuntimePreviewSurface,
} from '../types.js';

// ---------------------------------------------------------------------------
// Domain and action vocabulary
// ---------------------------------------------------------------------------

export type RuntimeManagementDomain = 'review' | 'deployment';

export type RuntimeReviewAction =
  | 'audit_review_target'
  | 'open_pull_request'
  | 'inspect_pull_request'
  | 'wait_review_checks';

export type RuntimeDeploymentAction =
  | 'audit_deployment_target'
  | 'create_deployment'
  | 'inspect_deployment'
  | 'read_deployment_logs';

export type RuntimeManagementAction =
  | RuntimeReviewAction
  | RuntimeDeploymentAction;

// ---------------------------------------------------------------------------
// State vocabulary (aligned with delivery patterns)
// ---------------------------------------------------------------------------

export type RuntimeManagementState =
  | 'ready'
  | 'blocked'
  | 'unsupported'
  | 'degraded'
  | 'completed';

export type RuntimeManagementCapabilityState = RuntimeDeliveryCapabilityState;

export type RuntimeManagementExecutionMode = 'preview' | 'apply';

export type RuntimeManagementApplyDecision =
  | 'not_requested'
  | 'read_only_operation'
  | 'blocked'
  | 'applied';

// ---------------------------------------------------------------------------
// Actor classification (product-neutral per SPEC-019 req 12)
// ---------------------------------------------------------------------------

export type RuntimeManagementActorClass =
  | 'system'
  | 'owner'
  | 'operator'
  | 'service';

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export interface RuntimeManagementAuthorizationInput {
  actorClass?: RuntimeManagementActorClass;
  approvalRef?: string;
}

export interface RuntimeManagementAuthorization {
  actorClass?: RuntimeManagementActorClass;
  approvalRef?: string;
  canApply: boolean;
  requiresApproval: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export interface RuntimeManagementContract {
  mode: RuntimeManagementExecutionMode;
  safeDefaultMode: 'preview';
  applyRequested: boolean;
  applyDecision: RuntimeManagementApplyDecision;
  readOnly: boolean;
}

// ---------------------------------------------------------------------------
// Issues and warnings (mirrors delivery pattern)
// ---------------------------------------------------------------------------

export interface RuntimeManagementIssue {
  code: string;
  state: Exclude<RuntimeManagementCapabilityState, 'ready'>;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeManagementWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Long-running operation model
// ---------------------------------------------------------------------------

export type RuntimeManagementOperationStatus =
  | 'polling'
  | 'completed'
  | 'failed'
  | 'expired';

export interface RuntimeManagementOperation {
  operationId: string;
  status: RuntimeManagementOperationStatus;
  startedAt: string;
  updatedAt: string;
  timeoutMs?: number;
  result?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface RuntimeManagementRequest {
  domain: RuntimeManagementDomain;
  action: RuntimeManagementAction;
  adapter?: string;
  workspacePath?: string;
  sessionId?: string;
  apply?: boolean;
  authorization?: RuntimeManagementAuthorizationInput;
  target?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface RuntimeManagementResult {
  domain: RuntimeManagementDomain;
  action: RuntimeManagementAction;
  state: RuntimeManagementState;
  adapter?: string;
  contract: RuntimeManagementContract;
  authorization: RuntimeManagementAuthorization;
  warnings: RuntimeManagementWarning[];
  blockedReasons: RuntimeManagementIssue[];
  capabilityGaps: RuntimeManagementIssue[];
  outputs?: Record<string, unknown>;
  previewSurfaces?: RuntimePreviewSurface[];
  operation?: RuntimeManagementOperation;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const REVIEW_ACTIONS = new Set<RuntimeManagementAction>([
  'audit_review_target',
  'open_pull_request',
  'inspect_pull_request',
  'wait_review_checks',
]);

export const DEPLOYMENT_ACTIONS = new Set<RuntimeManagementAction>([
  'audit_deployment_target',
  'create_deployment',
  'inspect_deployment',
  'read_deployment_logs',
]);

export const MUTATING_MANAGEMENT_ACTIONS = new Set<RuntimeManagementAction>([
  'open_pull_request',
  'create_deployment',
]);

export function createManagementIssue(
  code: string,
  state: Exclude<RuntimeManagementCapabilityState, 'ready'>,
  message: string,
  details?: Record<string, unknown>,
): RuntimeManagementIssue {
  return { code, state, message, ...(details ? { details } : {}) };
}

export function createManagementWarning(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): RuntimeManagementWarning {
  return { code, message, ...(details ? { details } : {}) };
}
