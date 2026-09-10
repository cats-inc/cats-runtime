import type { ProviderBackend, RuntimeGuardrailResult, RuntimeRateLimitIncident, RuntimeUsageRecord } from '../types.js';

export interface UsageTarget {
  provider: string;
  instance: string;
  backend: ProviderBackend;
}

export interface UsageQuotaObservation extends UsageTarget {
  observedAt: string;
  quota: Record<string, string | number | boolean>;
}

export interface UsageQuotaWindow {
  id: string;
  unit: 'percent';
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  windowMinutes: number | null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function timestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null;
}

export function usageTargetKey(target: UsageTarget): string {
  return JSON.stringify([target.backend, target.provider, target.instance]);
}

/** Only adapters with an existing, fixture-backed signal mapping are normalized here. */
export function normalizeUsageQuota(observation: UsageQuotaObservation | undefined, now: Date) {
  const quota = observation?.quota;
  const source = quota?.source === 'claude.rate_limit_event' || quota?.source === 'codex.account/rateLimits/updated'
    ? quota.source : null;
  const windows: UsageQuotaWindow[] = [];
  if (quota && source) {
    const suffix = source === 'claude.rate_limit_event' ? '.utilization' : '.usedPercent';
    const ids = new Set(Object.keys(quota)
      .filter((key) => key.endsWith(suffix) || key.endsWith('.resetsAt'))
      .map((key) => key.slice(0, key.lastIndexOf('.'))));
    for (const id of [...ids].sort().slice(0, 20)) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(id)) continue;
      const raw = finite(quota[`${id}${suffix}`]);
      const percent = raw === null ? null : source === 'claude.rate_limit_event' ? raw * 100 : raw;
      const usedPercent = percent !== null && percent <= 100 ? percent : null;
      windows.push({
        id,
        unit: 'percent',
        usedPercent,
        remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
        resetsAt: timestamp(quota[`${id}.resetsAt`]),
        windowMinutes: finite(quota[`${id}.windowDurationMins`]),
      });
    }
  }
  const observedAt = timestamp(quota?.observedAt) ?? observation?.observedAt ?? null;
  const stale = observedAt !== null && (
    now.getTime() - Date.parse(observedAt) > 5 * 60_000
    || Date.parse(observedAt) > now.getTime() + 60_000
    || windows.some((window) => window.resetsAt !== null && Date.parse(window.resetsAt) <= now.getTime())
  );
  return {
    status: windows.length ? 'available' as const
      : observation?.provider === 'claude' || observation?.provider === 'codex'
        ? 'unavailable' as const : 'unsupported' as const,
    freshness: observedAt === null ? 'unknown' as const : stale ? 'stale' as const : 'fresh' as const,
    source,
    observedAt,
    accountId: null,
    accountLinkage: 'unverified' as const,
    scope: 'provider_reported_during_runtime_execution' as const,
    automaticRefresh: false as const,
    windows,
  };
}

function sum(records: readonly RuntimeUsageRecord[], field: 'inputTokens' | 'outputTokens' | 'totalTokens') {
  const values = records.map((record) => finite(record[field])).filter((value): value is number => value !== null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function usageTotals(records: readonly RuntimeUsageRecord[]) {
  const currencies = new Map<string, { currency: string; amount: number; observations: number }>();
  const confidence = { reported: 0, aggregated: 0, estimated: 0, unknown: 0 };
  for (const record of records) {
    const kind = record.sourceConfidence && record.sourceConfidence in confidence ? record.sourceConfidence : 'unknown';
    confidence[kind] += 1;
    const amount = finite(record.estimatedCost);
    if (amount !== null) {
      const currency = /^[A-Z]{3}$/u.test(record.currency ?? '') ? record.currency! : 'unknown';
      const group = currencies.get(currency) ?? { currency, amount: 0, observations: 0 };
      group.amount += amount;
      group.observations += 1;
      currencies.set(currency, group);
    }
  }
  return {
    observations: records.length,
    inputTokens: sum(records, 'inputTokens'),
    outputTokens: sum(records, 'outputTokens'),
    totalTokens: sum(records, 'totalTokens'),
    costs: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    confidence,
    lastObservedAt: records.at(-1)?.observedAt ?? null,
  };
}

function publicTarget(target: UsageTarget) {
  return { provider: target.provider.slice(0, 100), instance: target.instance.slice(0, 100), backend: target.backend };
}

/** A bounded, sanitized HTTP read model; never contains workspace paths or raw provider payloads. */
export function buildUsageSnapshot(input: {
  now: Date;
  epoch: string;
  startedAt: string;
  records: readonly RuntimeUsageRecord[];
  droppedRecords: number;
  quotaObservations: readonly UsageQuotaObservation[];
  droppedQuotaTargets: number;
  targets: readonly UsageTarget[];
  incidents: readonly RuntimeRateLimitIncident[];
  guardrails: readonly RuntimeGuardrailResult[];
}) {
  const targets = new Map<string, UsageTarget>();
  for (const target of [...input.targets, ...input.records, ...input.quotaObservations]) {
    targets.set(usageTargetKey(target), target);
  }
  const observations = new Map(input.quotaObservations.map((entry) => [usageTargetKey(entry), entry]));
  const groupedRecords = new Map<string, RuntimeUsageRecord[]>();
  const groupedSessions = new Map<string, RuntimeUsageRecord[]>();
  for (const record of input.records) {
    const key = usageTargetKey(record);
    const records = groupedRecords.get(key) ?? [];
    records.push(record);
    groupedRecords.set(key, records);
    if (record.sessionId) {
      const sessionKey = JSON.stringify([key, record.sessionId]);
      const session = groupedSessions.get(sessionKey) ?? [];
      session.push(record);
      groupedSessions.set(sessionKey, session);
    }
  }
  const safeGuardrails = input.guardrails.slice(0, 100).map((guardrail) => ({
    outcome: guardrail.outcome,
    scope: guardrail.scope,
    provider: guardrail.provider?.slice(0, 100) ?? null,
    instance: guardrail.instance?.slice(0, 100) ?? null,
    backend: guardrail.backend ?? null,
    sessionId: guardrail.sessionId?.slice(0, 200) ?? null,
    observedAt: guardrail.observedAt,
    cooldownUntil: guardrail.cooldownUntil ?? null,
  }));
  return {
    schemaVersion: 1 as const,
    generatedAt: input.now.toISOString(),
    runtime: { status: 'available' as const, epoch: input.epoch },
    coverage: {
      mode: 'memory' as const,
      scope: 'runtime_observed_results' as const,
      startedAt: input.startedAt,
      firstRetainedAt: input.records[0]?.observedAt ?? null,
      lastObservedAt: input.records.at(-1)?.observedAt ?? null,
      retainedRecords: input.records.length,
      droppedRecords: input.droppedRecords,
      droppedQuotaTargets: input.droppedQuotaTargets,
      targetCount: targets.size,
      sessionCount: groupedSessions.size,
      truncated: input.droppedRecords > 0 || input.droppedQuotaTargets > 0 || targets.size > 200 || groupedSessions.size > 200,
      historyAvailable: false as const,
    },
    totals: usageTotals(input.records),
    targets: [...targets.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 200).map(([key, target]) => {
      const observation = observations.get(key);
      const quota = normalizeUsageQuota(observation, input.now);
      if (!observation && (target.provider === 'claude' || target.provider === 'codex')) quota.status = 'unavailable';
      return {
        ...publicTarget(target),
        usage: usageTotals(groupedRecords.get(key) ?? []),
        quota,
        guardrails: safeGuardrails.filter((entry) => entry.provider === target.provider
          && entry.instance === target.instance && entry.backend === target.backend),
      };
    }),
    sessions: [...groupedSessions.values()].slice(-200).map((records) => ({
      ...publicTarget(records[0]!),
      sessionId: records[0]!.sessionId!.slice(0, 200),
      usage: usageTotals(records),
    })),
    incidents: input.incidents.slice(-20).reverse().map((incident) => ({
      id: incident.id,
      ...publicTarget(incident),
      classification: incident.classification,
      scope: incident.scope,
      observedAt: incident.observedAt,
      retryAt: incident.retryAt ?? null,
    })),
    guardrails: safeGuardrails,
  };
}

export type RuntimeUsageSnapshot = ReturnType<typeof buildUsageSnapshot>;
