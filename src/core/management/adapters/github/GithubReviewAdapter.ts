import { runCliCommand, isCliAvailable, parseCliJson } from '../../cli.js';
import {
  REVIEW_ACTIONS,
  createManagementIssue,
  createManagementWarning,
  type RuntimeManagementRequest,
  type RuntimeManagementResult,
  type RuntimeManagementState,
  type RuntimeManagementIssue,
  type RuntimeManagementWarning,
} from '../../types.js';
import type {
  ManagementAdapter,
  ManagementAdapterDescriptor,
  ManagementAdapterDiagnostics,
} from '../types.js';
import type { ManagementOperationStore } from '../../operations.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

const PR_URL_RE = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/;

export class GithubReviewAdapter implements ManagementAdapter {
  readonly descriptor: ManagementAdapterDescriptor = {
    id: 'github',
    label: 'GitHub CLI (gh)',
    transport: 'cli',
    capabilities: [{
      domain: 'review',
      actions: [...REVIEW_ACTIONS],
    }],
  };

  private readonly command: string;
  private readonly timeoutMs: number;
  private operations?: ManagementOperationStore;

  constructor(options?: {
    command?: string;
    timeoutMs?: number;
    operations?: ManagementOperationStore;
  }) {
    this.command = options?.command ?? 'gh';
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.operations = options?.operations;
  }

  /**
   * Called by RuntimeManagementService after registration so the adapter
   * shares the service's operation store instead of creating its own.
   */
  setOperationStore(store: ManagementOperationStore): void {
    this.operations = store;
  }

  async execute(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    switch (request.action) {
      case 'audit_review_target':
        return this.auditReviewTarget(request);
      case 'open_pull_request':
        return this.openPullRequest(request);
      case 'inspect_pull_request':
        return this.inspectPullRequest(request);
      case 'wait_review_checks':
        return this.waitReviewChecks(request);
      default:
        return this.makeResult(request, 'unsupported', {
          capabilityGaps: [createManagementIssue('unsupported_action', 'unsupported', `Action '${request.action}' is not supported by the GitHub adapter.`)],
        });
    }
  }

  async diagnose(workspacePath?: string): Promise<ManagementAdapterDiagnostics> {
    const checks: ManagementAdapterDiagnostics['checks'] = [];

    const { available, version } = await isCliAvailable(this.command, ['--version']);
    checks.push({
      code: 'command_found',
      status: available ? 'ok' : 'unavailable',
      message: available ? `${this.command} found (${version})` : `${this.command} not found in PATH`,
    });

    if (!available) {
      return { available: false, commandFound: false, authenticated: false, checks };
    }

    const authResult = await runCliCommand(this.command, ['auth', 'status'], {
      cwd: workspacePath,
      timeoutMs: this.timeoutMs,
    });
    const authenticated = authResult.code === 0;
    checks.push({
      code: 'authenticated',
      status: authenticated ? 'ok' : 'unavailable',
      message: authenticated ? 'GitHub CLI authenticated' : 'GitHub CLI not authenticated. Run `gh auth login`.',
    });

    return {
      available: authenticated,
      commandFound: true,
      authenticated,
      version,
      checks,
    };
  }

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  private async auditReviewTarget(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const cwd = request.workspacePath;
    const blockedReasons: RuntimeManagementIssue[] = [];
    const warnings: RuntimeManagementWarning[] = [];
    const outputs: Record<string, unknown> = {};

    const authResult = await runCliCommand(this.command, ['auth', 'status'], { cwd, timeoutMs: this.timeoutMs });
    if (authResult.code !== 0) {
      blockedReasons.push(createManagementIssue('auth_missing', 'blocked', 'GitHub CLI is not authenticated. Run `gh auth login`.'));
    }

    const repoResult = await runCliCommand(
      this.command,
      ['repo', 'view', '--json', 'name,owner,defaultBranchRef,url'],
      { cwd, timeoutMs: this.timeoutMs },
    );
    if (repoResult.code === 0) {
      const repo = parseCliJson(repoResult.stdout);
      if (repo) outputs.repository = repo;
    } else {
      blockedReasons.push(createManagementIssue('repo_missing', 'blocked', 'Not inside a GitHub repository or remote not configured.'));
    }

    const state: RuntimeManagementState = blockedReasons.length > 0 ? 'blocked' : 'ready';
    return this.makeResult(request, state, { blockedReasons, warnings, outputs });
  }

  private async openPullRequest(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const cwd = request.workspacePath;
    const target = (request.target ?? {}) as Record<string, unknown>;
    const title = typeof target.title === 'string' ? target.title : '';
    const body = typeof target.body === 'string' ? target.body : '';
    const base = typeof target.base === 'string' ? target.base : undefined;

    if (!title) {
      return this.makeResult(request, 'blocked', {
        blockedReasons: [createManagementIssue('missing_title', 'blocked', 'Pull request title is required in target.title.')],
      });
    }

    if (!request.apply) {
      return this.makeResult(request, 'ready', {
        outputs: { preview: true, title, body, base },
      });
    }

    // gh pr create does NOT support --json; it prints the URL to stdout
    const args = ['pr', 'create', '--title', title, '--body', body];
    if (base) args.push('--base', base);

    const result = await runCliCommand(this.command, args, { cwd, timeoutMs: this.timeoutMs });
    if (result.code !== 0) {
      return this.makeResult(request, 'blocked', {
        blockedReasons: [createManagementIssue('pr_create_failed', 'blocked', result.stderr.trim() || 'Failed to create pull request.')],
      });
    }

    // Parse the PR URL from stdout
    const urlMatch = result.stdout.match(PR_URL_RE);
    const url = urlMatch ? urlMatch[0] : result.stdout.trim();
    const numberMatch = url.match(/\/pull\/(\d+)/);
    const prNumber = numberMatch ? Number(numberMatch[1]) : undefined;

    return this.makeResult(request, 'completed', {
      outputs: { url, ...(prNumber !== undefined ? { number: prNumber } : {}), raw: result.stdout.trim() },
    });
  }

  private async inspectPullRequest(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const cwd = request.workspacePath;
    const target = (request.target ?? {}) as Record<string, unknown>;
    const prRef = typeof target.number === 'number'
      ? String(target.number)
      : typeof target.number === 'string' ? target.number : undefined;

    const args = ['pr', 'view', '--json', 'number,title,state,url,body,headRefName,baseRefName,reviewDecision,statusCheckRollup'];
    if (prRef) args.splice(2, 0, prRef);

    const result = await runCliCommand(this.command, args, { cwd, timeoutMs: this.timeoutMs });
    if (result.code !== 0) {
      return this.makeResult(request, 'blocked', {
        blockedReasons: [createManagementIssue('pr_not_found', 'blocked', result.stderr.trim() || 'Pull request not found.')],
      });
    }

    const prData = parseCliJson(result.stdout);
    return this.makeResult(request, 'completed', {
      outputs: prData ?? { raw: result.stdout.trim() },
    });
  }

  private async waitReviewChecks(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const cwd = request.workspacePath;
    const target = (request.target ?? {}) as Record<string, unknown>;
    const prRef = typeof target.number === 'number'
      ? String(target.number)
      : typeof target.number === 'string' ? target.number : undefined;
    const requestedTimeout = typeof target.timeoutMs === 'number'
      ? Math.min(target.timeoutMs, MAX_WAIT_TIMEOUT_MS)
      : DEFAULT_WAIT_TIMEOUT_MS;

    if (!this.operations) {
      return this.makeResult(request, 'blocked', {
        blockedReasons: [createManagementIssue('no_operation_store', 'blocked', 'Operation store not available; adapter not wired to service.')],
      });
    }

    // Store the original request context so resumeOperation can re-enter
    const op = this.operations.create(requestedTimeout);
    this.operations.update(op.operationId, 'polling', {
      _requestContext: { domain: request.domain, action: request.action, cwd, prRef, adapter: this.descriptor.id },
    });

    return this.pollChecks(request, op.operationId, cwd, prRef, requestedTimeout);
  }

  /**
   * Shared poll logic used by both initial waitReviewChecks and resumeOperation.
   */
  async pollChecks(
    request: Pick<RuntimeManagementRequest, 'domain' | 'action'>,
    operationId: string,
    cwd: string | undefined,
    prRef: string | undefined,
    timeoutMs: number,
  ): Promise<RuntimeManagementResult> {
    if (!this.operations) {
      return this.makeReadOnlyResult(request, 'blocked', {
        blockedReasons: [createManagementIssue('no_operation_store', 'blocked', 'Operation store not available.')],
      });
    }

    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      // Use `gh pr view --json statusCheckRollup` which is the supported way
      // to get check status as JSON (gh pr checks has no --json flag)
      const args = ['pr', 'view', '--json', 'statusCheckRollup'];
      if (prRef) args.splice(2, 0, prRef);

      const result = await runCliCommand(this.command, args, { cwd, timeoutMs: this.timeoutMs });
      if (result.code === 0) {
        const parsed = parseCliJson<{ statusCheckRollup?: Array<Record<string, unknown>> }>(result.stdout);
        const checks = parsed?.statusCheckRollup;
        if (checks && Array.isArray(checks)) {
          const allDone = checks.length > 0 && checks.every((c) => {
            const status = String(c.status || c.state || '').toUpperCase();
            return status === 'COMPLETED';
          });
          if (allDone) {
            const completed = this.operations.complete(operationId, { checks });
            return this.makeReadOnlyResult(request, 'completed', {
              outputs: { checks },
              operation: completed,
            });
          }
        }
      } else {
        const failed = this.operations.fail(operationId, { error: result.stderr.trim() });
        return this.makeReadOnlyResult(request, 'blocked', {
          blockedReasons: [createManagementIssue('checks_query_failed', 'blocked', result.stderr.trim() || 'Failed to query PR checks.')],
          operation: failed,
        });
      }

      await sleep(Math.min(DEFAULT_POLL_INTERVAL_MS, deadline - Date.now()));
    }

    // Timeout — return polling state with the operation ID for resumption
    const op = this.operations.get(operationId);
    return this.makeReadOnlyResult(request, 'degraded', {
      warnings: [createManagementWarning('poll_timeout', `Checks did not complete within ${timeoutMs}ms. Resume with operationId.`)],
      operation: op,
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private makeResult(
    request: RuntimeManagementRequest,
    state: RuntimeManagementState,
    fields?: Partial<RuntimeManagementResult>,
  ): RuntimeManagementResult {
    return {
      domain: request.domain,
      action: request.action,
      state,
      adapter: this.descriptor.id,
      contract: {
        mode: request.apply ? 'apply' : 'preview',
        safeDefaultMode: 'preview',
        applyRequested: request.apply === true,
        applyDecision: request.apply ? 'applied' : 'not_requested',
        readOnly: !request.apply,
      },
      authorization: {
        actorClass: request.authorization?.actorClass,
        approvalRef: request.authorization?.approvalRef,
        canApply: true,
        requiresApproval: false,
        reason: 'Adapter-level authorization deferred to service.',
      },
      warnings: [],
      blockedReasons: [],
      capabilityGaps: [],
      ...fields,
    };
  }

  private makeReadOnlyResult(
    request: Pick<RuntimeManagementRequest, 'domain' | 'action'>,
    state: RuntimeManagementState,
    fields?: Partial<RuntimeManagementResult>,
  ): RuntimeManagementResult {
    return {
      domain: request.domain,
      action: request.action,
      state,
      adapter: this.descriptor.id,
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
      ...fields,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}
