import { Hono } from 'hono';
import { getRuntimeMeteringService } from '../app.js';
import type { RuntimeRouteEnv } from './diagnosticsSupport.js';
import type { UsageTarget } from '../../core/usage/usageSnapshot.js';
import type { AppContext } from '../app.js';
import { bodyLimit } from 'hono/body-limit';

export const usageRoutes = new Hono<RuntimeRouteEnv>();

function snapshot(ctx: AppContext) {
  const targets: UsageTarget[] = [];
  for (const [provider, instances] of Object.entries(ctx.config.providerInstances ?? {})) {
    for (const instance of Object.keys(instances)) targets.push({ provider, instance, backend: 'cli' });
  }
  return getRuntimeMeteringService(ctx).buildUsageSnapshot(ctx.registry.list(), targets);
}

usageRoutes.get('/usage/snapshot', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(snapshot(c.get('ctx')));
});

usageRoutes.post('/usage/refresh', bodyLimit({ maxSize: 1024 }), async (c) => {
  c.header('Cache-Control', 'no-store');
  const ctx = c.get('ctx');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_quota_target' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'invalid_quota_target' }, 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'provider' && key !== 'instance')
    || input.provider !== 'codex' || typeof input.instance !== 'string' || input.instance.length > 100
    || !Object.hasOwn(ctx.config.providerInstances?.codex ?? {}, input.instance)) {
    return c.json({ error: 'invalid_quota_target' }, 400);
  }
  if (!ctx.quotaRefresh) return c.json({ error: 'quota_refresh_unavailable' }, 503);
  const result = await ctx.quotaRefresh.refresh({ provider: 'codex', instance: input.instance, backend: 'cli' });
  return c.json({ ...result, snapshot: snapshot(ctx) });
});
