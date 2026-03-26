import { Hono } from 'hono';
import {
  createDiscoveryStatusPayload,
  createDockerDiscoveryStatusSnapshot,
} from '../../backends/cli/discovery/wslDiscovery.js';
import { getPeerDiscoverySnapshot } from '../../core/peers/discoverySnapshot.js';
import type { AppContext } from '../app.js';

export const discoveryRoutes = new Hono();

/** GET /discovery/status — current background discovery policy and runtime state */
discoveryRoutes.get('/discovery/status', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const lan = getPeerDiscoverySnapshot(ctx);
  if (ctx.wslDiscoveryStatus) {
    return c.json({
      wsl: ctx.wslDiscoveryStatus.snapshot(),
      docker: createDockerDiscoveryStatusSnapshot(ctx.config),
      lan,
    });
  }

  return c.json({
    ...createDiscoveryStatusPayload(ctx.config),
    lan,
  });
});
