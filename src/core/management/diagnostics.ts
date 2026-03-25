import type { RuntimeManagementService } from './RuntimeManagementService.js';

// ---------------------------------------------------------------------------
// Diagnostic result
// ---------------------------------------------------------------------------

export interface ManagementDiagnosticResult {
  adapter: string;
  domain: string;
  transport: 'cli' | 'api';
  availability: {
    status: 'ok' | 'degraded' | 'unavailable';
    checkedAt: string;
    summary: string;
  };
  checks: Array<{
    code: string;
    status: 'ok' | 'degraded' | 'unavailable';
    message: string;
    details?: Record<string, unknown>;
  }>;
}

// ---------------------------------------------------------------------------
// Run diagnostics across registered adapters
// ---------------------------------------------------------------------------

export async function diagnoseManagementAdapters(
  service: RuntimeManagementService,
  options?: { domains?: string[]; workspacePath?: string },
): Promise<ManagementDiagnosticResult[]> {
  const adapters = service.getRegisteredAdapters();
  const results: ManagementDiagnosticResult[] = [];

  for (const adapter of adapters) {
    // Filter by requested domains if provided
    const domains = adapter.descriptor.capabilities.map((c) => c.domain);
    if (options?.domains && options.domains.length > 0) {
      const match = domains.some((d) => options.domains!.includes(d));
      if (!match) continue;
    }

    const diag = await adapter.diagnose(options?.workspacePath);
    const status = diag.available ? 'ok' : diag.commandFound ? 'degraded' : 'unavailable';
    const summary = diag.available
      ? `${adapter.descriptor.label} is ready${diag.version ? ` (${diag.version})` : ''}.`
      : diag.commandFound
        ? `${adapter.descriptor.label} found but not authenticated.`
        : `${adapter.descriptor.label} not found in PATH.`;

    for (const domain of domains) {
      if (options?.domains && options.domains.length > 0 && !options.domains.includes(domain)) {
        continue;
      }
      results.push({
        adapter: adapter.descriptor.id,
        domain,
        transport: adapter.descriptor.transport,
        availability: {
          status,
          checkedAt: new Date().toISOString(),
          summary,
        },
        checks: diag.checks,
      });
    }
  }

  return results;
}
