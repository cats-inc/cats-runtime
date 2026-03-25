import { createMiddleware } from 'hono/factory';
import type { AppContext } from './app.js';

export function peerExecutionAuth() {
  return createMiddleware(async (c, next) => {
    const ctx = c.get('ctx' as never) as AppContext;
    const trust = ctx.peerTrust;
    const admission = ctx.peerExecutionAdmission;
    const callerKey = resolvePeerAuthKey(
      c.req.header('x-cats-peer-id'),
      c.req.header('x-forwarded-for'),
      c.req.header('x-real-ip'),
    );

    const authRateLimit = admission?.getAuthFailureStatus(callerKey);
    if (authRateLimit?.limited) {
      return c.json({
        error: 'Peer execution auth is temporarily rate limited for this caller.',
        code: 'peer_auth_rate_limited',
        retryAfterMs: authRateLimit.retryAfterMs,
      }, 429);
    }

    if (!trust?.hasSharedSecret) {
      return c.json({
        error: 'Peer execution auth is not configured on this runtime.',
        code: 'peer_auth_required',
      }, 503);
    }

    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      const failure = admission?.recordAuthFailure(callerKey);
      if (failure?.limited) {
        return c.json({
          error: 'Peer execution auth is temporarily rate limited for this caller.',
          code: 'peer_auth_rate_limited',
          retryAfterMs: failure.retryAfterMs,
        }, 429);
      }
      return c.json({
        error: 'Missing peer Authorization bearer token.',
        code: 'peer_auth_required',
      }, 401);
    }

    const token = authHeader.slice(7);
    if (!trust.validateSharedSecret(token)) {
      const failure = admission?.recordAuthFailure(callerKey);
      if (failure?.limited) {
        return c.json({
          error: 'Peer execution auth is temporarily rate limited for this caller.',
          code: 'peer_auth_rate_limited',
          retryAfterMs: failure.retryAfterMs,
        }, 429);
      }
      return c.json({
        error: 'Peer execution auth failed.',
        code: 'peer_auth_failed',
      }, 403);
    }

    const callerPeerId = parseOptionalString(c.req.header('x-cats-peer-id'));
    if (!callerPeerId) {
      const failure = admission?.recordAuthFailure(callerKey);
      if (failure?.limited) {
        return c.json({
          error: 'Peer execution auth is temporarily rate limited for this caller.',
          code: 'peer_auth_rate_limited',
          retryAfterMs: failure.retryAfterMs,
        }, 429);
      }
      return c.json({
        error: 'Missing x-cats-peer-id header.',
        code: 'peer_auth_required',
      }, 401);
    }

    if (!trust.canAcceptInboundExecution(callerPeerId)) {
      const failure = admission?.recordAuthFailure(callerKey);
      if (failure?.limited) {
        return c.json({
          error: 'Peer execution auth is temporarily rate limited for this caller.',
          code: 'peer_auth_rate_limited',
          retryAfterMs: failure.retryAfterMs,
        }, 429);
      }
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

function resolvePeerAuthKey(
  callerPeerId: string | undefined,
  forwardedFor: string | undefined,
  realIp: string | undefined,
): string {
  const peerId = parseOptionalString(callerPeerId);
  if (peerId) {
    return `peer:${peerId}`;
  }

  const forwarded = parseOptionalString(forwardedFor)?.split(',')[0]?.trim();
  if (forwarded) {
    return `ip:${forwarded}`;
  }

  const ip = parseOptionalString(realIp);
  if (ip) {
    return `ip:${ip}`;
  }

  return 'anonymous';
}
