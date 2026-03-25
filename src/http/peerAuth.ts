import { createMiddleware } from 'hono/factory';
import type { AppContext } from './app.js';

export function peerExecutionAuth() {
  return createMiddleware(async (c, next) => {
    const ctx = c.get('ctx' as never) as AppContext;
    const trust = ctx.peerTrust;

    if (!trust?.hasSharedSecret) {
      return c.json({
        error: 'Peer execution auth is not configured on this runtime.',
        code: 'peer_auth_required',
      }, 503);
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({
        error: 'Missing peer Authorization bearer token.',
        code: 'peer_auth_required',
      }, 401);
    }

    const token = authHeader.slice(7);
    if (!trust.validateSharedSecret(token)) {
      return c.json({
        error: 'Peer execution auth failed.',
        code: 'peer_auth_failed',
      }, 403);
    }

    const callerPeerId = parseOptionalString(c.req.header('x-cats-peer-id'));
    if (!callerPeerId) {
      return c.json({
        error: 'Missing x-cats-peer-id header.',
        code: 'peer_auth_required',
      }, 401);
    }

    if (!trust.canAcceptInboundExecution(callerPeerId)) {
      return c.json({
        error: 'Peer execution caller is not allowed.',
        code: 'peer_untrusted',
      }, 403);
    }

    c.set('peerCallerId' as never, callerPeerId);
    await next();
  });
}

function parseOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
