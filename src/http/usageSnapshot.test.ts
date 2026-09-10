import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from './app.js';
import { bearerAuth } from './auth.js';
import { bootstrapGuard } from './routes/bootstrapGuard.js';
import { usageRoutes } from './routes/usage.js';
import type { RuntimeRouteEnv } from './routes/diagnosticsSupport.js';
import { RuntimeMeteringService } from '../core/usage/RuntimeMeteringService.js';
import { QuotaRefreshService } from '../core/usage/QuotaRefreshService.js';

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

it('explicit refresh authenticates, validates the configured target, works in bootstrap and never creates sessions', async () => {
  const metering = new RuntimeMeteringService();
  const collect = vi.fn(async () => ({ status: 'updated' as const, quota: {
    source: 'codex.account/rateLimits/read', 'primary.usedPercent': 10,
  } }));
  const ctx = { config: { apiKey: 'fixture', providerInstances: { codex: { primary: {} }, copilot: { primary: {} }, claude: { primary: {} }, antigravity: { primary: {} } } },
    startup: { bootstrapRequired: true }, registry: { list: () => [] }, metering,
    quotaRefresh: new QuotaRefreshService({ collect, observe: (q) => metering.observeQuota(q) }),
  } as unknown as AppContext;
  const app = new Hono<RuntimeRouteEnv>();
  app.use('*', bearerAuth(ctx.config));
  app.use('*', async (c, next) => { c.set('ctx', ctx); await next(); });
  app.use('*', bootstrapGuard()); app.route('/', usageRoutes);
  const request = (body: unknown, authorized = true) => app.request('/usage/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer fixture' } : {}) }, body: JSON.stringify(body),
  });
  const target = { provider: 'codex', instance: 'primary' };
  expect((await request(target, false)).status).toBe(401);
  for (const input of [null, [], { ...target, instance: '__proto__' }, { ...target, provider: 'kiro' }, { ...target, command: 'unsafe' }]) {
    expect((await request(input)).status).toBe(400);
  }
  expect((await request({ ...target, instance: 'x'.repeat(2000) })).status).toBe(413);
  expect(collect).not.toHaveBeenCalled();
  const response = await request(target);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.json();
  expect(body).toMatchObject({ status: 'updated', snapshot: { sessions: [], totals: { observations: 0 } } });
  expect(body.snapshot.targets.find((target: { provider: string }) => target.provider === 'codex').quota.windows).toMatchObject([{ remainingPercent: 90 }]);
  expect(await (await request(target)).json()).toMatchObject({ status: 'cooldown' });
  expect(collect).toHaveBeenCalledOnce();
  expect((await request({ provider: 'copilot', instance: 'primary' })).status).toBe(200);
  expect(collect).toHaveBeenLastCalledWith({ provider: 'copilot', instance: 'primary', backend: 'cli' }, expect.any(AbortSignal));
  expect(collect).toHaveBeenCalledTimes(2);
  expect((await request({ provider: 'claude', instance: 'primary' })).status).toBe(200);
  expect(collect).toHaveBeenLastCalledWith({ provider: 'claude', instance: 'primary', backend: 'cli' }, expect.any(AbortSignal));
  expect(collect).toHaveBeenCalledTimes(3);
  expect((await request({ provider: 'antigravity', instance: 'primary' })).status).toBe(200);
  expect(collect).toHaveBeenLastCalledWith({ provider: 'antigravity', instance: 'primary', backend: 'cli' }, expect.any(AbortSignal));
  expect(collect).toHaveBeenCalledTimes(4);
});
