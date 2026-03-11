import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';

export const cursorRoutes = new Hono();

/** GET /cursor/sessions?cwd=... — inspect native Cursor sessions */
cursorRoutes.get('/cursor/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const cwd = c.req.query('cwd');

  try {
    const sessions = cwd
      ? await ctx.cursorNative.listSessions(cwd)
      : await ctx.cursorNative.listAllSessions();
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json({ error: `Failed to inspect Cursor sessions: ${err}` }, 500);
  }
});

/** POST /cursor/sessions/discover — import native Cursor sessions into the registry */
cursorRoutes.post('/cursor/sessions/discover', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{ cwd?: string; group?: string }>().catch(() => ({})) as {
    cwd?: string;
    group?: string;
  };

  try {
    const nativeSessions = body.cwd
      ? await ctx.cursorNative.listSessions(body.cwd)
      : await ctx.cursorNative.listAllSessions();
    const sessions = nativeSessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: 'cursor',
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
    return c.json({ error: `Failed to discover Cursor sessions: ${err}` }, 500);
  }
});
