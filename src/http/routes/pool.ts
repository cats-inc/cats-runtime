import { Hono } from 'hono';
import { getRuntimeSessionManager, type AppContext } from '../app.js';

export const poolRoutes = new Hono();

/** GET /pool/status — worker pool overview */
poolRoutes.get('/pool/status', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  return c.json(getRuntimeSessionManager(ctx).status());
});
