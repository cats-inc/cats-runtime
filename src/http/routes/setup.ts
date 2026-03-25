import { Hono } from 'hono';
import type { AppContext } from '../app.js';

export const setupRoutes = new Hono();

setupRoutes.get('/providers/setup/state', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  if (!ctx.bootstrapService) {
    return c.json({ error: 'Bootstrap service is not available' }, 503);
  }

  const state = await ctx.bootstrapService.getSetupState();
  const latestScan = await ctx.bootstrapService.getLatestScan();

  return c.json({
    bootstrapRequired: ctx.startup.bootstrapRequired,
    state,
    scan: latestScan
      ? {
        scannedAt: latestScan.scannedAt,
        scanType: latestScan.scanType,
        providerCount: latestScan.providers.length,
        availableCount: latestScan.providers.filter((p) => p.available).length,
      }
      : null,
    universe: ctx.bootstrapService.getProviderUniverse().map((entry) => ({
      provider: entry.provider,
      familyLabel: entry.familyLabel,
      binaryName: entry.binaryName,
    })),
  });
});

setupRoutes.post('/providers/setup/scan', async (c) => {
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

setupRoutes.post('/providers/setup/apply', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  if (!ctx.bootstrapService) {
    return c.json({ error: 'Bootstrap service is not available' }, 503);
  }

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const providers = body.providers;
  if (!Array.isArray(providers) || providers.length === 0) {
    return c.json({ error: 'providers must be a non-empty array of provider names' }, 400);
  }

  try {
    const result = await ctx.bootstrapService.applyConfig(providers as string[]);

    // In-process transition: exit bootstrap mode so session routes become
    // available.  The env-derived provider topology already covers the
    // selected providers for the remainder of this process lifetime.
    // A full config reload happens on next startup when the generated
    // providers.yaml is read.
    ctx.startup.bootstrapRequired = false;

    return c.json({
      status: 'applied',
      configPath: result.configPath,
      bootstrapRequired: false,
      restart: false,
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 400);
  }
});
