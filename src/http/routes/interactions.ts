import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getRuntimeSessionManager, type AppContext } from '../app.js';
import { InteractionError } from '../../core/interactions/types.js';

/** Mounted after the same bearer-auth middleware as session execution. */
export const interactionRoutes = new Hono<{ Variables: { ctx: AppContext } }>();

interactionRoutes.get('/sessions/:id/interactions', c => {
  c.header('Cache-Control', 'no-store');
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  if (!ctx.registry.get(id)) return c.json({ error: 'Session not found' }, 404);
  return c.json(getRuntimeSessionManager(ctx).interactionSnapshot(id));
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
