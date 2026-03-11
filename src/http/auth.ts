import { createMiddleware } from 'hono/factory';
import type { FleetConfig } from '../backends/cli/config.js';

export function bearerAuth(config: FleetConfig) {
  return createMiddleware(async (c, next) => {
    if (!config.apiKey) {
      return await next();
    }

    const authHeader = c.req.header('Authorization');
    // Fallback to query-param token for EventSource (which can't set headers)
    const queryToken = c.req.query('token');

    if (!authHeader?.startsWith('Bearer ') && !queryToken) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken!;
    if (token !== config.apiKey) {
      return c.json({ error: 'Invalid API key' }, 403);
    }

    await next();
  });
}
