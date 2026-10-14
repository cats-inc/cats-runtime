import type { ProviderCommandConfig } from '../config.js';
import type { QuotaCollectionResult } from '../../../core/usage/QuotaRefreshService.js';
import { quotaRecord as record, runQuotaCli, type QuotaProtocol } from './quotaCli.js';

function cent(value: unknown): number | undefined {
  const amount = record(value);
  if (!amount) return undefined;
  // The CLI's Cent DTO explicitly defaults an omitted val to zero. An absent Cent is unknown.
  const val = amount.val === undefined ? 0 : amount.val;
  return typeof val === 'number' && Number.isSafeInteger(val) && val >= 0 ? val : undefined;
}

/** Included allowance only; prepaid credits and on-demand spending are separate billing. */
export function normalizeGrokQuotaRead(value: unknown, now = new Date()): QuotaCollectionResult {
  const config = record(record(value)?.config);
  if (!config) return { status: 'unavailable' };
  let used = config.creditUsagePercent;
  const current = record(config.currentPeriod);
  const legacy = used === undefined;
  if (legacy) {
    const limit = cent(config.monthlyLimit);
    const amount = cent(config.used);
    if (limit === undefined || limit <= 0 || amount === undefined) return { status: 'unavailable' };
    used = amount / limit * 100;
  }
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return { status: 'unavailable' };
  const id = legacy ? 'monthly' : current?.type === 'USAGE_PERIOD_TYPE_WEEKLY' ? 'weekly'
    : current?.type === 'USAGE_PERIOD_TYPE_MONTHLY' ? 'monthly' : 'included';
  const quota: Record<string, string | number | boolean> = {
    source: 'grok.billing', observedAt: now.toISOString(), [`${id}.usedPercent`]: Math.min(100, used),
  };
  const reset = current?.end ?? config.billingPeriodEnd;
  if (typeof reset === 'string' && Number.isFinite(Date.parse(reset))) quota[`${id}.resetsAt`] = new Date(reset).toISOString();
  return { status: 'updated', quota };
}

export function readGrokQuota(command: ProviderCommandConfig, signal?: AbortSignal, timeoutMs = 8_000): Promise<QuotaCollectionResult> {
  if (command.args?.length) return Promise.resolve({ status: 'unsupported' });
  return runQuotaCli(command, 'grok', grokQuotaProtocol(), signal, timeoutMs);
}

/** CLI reads its own login. No authenticate, sessions, prompts, or provider HTTP client. */
export function grokQuotaProtocol(): QuotaProtocol {
  let initialized = false;
  return {
    args: ['agent', 'stdio'], framing: 'ndjson',
    start: send => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'cats-runtime', version: '1.0.0' },
    } }),
    receive: (message, send) => {
      if (message.method) return message.id !== undefined ? { status: 'unsupported' } : undefined;
      if (message.id !== (initialized ? 2 : 1)) return undefined;
      const error = record(message.error);
      if (error) return { status: error.code === -32601 ? 'unsupported'
        : /auth|not logged|sign.?in|log.?in|401/iu.test(String(error.message)) ? 'auth_required' : 'error' };
      if (!initialized) {
        if (record(message.result)?.protocolVersion !== 1) return { status: 'unsupported' };
        initialized = true;
        send({ jsonrpc: '2.0', id: 2, method: '_x.ai/billing', params: {} });
        return undefined;
      }
      return normalizeGrokQuotaRead(message.result);
    },
  };
}
