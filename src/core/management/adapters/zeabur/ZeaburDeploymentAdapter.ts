import { runCliCommand, isCliAvailable, parseCliJson } from '../../cli.js';
import {
  DEPLOYMENT_ACTIONS,
  createManagementIssue,
  createManagementWarning,
  type RuntimeManagementRequest,
  type RuntimeManagementResult,
  type RuntimeManagementState,
  type RuntimeManagementIssue,
  type RuntimeManagementWarning,
} from '../../types.js';
import type { RuntimePreviewSurface } from '../../../types.js';
import type {
  ManagementAdapter,
  ManagementAdapterDescriptor,
  ManagementAdapterDiagnostics,
} from '../types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const HTTP_URL_PREFIX = /^https?:\/\//i;
const MAX_LOG_CHARS = 12_000;

export class ZeaburDeploymentAdapter implements ManagementAdapter {
  readonly descriptor: ManagementAdapterDescriptor = {
    id: 'zeabur',
    label: 'Zeabur CLI',
    transport: 'cli',
    capabilities: [{
      domain: 'deployment',
      actions: [...DEPLOYMENT_ACTIONS],
    }],
  };

  private readonly command: string;
  private readonly timeoutMs: number;

  constructor(options?: { command?: string; timeoutMs?: number }) {
    this.command = options?.command ?? 'zeabur';
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async execute(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    switch (request.action) {
      case 'audit_deployment_target':
        return this.auditDeploymentTarget(request);
      case 'create_deployment':
        return this.createDeployment(request);
      case 'inspect_deployment':
        return this.inspectDeployment(request);
      case 'read_deployment_logs':
        return this.readDeploymentLogs(request);
      default:
        return this.makeResult(request, 'unsupported', {
          capabilityGaps: [createManagementIssue('unsupported_action', 'unsupported', `Action '${request.action}' is not supported by the Zeabur adapter.`)],
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

    // Check auth via zeabur auth status or whoami
    const authResult = await runCliCommand(this.command, ['auth', 'status'], {
      cwd: workspacePath,
      timeoutMs: this.timeoutMs,
    });
    const authenticated = authResult.code === 0;
    checks.push({
      code: 'authenticated',
      status: authenticated ? 'ok' : 'unavailable',
      message: authenticated ? 'Zeabur CLI authenticated' : 'Zeabur CLI not authenticated. Run `zeabur auth login`.',
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

  private async auditDeploymentTarget(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const cwd = request.workspacePath;
    const blockedReasons: RuntimeManagementIssue[] = [];
    const outputs: Record<string, unknown> = {};

    // Check auth
    const authResult = await runCliCommand(this.command, ['auth', 'status'], { cwd, timeoutMs: this.timeoutMs });
    if (authResult.code !== 0) {
      blockedReasons.push(createManagementIssue('auth_missing', 'blocked', 'Zeabur CLI is not authenticated. Run `zeabur auth login`.'));
    }

    // Check project context (zeabur may use a .zeabur config or context)
    const contextResult = await runCliCommand(this.command, ['context', 'get'], { cwd, timeoutMs: this.timeoutMs });
    if (contextResult.code === 0) {
      const ctx = parseCliJson(contextResult.stdout);
      if (ctx) outputs.context = ctx;
    } else {
      blockedReasons.push(createManagementIssue('project_not_linked', 'blocked', 'No Zeabur project context found. Run `zeabur context set` to link a project.'));
    }

    const state: RuntimeManagementState = blockedReasons.length > 0 ? 'blocked' : 'ready';
    return this.makeResult(request, state, { blockedReasons, outputs });
  }

  private async createDeployment(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const cwd = request.workspacePath;

    // Preview mode
    if (!request.apply) {
      return this.makeResult(request, 'ready', {
        outputs: { preview: true, message: 'Deployment would be triggered via `zeabur deploy`.' },
      });
    }

    // Apply mode
    const result = await runCliCommand(this.command, ['deploy'], { cwd, timeoutMs: this.timeoutMs });
    if (result.code !== 0) {
      return this.makeResult(request, 'blocked', {
        blockedReasons: [createManagementIssue('deploy_failed', 'blocked', result.stderr.trim() || 'Deployment failed.')],
      });
    }

    // Try to extract deployment URL from output
    const outputs: Record<string, unknown> = { raw: result.stdout.trim() };
    const previewSurfaces: RuntimePreviewSurface[] = [];

    const urlMatch = result.stdout.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      outputs.url = url;
      previewSurfaces.push({
        id: `deployment:${Date.now()}`,
        kind: 'service',
        source: 'request_service',
        status: 'ready',
        label: 'Zeabur Deployment',
        renderHint: 'open_external',
        url,
        provenance: {
          ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
        },
      });
    }

    return this.makeResult(request, 'completed', { outputs, previewSurfaces });
  }

  private async inspectDeployment(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const cwd = request.workspacePath;
    const target = (request.target ?? {}) as Record<string, unknown>;

    // Try to get service/deployment status
    const args = ['service', 'list'];
    if (typeof target.format === 'string' && target.format === 'json') {
      args.push('--json');
    }

    const result = await runCliCommand(this.command, args, { cwd, timeoutMs: this.timeoutMs });
    if (result.code !== 0) {
      return this.makeResult(request, 'blocked', {
        blockedReasons: [createManagementIssue('inspect_failed', 'blocked', result.stderr.trim() || 'Failed to inspect deployment.')],
      });
    }

    const parsed = parseCliJson(result.stdout);
    return this.makeResult(request, 'completed', {
      outputs: parsed ?? { raw: result.stdout.trim() },
    });
  }

  private async readDeploymentLogs(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const cwd = request.workspacePath;
    const target = (request.target ?? {}) as Record<string, unknown>;
    const serviceId = typeof target.serviceId === 'string' ? target.serviceId : undefined;

    const args = ['deployment', 'log'];
    if (serviceId) args.push('--service', serviceId);

    const result = await runCliCommand(this.command, args, { cwd, timeoutMs: this.timeoutMs });
    if (result.code !== 0) {
      return this.makeResult(request, 'blocked', {
        blockedReasons: [createManagementIssue('logs_failed', 'blocked', result.stderr.trim() || 'Failed to read deployment logs.')],
      });
    }

    // Truncate logs to prevent oversized responses
    const logs = result.stdout.length > MAX_LOG_CHARS
      ? result.stdout.slice(0, MAX_LOG_CHARS) + '\n... (truncated)'
      : result.stdout;

    return this.makeResult(request, 'completed', {
      outputs: { logs },
      ...(result.stdout.length > MAX_LOG_CHARS
        ? { warnings: [createManagementWarning('logs_truncated', `Logs truncated to ${MAX_LOG_CHARS} characters.`)] }
        : {}),
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
}
