import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from './app.js';
import { bearerAuth } from './auth.js';
import { bootstrapGuard } from './routes/bootstrapGuard.js';
import { usageRoutes } from './routes/usage.js';
import type { RuntimeRouteEnv } from './routes/diagnosticsSupport.js';
import { RuntimeMeteringService } from '../core/usage/RuntimeMeteringService.js';

describe('GET /usage/snapshot', () => {
  it('requires normal auth, works during bootstrap, and only reads memory', async () => {
    const list = vi.fn(() => []);
    const ctx = {
      config: { apiKey: 'usage-test-key', providerInstances: { codex: { primary: { command: 'never-spawn' } } } },
      startup: { bootstrapRequired: true }, registry: { list }, metering: new RuntimeMeteringService(),
    } as unknown as AppContext;
    const app = new Hono<RuntimeRouteEnv>();
    app.use('*', bearerAuth(ctx.config));
    app.use('*', async (c, next) => { c.set('ctx', ctx); await next(); });
    app.use('*', bootstrapGuard());
    app.route('/', usageRoutes);
    expect((await app.request('/usage/snapshot')).status).toBe(401);
    expect(list).not.toHaveBeenCalled();
    const response = await app.request('/usage/snapshot', { headers: { Authorization: 'Bearer usage-test-key' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body.targets).toMatchObject([{ provider: 'codex', instance: 'primary', quota: { status: 'unavailable' } }]);
    expect(JSON.stringify(body)).not.toContain('usage-test-key');
    expect(JSON.stringify(body)).not.toContain('never-spawn');
    expect(list).toHaveBeenCalledOnce();
  });
});
