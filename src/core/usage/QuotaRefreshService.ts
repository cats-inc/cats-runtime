import type { UsageQuotaObservation, UsageTarget } from './usageSnapshot.js';
import { usageTargetKey } from './usageSnapshot.js';

export interface QuotaCollectionResult {
  status: 'updated' | 'auth_required' | 'unsupported' | 'unavailable' | 'timeout' | 'error';
  quota?: Record<string, string | number | boolean>;
}
export interface QuotaRefreshResult {
  status: QuotaCollectionResult['status'] | 'cooldown' | 'busy';
  nextRefreshAt: string | null;
}

/** On-demand collection only. Polling a usage snapshot never calls this service. */
export class QuotaRefreshService {
  private nextRefresh = new Map<string, number>();
  private active?: { key: string; controller: AbortController; result: Promise<QuotaRefreshResult> };
  private closed = false;

  constructor(private options: {
    collect: (target: UsageTarget, signal: AbortSignal) => Promise<QuotaCollectionResult>;
    observe: (observation: UsageQuotaObservation) => void;
    now?: () => number;
  }) {}

  refresh(target: UsageTarget): Promise<QuotaRefreshResult> {
    if (this.closed) return Promise.resolve({ status: 'unavailable', nextRefreshAt: null });
    const key = usageTargetKey(target);
    if (this.active?.key === key) return this.active.result;
    if (this.active) return Promise.resolve({ status: 'busy', nextRefreshAt: null });
    const now = this.options.now?.() ?? Date.now();
    const next = this.nextRefresh.get(key) ?? 0;
    if (next > now) return Promise.resolve({ status: 'cooldown', nextRefreshAt: new Date(next).toISOString() });
    const controller = new AbortController();
    const result = Promise.resolve().then(async (): Promise<QuotaRefreshResult> => {
      let read: QuotaCollectionResult;
      try { read = await this.options.collect(target, controller.signal); } catch { read = { status: 'error' }; }
      const completed = this.options.now?.() ?? Date.now();
      if (!this.closed && read.status === 'updated' && read.quota) {
        this.options.observe({ ...target, observedAt: new Date(completed).toISOString(), quota: read.quota });
      }
      this.nextRefresh.delete(key);
      this.nextRefresh.set(key, completed + 60_000);
      if (this.nextRefresh.size > 1000) this.nextRefresh.delete(this.nextRefresh.keys().next().value!);
      return { status: this.closed ? 'unavailable' : read.status, nextRefreshAt: new Date(completed + 60_000).toISOString() };
    }).finally(() => { this.active = undefined; });
    this.active = { key, controller, result };
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.active?.controller.abort();
    await this.active?.result;
  }
}
