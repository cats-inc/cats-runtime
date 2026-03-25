import type {
  RuntimeManagementRequest,
  RuntimeManagementResult,
  RuntimeManagementDomain,
  RuntimeManagementAction,
} from '../../types.js';
import type {
  ManagementAdapter,
  ManagementAdapterDescriptor,
  ManagementAdapterDiagnostics,
} from '../types.js';

/**
 * Test-only adapter that returns canned results.
 */
export class StubManagementAdapter implements ManagementAdapter {
  readonly descriptor: ManagementAdapterDescriptor;
  private results = new Map<string, RuntimeManagementResult>();
  private diagnostics: ManagementAdapterDiagnostics = {
    available: true,
    commandFound: true,
    authenticated: true,
    version: '0.0.0-stub',
    checks: [{ code: 'stub', status: 'ok', message: 'Stub adapter always ready.' }],
  };

  constructor(
    id: string,
    domains: RuntimeManagementDomain[],
    actions: RuntimeManagementAction[],
  ) {
    this.descriptor = {
      id,
      label: `Stub (${id})`,
      transport: 'cli',
      capabilities: domains.map((domain) => ({
        domain,
        actions: actions.filter((a) => {
          if (domain === 'review') {
            return a.startsWith('audit_review') || a.startsWith('open_pull') || a.startsWith('inspect_pull') || a.startsWith('wait_review');
          }
          return a.startsWith('audit_deployment') || a.startsWith('create_deployment') || a.startsWith('inspect_deployment') || a.startsWith('read_deployment');
        }),
      })),
    };
  }

  setResult(action: string, result: RuntimeManagementResult): void {
    this.results.set(action, result);
  }

  setDiagnostics(diag: ManagementAdapterDiagnostics): void {
    this.diagnostics = diag;
  }

  async execute(request: RuntimeManagementRequest): Promise<RuntimeManagementResult> {
    const canned = this.results.get(request.action);
    if (canned) return canned;

    return {
      domain: request.domain,
      action: request.action,
      state: 'completed',
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
        reason: 'Stub adapter does not enforce authorization.',
      },
      warnings: [],
      blockedReasons: [],
      capabilityGaps: [],
      outputs: { stub: true },
    };
  }

  async diagnose(): Promise<ManagementAdapterDiagnostics> {
    return this.diagnostics;
  }
}
