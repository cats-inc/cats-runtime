import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';

export const auggieRoutes = new Hono();

/** GET /auggie/sessions?cwd=... — inspect native Auggie sessions */
auggieRoutes.get('/auggie/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const cwd = c.req.query('cwd');

  try {
    const sessions = cwd
      ? await ctx.auggieSessions.listSessions(cwd)
      : await ctx.auggieSessions.listAllSessions();
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json({ error: `Failed to inspect Auggie sessions: ${err}` }, 500);
  }
});

/** POST /auggie/sessions/discover — import native Auggie sessions into the registry */
auggieRoutes.post('/auggie/sessions/discover', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{ cwd?: string; group?: string }>().catch(() => ({})) as {
    cwd?: string;
    group?: string;
  };

  try {
    const nativeSessions = body.cwd
      ? await ctx.auggieSessions.listSessions(body.cwd)
      : await ctx.auggieSessions.listAllSessions();
    const sessions = nativeSessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: 'auggie',
        cwd: session.cwd,
        group: body.group,
        summary: session.summary,
        sourcePath: session.sourcePath,
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
    return c.json({ error: `Failed to discover Auggie sessions: ${err}` }, 500);
  }
});
