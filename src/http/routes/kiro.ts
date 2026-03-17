import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { resolveProviderInstance } from '../../backends/cli/config.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';
import { getKiroNative } from '../providerServices.js';
import { getRouteErrorStatus } from '../routeErrors.js';

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

function getKiroModelsForRuntime(mode: string): string[] {
  return mode === 'wsl' ? KIRO_WSL_MODELS : KIRO_NATIVE_MODELS;
}

/** GET /kiro/models — return the Kiro model options for the configured runtime */
kiroRoutes.get('/kiro/models', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const instance = c.req.query('instance') || undefined;
  try {
    const providerInstance = resolveProviderInstance(ctx.config, 'kiro', instance);
    return c.json({
      runtime: providerInstance.commandConfig.runtime,
      instance: providerInstance.id,
      source: 'static',
      models: getKiroModelsForRuntime(providerInstance.commandConfig.runtime.mode),
    });
  } catch (err) {
    return c.json(
      { error: `Failed to inspect Kiro models: ${err}` },
      getRouteErrorStatus(err),
    );
  }
});

/** GET /kiro/sessions?cwd=... — inspect native Kiro sessions */
kiroRoutes.get('/kiro/sessions', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const cwd = c.req.query('cwd');
  const instance = c.req.query('instance') || undefined;

  try {
    const sessions = cwd
      ? await getKiroNative(ctx, instance).listSessions(cwd)
      : await getKiroNative(ctx, instance).listAllSessions();
    return c.json({ sessions, count: sessions.length });
  } catch (err) {
    return c.json(
      { error: `Failed to inspect Kiro sessions: ${err}` },
      getRouteErrorStatus(err),
    );
  }
});

/** POST /kiro/sessions/discover — import native Kiro sessions into the registry */
kiroRoutes.post('/kiro/sessions/discover', async (c) => {
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
    const native = getKiroNative(ctx, body.instance);
    const nativeSessions = body.cwd
      ? await native.listSessions(body.cwd, { startIfNeeded: body.startIfNeeded })
      : await native.listAllSessions({ startIfNeeded: body.startIfNeeded });
    const sessions = nativeSessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: 'kiro',
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
      { error: `Failed to discover Kiro sessions: ${err}` },
      getRouteErrorStatus(err),
    );
  }
});
