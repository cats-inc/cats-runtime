import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';

export const kiroRoutes = new Hono();

const KIRO_NATIVE_MODELS = [
  'claude-opus-4.6',
  'deepseek-3.2',
  'minimax-m2.1',
];

const KIRO_WSL_MODELS = [
  'claude-sonnet-4.5',
  'deepseek-3.2',
  'minimax-m2.1',
];

function getKiroModelsForRuntime(mode: 'native' | 'wsl'): string[] {
  return mode === 'wsl' ? KIRO_WSL_MODELS : KIRO_NATIVE_MODELS;
}

/** GET /kiro/models — return the Kiro model options for the configured runtime */
kiroRoutes.get('/kiro/models', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  return c.json({
    runtime: ctx.config.kiroRuntime,
    source: 'static',
    models: getKiroModelsForRuntime(ctx.config.kiroRuntime.mode),
  });
});

/** GET /kiro/sessions?cwd=... — inspect native Kiro sessions */
kiroRoutes.get('/kiro/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const cwd = c.req.query('cwd');

  try {
    const sessions = cwd
      ? await ctx.kiroNative.listSessions(cwd)
      : await ctx.kiroNative.listAllSessions();
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json({ error: `Failed to inspect Kiro sessions: ${err}` }, 500);
  }
});

/** POST /kiro/sessions/discover — import native Kiro sessions into the registry */
kiroRoutes.post('/kiro/sessions/discover', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{ cwd?: string; group?: string }>().catch(() => ({})) as {
    cwd?: string;
    group?: string;
  };

  try {
    const nativeSessions = body.cwd
      ? await ctx.kiroNative.listSessions(body.cwd)
      : await ctx.kiroNative.listAllSessions();
    const sessions = nativeSessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: 'kiro',
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
    return c.json({ error: `Failed to discover Kiro sessions: ${err}` }, 500);
  }
});
