import { Hono } from 'hono';
import { createDisabledPeerDiscoverySnapshot } from '../../core/peers/PeerDiscoveryController.js';
import type { AppContext } from '../app.js';
import type { RuntimeRouteEnv } from './diagnosticsSupport.js';

export const peerRoutes = new Hono<RuntimeRouteEnv>();

peerRoutes.get('/peers', (c) => {
  try {
    const ctx = c.get('ctx' as never) as AppContext;
    const includeStale = parseBooleanQuery(c.req.query('includeStale')) === true;
    const peers = ctx.peerRegistry?.list({ includeStale }) || [];

    return c.json({
      count: peers.length,
      query: {
        includeStale,
      },
      discovery: getPeerDiscoverySnapshot(ctx),
      peers,
    });
  } catch (error) {
    if (error instanceof PeerRouteQueryError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

peerRoutes.get('/peers/:peerId', (c) => {
  try {
    const ctx = c.get('ctx' as never) as AppContext;
    const includeStale = parseBooleanQuery(c.req.query('includeStale')) === true;
    const peerId = c.req.param('peerId');
    const peer = ctx.peerRegistry?.get(peerId, { includeStale });

    if (!peer) {
      return c.json({ error: `Unknown peer '${peerId}'.` }, 404);
    }

    return c.json({
      discovery: getPeerDiscoverySnapshot(ctx),
      peer,
    });
  } catch (error) {
    if (error instanceof PeerRouteQueryError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

class PeerRouteQueryError extends Error {}

function parseBooleanQuery(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === '1' || value === 'true') {
    return true;
  }
  if (value === '0' || value === 'false') {
    return false;
  }
  throw new PeerRouteQueryError(`Invalid boolean query value '${value}'.`);
}

function getPeerDiscoverySnapshot(ctx: AppContext) {
  return ctx.peerDiscovery?.snapshot()
    || createDisabledPeerDiscoverySnapshot(
      ctx.peerCapabilities?.getLocalPeerId() || null,
      ctx.peerRegistry?.summary(),
    );
}
