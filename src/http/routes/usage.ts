import { Hono } from 'hono';
import { getRuntimeMeteringService } from '../app.js';
import type { RuntimeRouteEnv } from './diagnosticsSupport.js';
import type { UsageTarget } from '../../core/usage/usageSnapshot.js';

export const usageRoutes = new Hono<RuntimeRouteEnv>();

usageRoutes.get('/usage/snapshot', (c) => {
  const ctx = c.get('ctx');
  const targets: UsageTarget[] = [];
  for (const [provider, instances] of Object.entries(ctx.config.providerInstances ?? {})) {
    for (const instance of Object.keys(instances)) targets.push({ provider, instance, backend: 'cli' });
  }
  c.header('Cache-Control', 'no-store');
  return c.json(getRuntimeMeteringService(ctx).buildUsageSnapshot(ctx.registry.list(), targets));
});
