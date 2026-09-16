import { Hono } from 'hono';
import { SetupReadModelService } from '../../core/bootstrap/SetupReadModelService.js';
import { SetupDiagnosticService } from '../../core/diagnostics/SetupDiagnosticService.js';
import type { AppContext } from '../app.js';
import { ProviderSelectionError } from '../../core/bootstrap/ProviderSelectionService.js';

export const setupRoutes = new Hono();

setupRoutes.get('/setup-state', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  if (!ctx.bootstrapService) {
    return c.json({ error: 'Bootstrap service is not available' }, 503);
  }

  const diagnostics = new SetupDiagnosticService({
    config: ctx.config,
    startup: ctx.startup,
    bootstrapService: ctx.bootstrapService,
  });
  const readModel = new SetupReadModelService({
    bootstrapRequired: ctx.startup.bootstrapRequired,
    bootstrapService: ctx.bootstrapService,
    diagnostics,
  });

  // Full provider detail is always included. The /setup-* routes
  // go through the global bearerAuth middleware (the path check in the
  // logger middleware only skips request logging, not auth), so callers
  // must already be authenticated when an API key is configured.
  return c.json(await readModel.read());
});

setupRoutes.post('/setup-scan', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  if (!ctx.bootstrapService) {
    return c.json({ error: 'Bootstrap service is not available' }, 503);
  }

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const manual = body.manual === true
    || c.req.query('manual') === 'true'
    || c.req.query('manual') === '1';

  let started: boolean;
  try {
    ({ started } = ctx.bootstrapService.startScan({ manual, targets: body.targets }));
  } catch (error) {
    if (error instanceof ProviderSelectionError) return c.json({ error: error.message }, error.status);
    throw error;
  }

  // 202, not the finished scan: the probes outlive any timeout a caller in
  // front of this route is willing to hold. Callers poll /setup-state, which
  // reports `scanning` until the run settles into `ready` or `error`.
  return c.json({
    status: 'scanning',
    started,
    state: await ctx.bootstrapService.getSetupState(),
  }, 202);
});

setupRoutes.put('/setup-selection', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  if (!ctx.bootstrapService) {
    return c.json({ error: 'Bootstrap service is not available' }, 503);
  }

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const selection = ctx.bootstrapService.saveSelection(body.targets, body.expectedRevision);
    ctx.startup.bootstrapRequired = false;
    return c.json({ status: 'saved', selection, bootstrapRequired: false,
      observations: ctx.bootstrapService.getProviderObservations(),
      state: await ctx.bootstrapService.getSetupState() });
  } catch (error) {
    if (error instanceof ProviderSelectionError) return c.json({ error: error.message }, error.status);
    return c.json({ error: 'Could not save provider selection' }, 500);
  }
});

setupRoutes.post('/setup-selection/reload', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  if (!ctx.bootstrapService) return c.json({ error: 'Bootstrap service is not available' }, 503);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const selection = ctx.bootstrapService.selection.reload(body.expectedRevision);
    ctx.startup.bootstrapRequired = false;
    return c.json({ status: 'reloaded', selection,
      observations: ctx.bootstrapService.getProviderObservations(),
      state: await ctx.bootstrapService.getSetupState() });
  } catch (error) {
    if (error instanceof ProviderSelectionError) return c.json({ error: error.message }, error.status);
    return c.json({ error: 'Could not reload provider selection' }, 500);
  }
});

setupRoutes.post('/setup-operations', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  if (!ctx.bootstrapService) return c.json({ error: 'Bootstrap service is not available' }, 503);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const operationId = ctx.bootstrapService.selection.acquireOperation(body.target, body.expectedRevision, body.operationId);
    return c.json({ operationId }, 201);
  } catch (error) {
    if (error instanceof ProviderSelectionError) return c.json({ error: error.message }, error.status);
    throw error;
  }
});

setupRoutes.delete('/setup-operations/:id', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  ctx.bootstrapService?.selection.releaseOperation(c.req.param('id'));
  return c.body(null, 204);
});
