import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../types.js';
import { RuntimeMeteringService } from './RuntimeMeteringService.js';

const now = new Date('2026-09-10T09:00:00Z');
function session(provider = 'codex', instance = 'main'): SessionInfo {
  return {
    id: `${provider}-${instance}`, providerName: provider, providerBackend: 'cli',
    providerInstanceId: instance, status: 'ready', origin: 'runtime', cwd: '/private/workspace',
    messageCount: 0, totalInputTokens: 0, totalOutputTokens: 0,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
}

describe('Usage snapshot', () => {
  it('keeps unknown usage distinct from observed zero and costs separated by currency', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    expect(service.buildUsageSnapshot([session()]).totals.totalTokens).toBeNull();
    for (const currency of ['USD', 'TWD']) {
      service.observeEvent(session(), { type: 'result', usage: {
        inputTokens: 0, outputTokens: 0, estimatedCost: 1, currency, sourceConfidence: 'reported',
      } }, { turnStartedAt: now.getTime(), observedAt: now.toISOString() });
    }
    const snapshot = service.buildUsageSnapshot([session()]);
    expect(snapshot.totals.totalTokens).toBe(0);
    expect(snapshot.totals.costs).toEqual([
      { currency: 'TWD', amount: 1, observations: 1 }, { currency: 'USD', amount: 1, observations: 1 },
    ]);
    expect(snapshot.targets[0]!.quota.status).toBe('unavailable');
    expect(JSON.stringify(snapshot)).not.toContain('/private/workspace');
  });

  it('retains quota-only progress independently of result usage and redacts unrelated fields', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    service.observeEvent(session(), { type: 'progress', metadata: {
      kind: 'quota', quota: {
        source: 'codex.account/rateLimits/updated', observedAt: now.toISOString(),
        'primary.usedPercent': 0, 'primary.windowDurationMins': 300,
        'primary.resetsAt': '2026-09-10T14:00:00Z', apiKey: 'do-not-expose',
      }, native: { password: 'do-not-expose' },
    } }, { turnStartedAt: now.getTime(), observedAt: now.toISOString() });
    const snapshot = service.buildUsageSnapshot([]);
    expect(snapshot.coverage.retainedRecords).toBe(0);
    expect(snapshot.targets[0]!.quota).toMatchObject({
      status: 'available', freshness: 'fresh', accountId: null, accountLinkage: 'unverified',
      windows: [{ id: 'primary', usedPercent: 0, remainingPercent: 100, windowMinutes: 300 }],
    });
    expect(JSON.stringify(snapshot)).not.toContain('do-not-expose');
  });

  it('normalizes Claude fractions and retains stale values after a reset without inventing a refill', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    service.observeEvent(session('claude'), { type: 'progress', metadata: { kind: 'quota', quota: {
      source: 'claude.rate_limit_event', observedAt: '2026-09-10T08:59:00Z',
      'five_hour.utilization': 0.25, 'five_hour.resetsAt': '2026-09-10T08:59:30Z',
    } } }, { turnStartedAt: now.getTime(), observedAt: now.toISOString() });
    const quota = service.buildUsageSnapshot([]).targets[0]!.quota;
    expect(quota.freshness).toBe('stale');
    expect(quota.windows[0]).toMatchObject({ usedPercent: 25, remainingPercent: 75 });
  });

  it('does not turn invalid percentages or premium request counts into account allowance', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    service.observeEvent(session(), { type: 'progress', metadata: { kind: 'quota', quota: {
      source: 'codex.account/rateLimits/updated', 'primary.usedPercent': 200,
    } } }, { turnStartedAt: now.getTime() });
    service.observeEvent(session('copilot'), { type: 'result', metadata: { runtimeUsage: { quota: { premiumRequests: 1 } } } }, { turnStartedAt: now.getTime() });
    const snapshot = service.buildUsageSnapshot([session(), session('copilot')]);
    expect(snapshot.targets.find((target) => target.provider === 'codex')!.quota).toMatchObject({ status: 'unavailable', windows: [] });
    expect(snapshot.targets.find((target) => target.provider === 'copilot')!.quota).toMatchObject({ status: 'unavailable', windows: [], refreshSupported: true });
  });

  it('keeps explicit Copilot account quantities and unlimited windows separate from execution usage', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    service.observeQuota({ provider: 'copilot', instance: 'default', backend: 'cli', observedAt: now.toISOString(), quota: {
      source: 'copilot.account.getQuota', 'premium_interactions.unit': 'requests',
      'premium_interactions.used': 60, 'premium_interactions.limit': 300, 'premium_interactions.remaining': 240,
      'premium_interactions.usedPercent': 20, 'chat.unit': 'requests', 'chat.unlimited': true,
    } });
    const snapshot = service.buildUsageSnapshot([]);
    expect(snapshot.totals.observations).toBe(0);
    expect(snapshot.targets[0]!.quota).toMatchObject({ status: 'available', refreshSupported: true,
      source: 'copilot.account.getQuota', scope: 'provider_account_query', windows: [
        { id: 'chat', unlimited: true, limit: null, remaining: null, usedPercent: null, remainingPercent: null },
        { id: 'premium_interactions', unit: 'requests', used: 60, limit: 300, remaining: 240, remainingPercent: 80 },
      ],
    });
  });

  it('does not sum quota across targets with unverified account identity', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    for (const instance of ['one', 'two']) service.observeEvent(session('codex', instance), {
      type: 'progress', metadata: { kind: 'quota', quota: {
        source: 'codex.account/rateLimits/updated', 'primary.usedPercent': 40,
      } },
    }, { turnStartedAt: now.getTime() });
    const snapshot = service.buildUsageSnapshot([]);
    expect(snapshot.targets).toHaveLength(2);
    expect(snapshot.targets.every((target) => target.quota.windows[0]!.usedPercent === 40)).toBe(true);
    expect(snapshot.totals).not.toHaveProperty('quota');
  });

  it('retains account quota after a newer Copilot execution counter', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    service.observeQuota({ provider: 'copilot', instance: 'main', backend: 'cli', observedAt: now.toISOString(), quota: {
      source: 'copilot.account.getQuota', 'premium_interactions.usedPercent': 20,
    } });
    service.observeEvent(session('copilot'), { type: 'result', usage: { inputTokens: 10, outputTokens: 20 },
      metadata: { runtimeUsage: { quota: { premiumRequests: 1 } } },
    }, { turnStartedAt: now.getTime(), observedAt: new Date(now.getTime() + 1000).toISOString() });
    const snapshot = service.buildUsageSnapshot([]);
    expect(snapshot.targets[0]!.quota).toMatchObject({ source: 'copilot.account.getQuota',
      windows: [{ usedPercent: 20, remainingPercent: 80 }],
    });
    expect(snapshot.totals).toMatchObject({ observations: 1, totalTokens: 30 });
  });

  it('exposes record eviction and changes epochs across restarts without claiming history', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    for (let index = 0; index < 1002; index++) service.observeEvent(session(), {
      type: 'result', usage: { inputTokens: 1, outputTokens: 1 },
    }, { turnStartedAt: now.getTime(), observedAt: now.toISOString() });
    const snapshot = service.buildUsageSnapshot([]);
    expect(snapshot.coverage).toMatchObject({ retainedRecords: 1000, droppedRecords: 2, truncated: true, historyAvailable: false });
    expect(snapshot.runtime.epoch).not.toBe(new RuntimeMeteringService().buildUsageSnapshot([]).runtime.epoch);
  });

  it('does not let a late cached result overwrite a newer quota-only observation', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    service.observeEvent(session(), { type: 'progress', metadata: { kind: 'quota', quota: {
      source: 'codex.account/rateLimits/updated', observedAt: now.toISOString(), 'primary.usedPercent': 40,
    } } }, { turnStartedAt: now.getTime() });
    service.observeEvent(session(), { type: 'result', metadata: { runtimeUsage: { quota: {
      source: 'codex.account/rateLimits/updated', observedAt: new Date(now.getTime() - 60_000).toISOString(), 'primary.usedPercent': 10,
    } } } }, { turnStartedAt: now.getTime() });
    expect(service.buildUsageSnapshot([]).targets[0]!.quota.windows[0]!.usedPercent).toBe(40);
  });

  it('retains Claude account numbers and timestamp after a newer status-only passive event', () => {
    const service = new RuntimeMeteringService({ now: () => now });
    service.observeQuota({ provider: 'claude', instance: 'main', backend: 'cli', observedAt: now.toISOString(), quota: {
      source: 'claude.get_usage', 'seven_day.usedPercent': 6,
    } });
    const before = service.buildUsageSnapshot([]).targets[0]!.quota;
    service.observeEvent(session('claude'), { type: 'progress', metadata: { kind: 'quota', quota: {
      source: 'claude.rate_limit_event', status: 'allowed', observedAt: new Date(now.getTime() + 1000).toISOString(),
    } } }, { turnStartedAt: now.getTime() });
    expect(service.buildUsageSnapshot([]).targets[0]!.quota).toEqual(before);
    expect(before.windows[0]).toMatchObject({ usedPercent: 6, remainingPercent: 94 });
  });
});
