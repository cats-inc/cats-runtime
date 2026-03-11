import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { CodexSessionScanner } from '../../backends/cli/discovery/CodexSessionScanner.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';

export const codexRoutes = new Hono();

async function scanCodexSessions(ctx: AppContext, cwd?: string) {
  const scanner = new CodexSessionScanner(ctx.config.codexSessionsDir);
  const sessions = await scanner.scan();

  if (!cwd) {
    return sessions;
  }

  return sessions.filter((session) => session.cwd === cwd);
}

/** GET /codex/sessions?cwd=... — inspect discovered Codex sessions from local rollout files */
codexRoutes.get('/codex/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const cwd = c.req.query('cwd');

  try {
    const sessions = await scanCodexSessions(ctx, cwd);
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json({ error: `Failed to inspect Codex sessions: ${err}` }, 500);
  }
});

/** POST /codex/sessions/discover — import discovered Codex sessions into the registry */
codexRoutes.post('/codex/sessions/discover', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{ cwd?: string; group?: string }>().catch(() => ({})) as {
    cwd?: string;
    group?: string;
  };

  try {
    const nativeSessions = await scanCodexSessions(ctx, body.cwd);
    const sessions = nativeSessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: 'codex',
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
    return c.json({ error: `Failed to discover Codex sessions: ${err}` }, 500);
  }
});
