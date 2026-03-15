import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';
import { getOpencodeNative } from '../providerServices.js';

export const opencodeRoutes = new Hono();

/** GET /opencode/sessions?cwd=... — inspect native OpenCode sessions */
opencodeRoutes.get('/opencode/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const cwd = c.req.query('cwd');
  const instance = c.req.query('instance') || undefined;

  try {
    const sessions = cwd
      ? await getOpencodeNative(ctx, instance).listSessions(cwd)
      : await getOpencodeNative(ctx, instance).listAllSessions();
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json({ error: `Failed to inspect OpenCode sessions: ${err}` }, 500);
  }
});

/** POST /opencode/sessions/discover — import native OpenCode sessions into the registry */
opencodeRoutes.post('/opencode/sessions/discover', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{ cwd?: string; instance?: string; group?: string }>().catch(() => ({})) as {
    cwd?: string;
    instance?: string;
    group?: string;
  };

  try {
    const native = getOpencodeNative(ctx, body.instance);
    const nativeSessions = body.cwd
      ? await native.listSessions(body.cwd)
      : await native.listAllSessions();
    const sessions = nativeSessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: 'opencode',
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
    return c.json({ error: `Failed to discover OpenCode sessions: ${err}` }, 500);
  }
});
