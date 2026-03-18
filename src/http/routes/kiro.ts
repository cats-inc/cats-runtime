import { Hono } from 'hono';
import type { AppContext } from '../app.js';
import { toSessionViews } from '../../backends/cli/pool/sessionView.js';
import { resolveProviderTarget } from '../../core/providerCatalog.js';
import { getStaticProviderModels } from '../../core/models/providerModelCatalog.js';
import { getKiroNative } from '../providerServices.js';
import { getRouteErrorStatus } from '../routeErrors.js';

export const kiroRoutes = new Hono();

/** GET /kiro/models — return the Kiro model options for the configured runtime */
kiroRoutes.get('/kiro/models', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const instance = c.req.query('instance') || undefined;
  try {
    const target = resolveProviderTarget(ctx.config, 'kiro', instance);
    const runtime = target.cliInstance?.commandConfig.runtime;
    return c.json({
      runtime,
      instance: target.instanceId,
      source: 'static',
      models: getStaticProviderModels(target).map((model) => model.id),
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
