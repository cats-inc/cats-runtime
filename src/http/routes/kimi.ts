import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';
import { getKimiNative } from '../providerServices.js';
import { getRouteErrorStatus } from '../routeErrors.js';

export const kimiRoutes = new Hono();

/** GET /kimi/sessions?cwd=... — inspect native Kimi Code sessions */
kimiRoutes.get('/kimi/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const cwd = c.req.query('cwd');
  const instance = c.req.query('instance') || undefined;

  try {
    const native = getKimiNative(ctx, instance);
    const sessions = cwd ? await native.listSessions(cwd) : await native.listAllSessions();
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json(
      { error: `Failed to inspect Kimi sessions: ${err}` },
      getRouteErrorStatus(err),
    );
  }
});

/** POST /kimi/sessions/discover — import native Kimi Code sessions into the registry */
kimiRoutes.post('/kimi/sessions/discover', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{
    cwd?: string;
    instance?: string;
    group?: string;
    startIfNeeded?: boolean;
  }>().catch(() => ({})) as {
    cwd?: string;
    instance?: string;
    group?: string;
    startIfNeeded?: boolean;
  };

  try {
    const native = getKimiNative(ctx, body.instance);
    const nativeSessions = body.cwd
      ? await native.listSessions(body.cwd, { startIfNeeded: body.startIfNeeded })
      : await native.listAllSessions({ startIfNeeded: body.startIfNeeded });
    const sessions = nativeSessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: 'kimi',
        providerInstanceId: body.instance,
        cwd: session.cwd,
        group: body.group,
        summary: session.summary,
        messageCount: session.messageCount,
        lastActivity: session.lastActivity,
        model: session.model,
      }))
      .filter((session): session is NonNullable<typeof session> => Boolean(session));

    return c.json({
      sessions: toSessionViews(sessions, {
        attached: false,
        externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
      }),
      count: sessions.length,
    });
  } catch (err) {
    return c.json(
      { error: `Failed to discover Kimi sessions: ${err}` },
      getRouteErrorStatus(err),
    );
  }
});
