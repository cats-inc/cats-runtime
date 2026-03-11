import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  return c.json({
    service: 'cats-runtime',
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  });
});
