import { Hono } from 'hono';
import { SetupReadModelService } from '../../core/bootstrap/SetupReadModelService.js';
import { SetupDiagnosticService } from '../../core/diagnostics/SetupDiagnosticService.js';
import type { AppContext } from '../app.js';

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

  const result = await ctx.bootstrapService.scan({ manual });

  return c.json({
    status: 'completed',
    scan: result,
  });
});

setupRoutes.post('/setup-apply', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  if (!ctx.bootstrapService) {
    return c.json({ error: 'Bootstrap service is not available' }, 503);
  }

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const providers = body.providers;
  if (!Array.isArray(providers) || providers.length === 0) {
    return c.json({ error: 'providers must be a non-empty array of provider names' }, 400);
  }

  let result: { configPath: string };
  try {
    result = await ctx.bootstrapService.applyConfig(providers as string[]);
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 400);
  }

  try {
    // In-process transition: reload config from the new providers.yaml,
    // clear bootstrap flag, and start subsystems that were skipped.
    if (ctx.completeBootstrap) {
      ctx.completeBootstrap();
    } else {
      ctx.startup.bootstrapRequired = false;
    }
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }

  return c.json({
    status: 'applied',
    configPath: result.configPath,
    bootstrapRequired: false,
    restart: false,
  });
});
