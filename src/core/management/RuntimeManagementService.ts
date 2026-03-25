import type { ManagementAdapter } from './adapters/types.js';
import type { GithubReviewAdapter } from './adapters/github/GithubReviewAdapter.js';
import type { ManagementConfig } from './config.js';
import { ManagementOperationStore } from './operations.js';
import {
  MUTATING_MANAGEMENT_ACTIONS,
  createManagementIssue,
  type RuntimeManagementAuthorization,
  type RuntimeManagementContract,
  type RuntimeManagementRequest,
  type RuntimeManagementResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface RuntimeManagementDependencies {
  config?: ManagementConfig;
  adapters?: Map<string, ManagementAdapter>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RuntimeManagementService {
  private readonly adapters: Map<string, ManagementAdapter>;
  private readonly config: ManagementConfig | undefined;
  readonly operations = new ManagementOperationStore();

  constructor(deps: RuntimeManagementDependencies) {
    this.config = deps.config;
    this.adapters = deps.adapters ?? new Map();
  }

  registerAdapter(adapter: ManagementAdapter): void {
    this.adapters.set(adapter.descriptor.id, adapter);
    // Share the service's operation store with adapters that support it
    const withStore = adapter as unknown as { setOperationStore?: (store: ManagementOperationStore) => void };
    if (typeof withStore.setOperationStore === 'function') {
      withStore.setOperationStore(this.operations);
    }
  }

  getRegisteredAdapters(): ManagementAdapter[] {
    return [...this.adapters.values()];
  }

  // -----------------------------------------------------------------------
  // Execute a management action
  // -----------------------------------------------------------------------

  async execute(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const adapter = this.resolveAdapter(request);
    if (!adapter) {
      return this.unsupportedResult(request);
    }

    const isMutating = MUTATING_MANAGEMENT_ACTIONS.has(request.action);
    const authorization = this.buildAuthorization(request, isMutating);
    const contract = this.buildContract(request, authorization, isMutating);

    if (isMutating && request.apply && !authorization.canApply) {
      return {
        domain: request.domain,
        action: request.action,
        state: 'blocked',
        adapter: adapter.descriptor.id,
        contract,
        authorization,
        warnings: [],
        blockedReasons: [
          createManagementIssue(
            'authorization_required',
            'blocked',
            authorization.reason,
          ),
        ],
        capabilityGaps: [],
      };
    }

    const result = await adapter.execute(request);

    return {
      ...result,
      adapter: adapter.descriptor.id,
      contract,
      authorization,
    };
  }

  // -----------------------------------------------------------------------
  // Resume a long-running operation (for wait_review_checks)
  // -----------------------------------------------------------------------

  async resumeOperation(
    operationId: string,
    timeoutMs?: number,
  ): Promise<RuntimeManagementResult | undefined> {
    const op = this.operations.get(operationId);
    if (!op) return undefined;

    // Already terminal — return final result
    if (op.status === 'completed' || op.status === 'failed') {
      return {
        domain: 'review',
        action: 'wait_review_checks',
        state: op.status === 'completed' ? 'completed' : 'blocked',
        contract: {
          mode: 'preview',
          safeDefaultMode: 'preview',
          applyRequested: false,
          applyDecision: 'read_only_operation',
          readOnly: true,
        },
        authorization: {
          canApply: false,
          requiresApproval: false,
          reason: 'Read-only operation.',
        },
        warnings: [],
        blockedReasons: [],
        capabilityGaps: [],
        outputs: op.result,
        operation: op,
      };
    }

    const activeOp = this.operations.touch(operationId) ?? op;

    // Still polling — try to re-enter the adapter's poll loop using
    // the request context stored by the adapter when the operation was created
    const ctx = activeOp.result?._requestContext as {
      domain?: string;
      action?: string;
      cwd?: string;
      prRef?: string;
      adapter?: string;
    } | undefined;

    if (ctx?.adapter) {
      const adapter = this.adapters.get(ctx.adapter);
      if (adapter && typeof (adapter as GithubReviewAdapter).pollChecks === 'function') {
        const pollTimeout = timeoutMs ?? activeOp.timeoutMs ?? 30_000;
        return (adapter as GithubReviewAdapter).pollChecks(
          { domain: (ctx.domain ?? 'review') as 'review', action: (ctx.action ?? 'wait_review_checks') as 'wait_review_checks' },
          operationId,
          ctx.cwd,
          ctx.prRef,
          pollTimeout,
        );
      }
    }

    // Fallback: no adapter context available, return current state
    return {
      domain: 'review',
      action: 'wait_review_checks',
      state: 'degraded',
      contract: {
        mode: 'preview',
        safeDefaultMode: 'preview',
        applyRequested: false,
        applyDecision: 'read_only_operation',
        readOnly: true,
      },
      authorization: {
        canApply: false,
        requiresApproval: false,
        reason: 'Read-only operation.',
      },
      warnings: [],
      blockedReasons: [],
      capabilityGaps: [],
      operation: activeOp,
    };
  }

  // -----------------------------------------------------------------------
  // Adapter resolution
  // -----------------------------------------------------------------------

  private resolveAdapter(request: RuntimeManagementRequest): ManagementAdapter | undefined {
    if (request.adapter) {
      return this.adapters.get(request.adapter);
    }

    const domainConfig = this.config?.adapters[request.domain];
    if (domainConfig?.default) {
      const adapter = this.adapters.get(domainConfig.default);
      if (adapter) return adapter;
    }

    for (const adapter of this.adapters.values()) {
      for (const cap of adapter.descriptor.capabilities) {
        if (cap.domain === request.domain && cap.actions.includes(request.action)) {
          return adapter;
        }
      }
    }

    return undefined;
  }

  // -----------------------------------------------------------------------
  // Authorization
  // -----------------------------------------------------------------------

  private buildAuthorization(
    request: RuntimeManagementRequest,
    isMutating: boolean,
  ): RuntimeManagementAuthorization {
    const hasActorClass = Boolean(request.authorization?.actorClass);
    const hasApprovalRef = Boolean(request.authorization?.approvalRef);
    const hasAuth = hasActorClass || hasApprovalRef;

    if (!isMutating) {
      return {
        actorClass: request.authorization?.actorClass,
        approvalRef: request.authorization?.approvalRef,
        canApply: false,
        requiresApproval: false,
        reason: 'Read-only operation.',
      };
    }

    if (!hasAuth) {
      return {
        canApply: false,
        requiresApproval: true,
        reason: 'Mutating action requires actorClass or approvalRef.',
      };
    }

    return {
      actorClass: request.authorization?.actorClass,
      approvalRef: request.authorization?.approvalRef,
      canApply: true,
      requiresApproval: false,
      reason: 'Authorization metadata present.',
    };
  }

  // -----------------------------------------------------------------------
  // Contract
  // -----------------------------------------------------------------------

  private buildContract(
    request: RuntimeManagementRequest,
    authorization: RuntimeManagementAuthorization,
    isMutating: boolean,
  ): RuntimeManagementContract {
    if (!isMutating) {
      return {
        mode: 'preview',
        safeDefaultMode: 'preview',
        applyRequested: false,
        applyDecision: 'read_only_operation',
        readOnly: true,
      };
    }

    const applyRequested = request.apply === true;
    let applyDecision: RuntimeManagementContract['applyDecision'] = 'not_requested';
    let mode: RuntimeManagementContract['mode'] = 'preview';

    if (applyRequested) {
      if (authorization.canApply) {
        applyDecision = 'applied';
        mode = 'apply';
      } else {
        applyDecision = 'blocked';
      }
    }

    return {
      mode,
      safeDefaultMode: 'preview',
      applyRequested,
      applyDecision,
      readOnly: false,
    };
  }

  // -----------------------------------------------------------------------
  // Unsupported result
  // -----------------------------------------------------------------------

  private unsupportedResult(request: RuntimeManagementRequest): RuntimeManagementResult {
    return {
      domain: request.domain,
      action: request.action,
      state: 'unsupported',
      contract: {
        mode: 'preview',
        safeDefaultMode: 'preview',
        applyRequested: false,
        applyDecision: 'not_requested',
        readOnly: true,
      },
      authorization: {
        canApply: false,
        requiresApproval: false,
        reason: 'No adapter available for this domain.',
      },
      warnings: [],
      blockedReasons: [],
      capabilityGaps: [
        createManagementIssue(
          'no_adapter',
          'unsupported',
          `No management adapter registered for domain '${request.domain}'.`,
        ),
      ],
    };
  }
}
