import type { ProviderCommandConfig } from '../config.js';
import type { QuotaCollectionResult } from '../../../core/usage/QuotaRefreshService.js';
import { quotaRecord as record, runQuotaCli, type QuotaProtocol } from './quotaCli.js';

/** get_usage utilization is 0–100, unlike the passive rate_limit_event fraction. */
export function normalizeClaudeQuotaRead(value: unknown, now = new Date()): QuotaCollectionResult {
  const result = record(value);
  const limits = record(result?.rate_limits);
  if (!limits) return { status: result?.rate_limits_available === false ? 'unsupported' : 'unavailable' };
  const quota: Record<string, string | number | boolean> = {
    source: 'claude.get_usage', observedAt: now.toISOString(),
  };
  let count = 0;
  for (const id of ['five_hour', 'seven_day', 'seven_day_oauth_apps', 'seven_day_opus', 'seven_day_sonnet']) {
    const window = record(limits[id]);
    const used = window?.utilization;
    if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || used > 100) continue;
    quota[`${id}.usedPercent`] = used;
    quota[`${id}.windowDurationMins`] = id === 'five_hour' ? 300 : 10080;
    if (typeof window?.resets_at === 'string' && Number.isFinite(Date.parse(window.resets_at))) {
      quota[`${id}.resetsAt`] = new Date(window.resets_at).toISOString();
    }
    count += 1;
  }
  return count ? { status: 'updated', quota } : { status: 'unavailable' };
}

/** Only initialize + get_usage controls. There is deliberately no user/prompt frame. */
export function readClaudeQuota(
  command: ProviderCommandConfig, signal?: AbortSignal, timeoutMs = 8_000,
): Promise<QuotaCollectionResult> {
  if (command.args?.length) return Promise.resolve({ status: 'unsupported' });
  return runQuotaCli(command, 'claude', claudeQuotaProtocol(), signal, timeoutMs);
}

export function claudeQuotaProtocol(): QuotaProtocol {
  let initialized = false;
  return {
    args: ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--verbose', '--safe-mode', '--no-session-persistence', '--tools', '', '--strict-mcp-config'],
    framing: 'ndjson',
    start: (send) => send({ type: 'control_request', request_id: 'quota-init', request: { subtype: 'initialize' } }),
    receive: (message, send) => {
      if (message.type === 'control_request') return { status: 'unsupported' };
      // Any model event is unexpected; never treat a turn as a quota-only read.
      if (message.type === 'assistant' || message.type === 'result') return { status: 'error' };
      if (message.type !== 'control_response') return undefined;
      const response = record(message.response);
      if (response?.request_id !== (initialized ? 'quota-read' : 'quota-init')) return undefined;
      if (response.subtype === 'error') {
        const text = typeof response.error === 'string' ? response.error : '';
        return { status: /unknown|unsupported|not supported|unhandled/iu.test(text) ? 'unsupported'
          : /unauth|not logged|sign.?in|log.?in|auth.*required|requires.*auth|401/iu.test(text) ? 'auth_required' : 'error' };
      }
      if (response.subtype !== 'success' || !record(response.response)) return { status: 'error' };
      if (!initialized) {
        initialized = true;
        send({ type: 'control_request', request_id: 'quota-read', request: { subtype: 'get_usage', skip_behaviors: true } });
        return undefined;
      }
      return normalizeClaudeQuotaRead(response.response);
    },
  };
}
