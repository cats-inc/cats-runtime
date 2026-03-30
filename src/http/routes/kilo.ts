import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';
import { getKiloNative } from '../providerServices.js';
import { getRouteErrorStatus } from '../routeErrors.js';

export const kiloRoutes = new Hono();

/** GET /kilo/sessions?cwd=... — inspect native Kilo sessions */
kiloRoutes.get('/kilo/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const cwd = c.req.query('cwd');
  const instance = c.req.query('instance') || undefined;

  try {
    const sessions = cwd
      ? await getKiloNative(ctx, instance).listSessions(cwd)
      : await getKiloNative(ctx, instance).listAllSessions();
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json(
      { error: `Failed to inspect Kilo sessions: ${err}` },
      getRouteErrorStatus(err),
    );
  }
});

/** POST /kilo/sessions/discover — import native Kilo sessions into the registry */
kiloRoutes.post('/kilo/sessions/discover', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{ cwd?: string; instance?: string; group?: string }>().catch(() => ({})) as {
    cwd?: string;
    instance?: string;
    group?: string;
  };

  try {
    const native = getKiloNative(ctx, body.instance);
    const nativeSessions = body.cwd
      ? await native.listSessions(body.cwd)
      : await native.listAllSessions();
    const sessions = nativeSessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: 'kilo',
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
      { error: `Failed to discover Kilo sessions: ${err}` },
      getRouteErrorStatus(err),
    );
  }
});
