import type { ProviderCommandConfig } from '../config.js';
import type { QuotaCollectionResult } from '../../../core/usage/QuotaRefreshService.js';
import { quotaRecord as record, runQuotaCli, type QuotaProtocol } from './quotaCli.js';

const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Only entitlement facts cross the boundary. Authentication remains inside the CLI. */
export function normalizeCopilotQuotaRead(value: unknown, now = new Date()): QuotaCollectionResult {
  const snapshots = record(record(value)?.quotaSnapshots);
  if (!snapshots) return { status: 'unavailable' };
  const quota: Record<string, string | number | boolean> = {
    source: 'copilot.account.getQuota', observedAt: now.toISOString(),
  };
  let count = 0;
  for (const [id, value] of Object.entries(snapshots).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(id)) continue;
    const window = record(value);
    if (!window) continue;
    const unlimited = window.isUnlimitedEntitlement === true || window.entitlementRequests === -1;
    const remaining = window.remainingPercentage;
    const used = window.usedRequests;
    const limit = window.entitlementRequests;
    if (!unlimited && !(nonnegative(remaining) && remaining <= 100)
      && !(nonnegative(used) && nonnegative(limit))) continue;
    quota[`${id}.unit`] = 'requests';
    quota[`${id}.unlimited`] = unlimited;
    if (nonnegative(used)) quota[`${id}.used`] = used;
    if (!unlimited) {
      if (nonnegative(limit)) quota[`${id}.limit`] = limit;
      if (nonnegative(used) && nonnegative(limit)) quota[`${id}.remaining`] = Math.max(0, limit - used);
      if (nonnegative(remaining) && remaining <= 100) quota[`${id}.usedPercent`] = 100 - remaining;
    }
    if (typeof window.resetDate === 'string' && Number.isFinite(Date.parse(window.resetDate))) {
      quota[`${id}.resetsAt`] = new Date(window.resetDate).toISOString();
    }
    count += 1;
  }
  return count ? { status: 'updated', quota } : { status: 'unavailable' };
}

/** Copilot SDK wire protocol, without sessions, model prompts, auth RPCs, or provider HTTP. */
export function readCopilotQuota(
  command: ProviderCommandConfig, signal?: AbortSignal, timeoutMs = 8_000,
): Promise<QuotaCollectionResult> {
  if (command.args?.length) return Promise.resolve({ status: 'unsupported' });
  return runQuotaCli(command, 'copilot', copilotQuotaProtocol(), signal, timeoutMs);
}

export function copilotQuotaProtocol(): QuotaProtocol {
  let phase = 0;
  const request = (id: number, method: string) => ({ jsonrpc: '2.0', id, method, params: {} });
  return {
    args: ['--headless', '--no-auto-update', '--stdio', '--log-level', 'error'],
    framing: 'content-length',
    start: (send) => send(request(1, 'connect')),
    receive: (message, send) => {
      if (message.method) return message.id !== undefined ? { status: 'unsupported' } : undefined;
      if (message.id !== phase + 1) return undefined;
      const error = record(message.error);
      if (error) {
        // The official SDK also uses ping when connect is unavailable.
        if (phase === 0 && error.code === -32601) { phase = 1; send(request(2, 'ping')); return undefined; }
        const text = typeof error.message === 'string' ? error.message : '';
        return { status: error.code === -32601 ? 'unsupported'
          : /unauth|not logged|sign.?in|log.?in|auth.*required|requires.*auth|401/iu.test(text)
            ? 'auth_required' : 'error' };
      }
      if (phase < 2) {
        if (!record(message.result)) return { status: 'error' };
        phase = 2; send(request(3, 'account.getQuota')); return undefined;
      }
      return normalizeCopilotQuotaRead(message.result);
    },
  };
}
