import { Hono } from 'hono';
import { SetupDiagnosticService } from '../../core/diagnostics/SetupDiagnosticService.js';
import type { AppContext } from '../app.js';

export const setupDiagnosticsRoutes = new Hono();

setupDiagnosticsRoutes.post('/diagnostics/setup-report', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const refreshScan = body.refreshScan === true
    || c.req.query('refresh') === '1'
    || c.req.query('refresh') === 'true';

  const service = new SetupDiagnosticService({
    config: ctx.config,
    startup: ctx.startup,
    ...(ctx.bootstrapService ? { bootstrapService: ctx.bootstrapService } : {}),
  });

  const result = await service.generateReport({ refreshScan });

  return c.json({
    status: 'generated',
    artifactPath: result.artifactPath,
    report: result.report,
  });
});

setupDiagnosticsRoutes.get('/diagnostics/setup-report/latest', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const service = new SetupDiagnosticService({
    config: ctx.config,
    startup: ctx.startup,
    ...(ctx.bootstrapService ? { bootstrapService: ctx.bootstrapService } : {}),
  });
  const latest = service.readLatestReport();

  if (!latest) {
    return c.json({
      error: 'setup_diagnostic_report_not_found',
    }, 404);
  }

  return c.json(latest);
});
