import { Hono } from 'hono';
import { createDiscoveryStatusPayload } from '../../backends/cli/discovery/wslDiscovery.js';
import { createDisabledPeerDiscoverySnapshot } from '../../core/peers/PeerDiscoveryController.js';
import type { AppContext } from '../app.js';

export const discoveryRoutes = new Hono();

/** GET /discovery/status — current background discovery policy and runtime state */
discoveryRoutes.get('/discovery/status', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const lan = ctx.peerDiscovery?.snapshot()
    || createDisabledPeerDiscoverySnapshot(
      ctx.peerCapabilities?.getLocalPeerId() || null,
      ctx.peerRegistry?.summary(),
    );
  if (ctx.wslDiscoveryStatus) {
    const status = createDiscoveryStatusPayload(ctx.config);
    return c.json({
      wsl: ctx.wslDiscoveryStatus.snapshot(),
      docker: status.docker,
      lan,
    });
  }

  return c.json({
    ...createDiscoveryStatusPayload(ctx.config),
    lan,
  });
});
