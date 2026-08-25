import { Hono } from 'hono';
import { resolveProviderTarget } from '../../core/providerCatalog.js';
import type { AppContext } from '../app.js';

export const agentSessionRoutes = new Hono();

/**
 * POST /agent/sessions/discover — import sessions an ACP agent already owns.
 *
 * This is the agent-backend counterpart to the per-provider CLI discovery
 * routes. It is deliberately provider-agnostic: any ACP target that advertises
 * session enumeration can be imported through it, rather than one route per
 * agent family.
 */
agentSessionRoutes.post('/agent/sessions/discover', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const body = await c.req.json<{
    provider?: string;
    instance?: string;
    group?: string;
  }>().catch(() => ({})) as {
    provider?: string;
    instance?: string;
    group?: string;
  };

  const providerName = body.provider?.trim();
  if (!providerName) {
    return c.json({ error: 'provider is required' }, 400);
  }

  try {
    const target = resolveProviderTarget(ctx.config, providerName, body.instance);
    if (target.backend !== 'agent' || !target.remoteInstance) {
      return c.json({
        error: `Provider '${providerName}' resolves to '${target.backend}', not an agent target. `
          + 'Session discovery for CLI providers runs through their own discovery routes.',
      }, 400);
    }

    if (!ctx.agentBackend) {
      return c.json({ error: 'Agent backend is not available' }, 503);
    }

    // Through the manager, not a locally built adapter: the manager carries the
    // runtime's configured agent options, and an adapter built here would run
    // against a different environment than every other agent call.
    const catalog = await ctx.agentBackend.listSessions(target);
    if (!catalog.supported) {
      return c.json({
        provider: target.providerName,
        backend: target.backend,
        instance: target.instanceId,
        supported: false,
        summary: catalog.summary,
        discovered: 0,
        imported: 0,
        sessions: [],
      });
    }

    const imported = catalog.sessions
      .map((session) => ctx.registry.upsertDiscovered(session.providerSessionId, {
        providerName: target.providerName,
        providerBackend: 'agent',
        providerInstanceId: target.instanceId,
        cwd: session.cwd || '',
        ...(body.group ? { group: body.group } : {}),
        ...(session.summary ? { summary: session.summary } : {}),
        ...(session.lastActivity ? { lastActivity: session.lastActivity } : {}),
      }))
      .filter((session): session is NonNullable<typeof session> => Boolean(session));

    return c.json({
      provider: target.providerName,
      backend: target.backend,
      instance: target.instanceId,
      supported: true,
      summary: catalog.summary,
      discovered: catalog.sessions.length,
      imported: imported.length,
      sessions: imported,
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : String(error),
    }, 400);
  }
});
