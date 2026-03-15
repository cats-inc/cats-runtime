import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';
import { getCursorNative } from '../providerServices.js';
import { getRouteErrorStatus } from '../routeErrors.js';

export const cursorRoutes = new Hono();

/** GET /cursor/sessions?cwd=... — inspect native Cursor sessions */
cursorRoutes.get('/cursor/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const cwd = c.req.query('cwd');
  const instance = c.req.query('instance') || undefined;

  try {
    const sessions = cwd
      ? await getCursorNative(ctx, instance).listSessions(cwd)
      : await getCursorNative(ctx, instance).listAllSessions();
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json(
      { error: `Failed to inspect Cursor sessions: ${err}` },
      getRouteErrorStatus(err),
    );
  }
});

/** POST /cursor/sessions/discover — import native Cursor sessions into the registry */
cursorRoutes.post('/cursor/sessions/discover', async (c) => {
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
    const native = getCursorNative(ctx, body.instance);
    const nativeSessions = body.cwd
      ? await native.listSessions(body.cwd, { startIfNeeded: body.startIfNeeded })
      : await native.listAllSessions({ startIfNeeded: body.startIfNeeded });
    const sessions = nativeSessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: 'cursor',
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
      { error: `Failed to discover Cursor sessions: ${err}` },
      getRouteErrorStatus(err),
    );
  }
});
