import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getRuntimeSessionManager, type AppContext } from '../app.js';
import { GRANT_CATEGORIES, InteractionError, type GrantCategory } from '../../core/interactions/types.js';

/** Mounted after the same bearer-auth middleware as session execution. */
export const interactionRoutes = new Hono<{ Variables: { ctx: AppContext } }>();

interactionRoutes.get('/sessions/:id/capabilities', async c => {
  c.header('Cache-Control', 'no-store');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  if (!ctx.registry.get(id)) return c.json({ error: 'Session not found' }, 404);
  try { return c.json(await getRuntimeSessionManager(ctx).sessionCapabilities(id, c.req.query('refresh') === 'true')); }
  catch { return c.json({ error: 'Session capability observation unavailable' }, 409); }
});

interactionRoutes.get('/sessions/:id/interactions', c => {
  c.header('Cache-Control', 'no-store');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  if (!ctx.registry.get(id)) return c.json({ error: 'Session not found' }, 404);
  return c.json(getRuntimeSessionManager(ctx).interactionSnapshot(id));
});

/** ADR-055: every session holding a standing grant, so a host that restarted can still show Stop. */
interactionRoutes.get('/interactions/grants', c => {
  c.header('Cache-Control', 'no-store');
  return c.json({ version: 1, sessions: getRuntimeSessionManager(c.get('ctx')).standingGrantHolders() });
});

/** ADR-055: the owner's stop. Ends standing grants (`?category=` limits it to one); answers with the snapshot. */
interactionRoutes.delete('/sessions/:id/interactions/grants', c => {
  c.header('Cache-Control', 'no-store');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  if (!ctx.registry.get(id)) return c.json({ error: 'Session not found' }, 404);
  const category = c.req.query('category');
  if (category !== undefined && !(GRANT_CATEGORIES as readonly string[]).includes(category)) {
    return c.json({ error: 'Unknown grant category', code: 'interaction_invalid' }, 400);
  }
  return c.json(getRuntimeSessionManager(ctx).revokeStandingGrants(id, category as GrantCategory | undefined));
});

interactionRoutes.post('/sessions/:id/interactions/:interactionId/responses',
  bodyLimit({ maxSize: 36_864 }), async c => {
    c.header('Cache-Control', 'no-store');
    const ctx = c.get('ctx');
    const id = c.req.param('id');
    if (!ctx.registry.get(id)) return c.json({ error: 'Session not found' }, 404);
    let value: unknown;
    try { value = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON response' }, 400); }
    try {
      return c.json(await getRuntimeSessionManager(ctx).respondToInteraction(id, c.req.param('interactionId'), value));
    } catch (error) {
      if (error instanceof InteractionError) return c.json({ error: error.message, code: error.code },
        error.code === 'interaction_invalid' ? 400 : error.code === 'interaction_not_found' ? 404 : 409);
      return c.json({ error: 'Provider response delivery failed' }, 500);
    }
  });
