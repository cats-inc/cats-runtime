import { Hono } from 'hono';
import { createDiscoveryStatusPayload } from '../../backends/cli/discovery/wslDiscovery.js';
import type { AppContext } from '../app.js';

export const discoveryRoutes = new Hono();

/** GET /discovery/status — current background discovery policy and runtime state */
discoveryRoutes.get('/discovery/status', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  if (ctx.wslDiscoveryStatus) {
    const status = createDiscoveryStatusPayload(ctx.config);
    return c.json({
      wsl: ctx.wslDiscoveryStatus.snapshot(),
      docker: status.docker,
    });
  }

  return c.json(createDiscoveryStatusPayload(ctx.config));
});
