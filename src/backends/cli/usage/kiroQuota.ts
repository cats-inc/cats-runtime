import type { ProviderCommandConfig } from '../config.js';
import type { QuotaCollectionResult } from '../../../core/usage/QuotaRefreshService.js';
import { quotaRecord as record, runQuotaCli, type QuotaProtocol } from './quotaCli.js';

const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function failure(message: unknown): QuotaCollectionResult {
  const text = typeof message === 'string' ? message : '';
  return { status: /unauth|not logged|sign.?in|log.?in|auth.*required|requires.*auth|bearer token|access token|401/iu.test(text)
    ? 'auth_required' : /unknown method|not supported|unsupported|method not found/iu.test(text) ? 'unsupported' : 'error' };
}

/** V3 account credits only; execution usage, add-ons and billing details are not an allowance. */
export function normalizeKiroQuotaRead(value: unknown, now = new Date()): QuotaCollectionResult {
  const result = record(value);
  if (result?.success === false) return failure(result.message);
  if (result?.success !== true) return { status: 'unavailable' };
  const data = record(result.data);
  if (!Array.isArray(data?.usageBreakdowns)) return { status: 'unavailable' };
  const credits = data.usageBreakdowns.filter((item: unknown) => record(item)?.resourceType === 'CREDIT');
  // A duplicate resource is ambiguous; never combine independent allowances.
  if (credits.length !== 1) return { status: 'unavailable' };
  const window = record(credits[0])!;
  if (!nonnegative(window.used)) return { status: 'unavailable' };
  const quota: Record<string, string | number | boolean> = {
    source: 'kiro.account.getUsage', observedAt: now.toISOString(),
    'credits.unit': 'credits', 'credits.used': window.used,
  };
  if (window.hasLimit === true && nonnegative(window.limit)) {
    quota['credits.limit'] = window.limit;
    quota['credits.remaining'] = Math.max(0, window.limit - window.used);
    // The CLI's percentage is rounded. Derive from native quantities in this same bucket.
    if (window.limit > 0) quota['credits.usedPercent'] = Math.min(100, window.used / window.limit * 100);
  }
  // hasLimit:false does not establish an unlimited subscription entitlement.
  const reset = data.billingCycleReset;
  if (typeof reset === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(reset)
    && Number.isFinite(Date.parse(reset)) && new Date(reset).toISOString().slice(0, 10) === reset) {
    quota['credits.resetsOn'] = reset; // A calendar date, not an invented midnight instant.
  }
  return { status: 'updated', quota };
}

export function readKiroQuota(
  command: ProviderCommandConfig, signal?: AbortSignal, timeoutMs = 8_000,
): Promise<QuotaCollectionResult> {
  if (command.args?.length) return Promise.resolve({ status: 'unsupported' });
  return runQuotaCli(command, 'kiro', kiroQuotaProtocol(), signal, timeoutMs);
}

/** CLI owns authentication; no authenticate, session/new or session/prompt messages. */
export function kiroQuotaProtocol(): QuotaProtocol {
  let initialized = false;
  return {
    args: ['acp', '--agent-engine', 'v3', '--auth-method', 'cli'],
    framing: 'ndjson',
    start: send => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'cats-runtime', version: '1.0.0' },
    } }),
    receive: (message, send) => {
      if (message.method) return message.id !== undefined ? { status: 'unsupported' } : undefined;
      if (message.id !== (initialized ? 2 : 1)) return undefined;
      const error = record(message.error);
      if (error) return error.code === -32601 ? { status: 'unsupported' } : failure(error.message);
      if (!initialized) {
        if (record(message.result)?.protocolVersion !== 1) return { status: 'unsupported' };
        initialized = true;
        send({ jsonrpc: '2.0', id: 2, method: '_kiro/account/getUsage', params: {} });
        return undefined;
      }
      return normalizeKiroQuotaRead(message.result);
    },
  };
}
