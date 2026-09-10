import { describe, expect, it, vi } from 'vitest';
import { QuotaRefreshService } from './QuotaRefreshService.js';
import { RuntimeMeteringService } from './RuntimeMeteringService.js';

const target = { provider: 'codex', instance: 'primary', backend: 'cli' as const };
describe('explicit quota refresh service', () => {
  it('coalesces, limits concurrent instances, cools down failures and retains the previous observation', async () => {
    let now = Date.parse('2026-09-10T00:00:00Z');
    const metering = new RuntimeMeteringService({ now: () => new Date(now) });
    const collect = vi.fn(async () => ({ status: 'updated' as 'updated' | 'timeout', quota: {
      source: 'codex.account/rateLimits/read', observedAt: new Date(now).toISOString(), 'primary.usedPercent': 10,
    } }));
    const service = new QuotaRefreshService({ collect, observe: (q) => metering.observeQuota(q), now: () => now });
    const first = service.refresh(target);
    expect(service.refresh(target)).toBe(first);
    expect(await service.refresh({ ...target, instance: 'other' })).toMatchObject({ status: 'busy' });
    expect(await first).toMatchObject({ status: 'updated' });
    expect(await service.refresh(target)).toMatchObject({ status: 'cooldown' });
    expect(collect).toHaveBeenCalledOnce();
    const before = metering.buildUsageSnapshot([]);
    expect(before.coverage.retainedRecords).toBe(0);
    expect(before.sessions).toEqual([]);
    expect(before.targets[0]?.quota).toMatchObject({ scope: 'provider_account_query', windows: [{ remainingPercent: 90 }] });
    now += 60_000;
    collect.mockResolvedValueOnce({ status: 'timeout', quota: { source: 'must-not-store' } } as never);
    expect(await service.refresh(target)).toMatchObject({ status: 'timeout' });
    expect(metering.buildUsageSnapshot([]).targets[0]?.quota).toEqual(before.targets[0]?.quota);
    expect(await service.refresh(target)).toMatchObject({ status: 'cooldown' });
  });

  it('shutdown cancels outstanding collection and does not publish its late success', async () => {
    const observe = vi.fn();
    const collect = vi.fn((_target, signal: AbortSignal) => new Promise<{ status: 'updated'; quota: {} }>((resolve) => {
      if (signal.aborted) resolve({ status: 'updated', quota: {} });
      else signal.addEventListener('abort', () => resolve({ status: 'updated', quota: {} }), { once: true });
    }));
    const service = new QuotaRefreshService({ collect, observe });
    const result = service.refresh(target);
    await service.close();
    expect(await result).toMatchObject({ status: 'unavailable' });
    expect(observe).not.toHaveBeenCalled();
    expect(await service.refresh(target)).toMatchObject({ status: 'unavailable' });
  });
});
