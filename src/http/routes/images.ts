import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { RuntimeRouteEnv } from './diagnosticsSupport.js';
import { ImageError } from '../../core/media/contracts.js';

export const imageRoutes = new Hono<RuntimeRouteEnv>();
imageRoutes.onError((error, c) => c.json(
  { error: error instanceof ImageError ? error.code : 'image_service_unavailable' },
  error instanceof ImageError ? error.status : 503,
));
imageRoutes.use('/media/images/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (!c.get('ctx').images) return c.json({ error: 'image_service_unavailable' }, 503);
  await next();
});
imageRoutes.get('/media/images/capabilities', (c) => c.json(c.get('ctx').images!.capabilities()));
imageRoutes.post('/media/images/jobs', bodyLimit({ maxSize: 12000 }), async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { throw new ImageError('invalid_image_request'); }
  return c.json(await c.get('ctx').images!.submit(body), 202);
});
imageRoutes.get('/media/images/jobs/:id', async (c) => c.json(await c.get('ctx').images!.get(c.req.param('id'))));
imageRoutes.post('/media/images/jobs/:id/cancel', async (c) => c.json(await c.get('ctx').images!.cancel(c.req.param('id'))));
imageRoutes.get('/media/images/jobs/:id/image', async (c) => {
  const bytes = await c.get('ctx').images!.image(c.req.param('id'));
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store',
    'Content-Length': String(bytes.length), 'X-Content-Type-Options': 'nosniff' } });
});
