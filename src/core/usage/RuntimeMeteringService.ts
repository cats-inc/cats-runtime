import { randomUUID } from 'node:crypto';
import type {
  ProviderBackend,
  RuntimeGuardrailResult,
  RuntimeMeteringSnapshot,
  RuntimeMeteringSummary,
  RuntimeRateLimitIncident,
  RuntimeSessionMeteringSnapshot,
  RuntimeUsageAggregate,
  RuntimeUsageGuardrail,
  RuntimeUsageRecord,
  RuntimeUsageSignal,
  RuntimeUsageSourceConfidence,
  RuntimeUsageTotals,
  SessionInfo,
  StreamEvent,
} from '../types.js';
import { createRuntimeProgressEvent } from '../progress.js';
import {
  detectRuntimeIncident,
  deriveGuardrailFromIncident,
  isGuardrailActive,
  providerGuardrailKey,
} from './incidentDetection.js';
import { asRecord, readNumber, readString } from './utils.js';

const MAX_USAGE_RECORDS = 1000;
const MAX_INCIDENTS = 100;

interface RuntimeMeteringOptions {
  sessionTotalTokensWarn?: number;
  sessionTotalTokensBlock?: number;
  rateLimitCooldownMs?: number;
}

interface ObserveEventOptions {
  turnStartedAt: number;
  observedAt?: string;
}

export interface RuntimeProviderTargetMeteringSnapshot {
  target: {
    provider: string;
    instance: string;
    backend: ProviderBackend;
  };
  summary: RuntimeMeteringSummary;
  recentIncidents: RuntimeRateLimitIncident[];
  activeGuardrails: RuntimeGuardrailResult[];
}

export class RuntimeMeteringService {
  private readonly usageRecords: RuntimeUsageRecord[] = [];
  private readonly incidents: RuntimeRateLimitIncident[] = [];
  private readonly providerGuardrails = new Map<string, RuntimeGuardrailResult>();

  constructor(private readonly options: RuntimeMeteringOptions = {}) {}

  getConfiguredGuardrails(): RuntimeUsageGuardrail[] {
    const guardrails: RuntimeUsageGuardrail[] = [];
    if (typeof this.options.sessionTotalTokensWarn === 'number') {
      guardrails.push({
        scope: 'session',
        metric: 'total_tokens',
        threshold: this.options.sessionTotalTokensWarn,
        action: 'warn',
      });
    }
    if (typeof this.options.sessionTotalTokensBlock === 'number') {
      guardrails.push({
        scope: 'session',
        metric: 'total_tokens',
        threshold: this.options.sessionTotalTokensBlock,
        action: 'block',
      });
    }
    if ((this.options.rateLimitCooldownMs ?? 0) > 0) {
      guardrails.push({
        scope: 'provider_instance',
        metric: 'rate_limit_incidents',
        threshold: 1,
        action: 'cooldown',
        cooldownMs: this.options.rateLimitCooldownMs,
      });
    }
    return guardrails;
  }

  evaluatePreflight(session: SessionInfo): RuntimeGuardrailResult {
    this.evictExpiredGuardrails();

    const providerKey = providerGuardrailKey(
      session.providerName,
      session.providerInstanceId || 'default',
      session.providerBackend || 'cli',
    );
    const providerGuardrail = this.providerGuardrails.get(providerKey);
    if (providerGuardrail && isGuardrailActive(providerGuardrail)) {
      return providerGuardrail;
    }

    const totalTokens = session.totalInputTokens + session.totalOutputTokens;
    const observedAt = new Date().toISOString();

    if (
      typeof this.options.sessionTotalTokensBlock === 'number'
      && totalTokens >= this.options.sessionTotalTokensBlock
    ) {
      return {
        outcome: 'blocked',
        scope: 'session',
        metric: 'total_tokens',
        action: 'block',
        provider: session.providerName,
        instance: session.providerInstanceId || 'default',
        backend: session.providerBackend || 'cli',
        sessionId: session.id,
        threshold: this.options.sessionTotalTokensBlock,
        currentValue: totalTokens,
        observedAt,
        reason: `Session '${session.id}' exceeded the configured token hard limit.`,
      };
    }

    if (
      typeof this.options.sessionTotalTokensWarn === 'number'
      && totalTokens >= this.options.sessionTotalTokensWarn
    ) {
      return {
        outcome: 'warned',
        scope: 'session',
        metric: 'total_tokens',
        action: 'warn',
        provider: session.providerName,
        instance: session.providerInstanceId || 'default',
        backend: session.providerBackend || 'cli',
        sessionId: session.id,
        threshold: this.options.sessionTotalTokensWarn,
        currentValue: totalTokens,
        observedAt,
        reason: `Session '${session.id}' crossed the configured token warning threshold.`,
      };
    }

    return {
      outcome: 'allowed',
      scope: 'session',
      metric: 'total_tokens',
      action: 'warn',
      provider: session.providerName,
      instance: session.providerInstanceId || 'default',
      backend: session.providerBackend || 'cli',
      sessionId: session.id,
      currentValue: totalTokens,
      observedAt,
      reason: 'No metering guardrails are currently blocking execution.',
    };
  }

  createWarningProgressEvent(
    session: SessionInfo,
    guardrail: RuntimeGuardrailResult,
  ): StreamEvent {
    return createRuntimeProgressEvent({
      text: guardrail.reason,
      sessionId: session.id,
      providerSessionId: session.providerSessionId,
      provider: session.providerName,
      backend: session.providerBackend || 'cli',
      instance: session.providerInstanceId || 'default',
      kind: 'guardrail',
      status: 'warned',
      source: 'runtime',
      guardrail,
    });
  }

  observeEvent(
    session: SessionInfo,
    event: StreamEvent,
    options: ObserveEventOptions,
  ): StreamEvent {
    const observedAt = options.observedAt ?? new Date().toISOString();
    let nextEvent = this.ensureProgressContext(session, event);

    if (nextEvent.type === 'result') {
      const usageRecord = this.buildUsageRecord(session, nextEvent, {
        turnStartedAt: options.turnStartedAt,
        observedAt,
      });
      if (usageRecord) {
        this.pushUsageRecord(usageRecord);
        nextEvent = mergeEventMetadata(nextEvent, {
          runtimeUsage: summarizeUsageRecord(usageRecord),
        });
      }
    }

    if (nextEvent.type === 'error') {
      const incident = detectRuntimeIncident({
        provider: session.providerName,
        instance: session.providerInstanceId || 'default',
        backend: session.providerBackend || 'cli',
        sessionId: session.id,
        providerSessionId: session.providerSessionId,
        workspaceKey: workspaceKeyForSession(session),
        errorText: nextEvent.text,
        observedAt,
        metadata: nextEvent.metadata,
      });

      if (incident) {
        this.pushIncident(incident);
        const guardrail = deriveGuardrailFromIncident(incident, {
          fallbackCooldownMs: this.options.rateLimitCooldownMs,
        });
        this.rememberProviderGuardrail(guardrail);
        nextEvent = mergeEventMetadata(nextEvent, {
          incident,
          guardrail,
        });
      }
    }

    return nextEvent;
  }

  buildSnapshot(
    sessions: SessionInfo[],
  ): RuntimeMeteringSnapshot {
    this.evictExpiredGuardrails();
    const activeSessionGuardrails = sessions
      .map((session) => this.evaluatePreflight(session))
      .filter((guardrail) => guardrail.outcome === 'warned' || guardrail.outcome === 'blocked');
    const activeProviderGuardrails = Array.from(this.providerGuardrails.values())
      .filter((guardrail) => isGuardrailActive(guardrail));
    const activeGuardrails = [...activeProviderGuardrails, ...activeSessionGuardrails];
    const byProviderInstance = aggregateUsageRecords(
      this.usageRecords,
      (record) => `${record.backend}:${record.provider}:${record.instance}`,
      (record) => ({
        provider: record.provider,
        instance: record.instance,
        backend: record.backend,
      }),
    );
    const bySession = aggregateUsageRecords(
      this.usageRecords.filter((record) => Boolean(record.sessionId)),
      (record) => `${record.backend}:${record.provider}:${record.instance}:${record.sessionId}`,
      (record) => ({
        provider: record.provider,
        instance: record.instance,
        backend: record.backend,
        sessionId: record.sessionId,
        workspaceKey: record.workspaceKey,
      }),
    );
    const totals = aggregateUsageTotals(this.usageRecords);
    const summary = buildSummary(
      this.usageRecords.length,
      this.incidents.length,
      activeGuardrails,
    );

    return {
      summary,
      usage: {
        totals,
        byProviderInstance,
        bySession,
      },
      incidents: {
        recent: [...this.incidents].slice(-10).reverse(),
        active: activeProviderGuardrails,
      },
      guardrails: {
        configured: this.getConfiguredGuardrails(),
        active: activeGuardrails,
      },
    };
  }

  buildSummary(sessions: SessionInfo[]): RuntimeMeteringSummary {
    return this.buildSnapshot(sessions).summary;
  }

  buildSessionSnapshot(session: SessionInfo): RuntimeSessionMeteringSnapshot {
    this.evictExpiredGuardrails();

    const provider = session.providerName;
    const instance = session.providerInstanceId || 'default';
    const backend = session.providerBackend || 'cli';
    const preflight = this.evaluatePreflight(session);
    const activeGuardrails = [
      ...Array.from(this.providerGuardrails.values()).filter((guardrail) =>
        isGuardrailActive(guardrail)
        && guardrail.provider === provider
        && guardrail.instance === instance
        && guardrail.backend === backend,
      ),
      ...(preflight.outcome === 'warned' || preflight.outcome === 'blocked' ? [preflight] : []),
    ];
    const usage = aggregateUsageRecords(
      this.usageRecords.filter((record) => record.sessionId === session.id),
      () => session.id,
      (record) => ({
        provider: record.provider,
        instance: record.instance,
        backend: record.backend,
        sessionId: record.sessionId,
        workspaceKey: record.workspaceKey,
      }),
    ).at(0);
    const recentIncidents = [...this.incidents]
      .filter((incident) =>
        incident.sessionId === session.id
        || (
          incident.provider === provider
          && incident.instance === instance
          && incident.backend === backend
        ),
      )
      .slice(-10)
      .reverse();

    return {
      usage,
      preflight,
      activeGuardrails,
      recentIncidents,
    };
  }

  buildProviderTargetSnapshot(target: {
    provider: string;
    instance: string;
    backend: ProviderBackend;
  }): RuntimeProviderTargetMeteringSnapshot {
    this.evictExpiredGuardrails();

    const activeGuardrails = Array.from(this.providerGuardrails.values()).filter((guardrail) =>
      isGuardrailActive(guardrail)
      && guardrail.provider === target.provider
      && guardrail.instance === target.instance
      && guardrail.backend === target.backend,
    );
    const recentIncidents = [...this.incidents]
      .filter((incident) =>
        incident.provider === target.provider
        && incident.instance === target.instance
        && incident.backend === target.backend,
      )
      .slice(-10)
      .reverse();

    return {
      target,
      summary: buildSummary(0, recentIncidents.length, activeGuardrails),
      recentIncidents,
      activeGuardrails,
    };
  }

  private buildUsageRecord(
    session: SessionInfo,
    event: StreamEvent,
    options: {
      turnStartedAt: number;
      observedAt: string;
    },
  ): RuntimeUsageRecord | undefined {
    const signal = extractRuntimeUsageSignal(session, event, options);
    const inputTokens = event.usage?.inputTokens;
    const outputTokens = event.usage?.outputTokens;
    const hasUsage = Boolean(
      (typeof inputTokens === 'number' && inputTokens > 0)
      || (typeof outputTokens === 'number' && outputTokens > 0)
      || (typeof signal.totalTokens === 'number' && signal.totalTokens > 0)
      || signal.estimatedCost !== undefined,
    );

    if (!hasUsage) {
      return undefined;
    }

    return {
      id: randomUUID(),
      provider: session.providerName,
      instance: session.providerInstanceId || 'default',
      backend: session.providerBackend || 'cli',
      sessionId: session.id,
      providerSessionId: event.providerSessionId || session.providerSessionId,
      workspaceKey: workspaceKeyForSession(session),
      observedAt: options.observedAt,
      inputTokens,
      outputTokens,
      totalTokens: signal.totalTokens,
      estimatedCost: signal.estimatedCost,
      currency: signal.currency,
      latencyMs: signal.latencyMs,
      sourceConfidence: signal.sourceConfidence ?? 'unknown',
      quota: signal.quota,
    };
  }

  private rememberProviderGuardrail(guardrail: RuntimeGuardrailResult): void {
    if (!guardrail.provider || !guardrail.instance || !guardrail.backend) {
      return;
    }

    this.providerGuardrails.set(
      providerGuardrailKey(guardrail.provider, guardrail.instance, guardrail.backend),
      guardrail,
    );
  }

  private evictExpiredGuardrails(): void {
    const now = Date.now();
    for (const [key, guardrail] of this.providerGuardrails.entries()) {
      if (!isGuardrailActive(guardrail, now)) {
        this.providerGuardrails.delete(key);
      }
    }
  }

  private ensureProgressContext(
    session: SessionInfo,
    event: StreamEvent,
  ): StreamEvent {
    if (event.type !== 'progress') {
      return event;
    }

    return mergeEventMetadata(event, {
      provider: session.providerName,
      backend: session.providerBackend || 'cli',
      instance: session.providerInstanceId || 'default',
    });
  }

  private pushUsageRecord(record: RuntimeUsageRecord): void {
    this.usageRecords.push(record);
    if (this.usageRecords.length > MAX_USAGE_RECORDS) {
      this.usageRecords.splice(0, this.usageRecords.length - MAX_USAGE_RECORDS);
    }
  }

  private pushIncident(incident: RuntimeRateLimitIncident): void {
    this.incidents.push(incident);
    if (this.incidents.length > MAX_INCIDENTS) {
      this.incidents.splice(0, this.incidents.length - MAX_INCIDENTS);
    }
  }
}

function extractRuntimeUsageSignal(
  session: SessionInfo,
  event: StreamEvent,
  options: {
    turnStartedAt: number;
    observedAt: string;
  },
): RuntimeUsageSignal {
  const metadata = asRecord(event.metadata);
  const runtimeUsage = asRecord(metadata?.runtimeUsage);
  const inputTokens = event.usage?.inputTokens;
  const outputTokens = event.usage?.outputTokens;
  const totalTokens = readNumber(runtimeUsage?.totalTokens)
    ?? event.usage?.totalTokens
    ?? sumTokens(inputTokens, outputTokens);

  return {
    totalTokens,
    estimatedCost: readNumber(runtimeUsage?.estimatedCost) ?? event.usage?.estimatedCost,
    currency: readString(runtimeUsage?.currency) ?? event.usage?.currency,
    latencyMs: readNumber(runtimeUsage?.latencyMs)
      ?? event.usage?.latencyMs
      ?? Math.max(0, Date.parse(options.observedAt) - options.turnStartedAt),
    sourceConfidence: readConfidence(runtimeUsage?.sourceConfidence)
      ?? event.usage?.sourceConfidence
      ?? defaultSourceConfidence(session),
    quota: readQuota(asRecord(runtimeUsage?.quota)),
  };
}

function summarizeUsageRecord(record: RuntimeUsageRecord): RuntimeUsageSignal {
  return {
    totalTokens: record.totalTokens,
    estimatedCost: record.estimatedCost,
    currency: record.currency,
    latencyMs: record.latencyMs,
    sourceConfidence: record.sourceConfidence,
    quota: record.quota,
  };
}

function aggregateUsageTotals(records: RuntimeUsageRecord[]): RuntimeUsageTotals {
  const totals: RuntimeUsageTotals = {
    observationCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    confidenceCounts: createConfidenceCounts(),
  };

  for (const record of records) {
    applyUsageRecordToAggregate(totals, record);
  }

  return totals;
}

function aggregateUsageRecords<T extends RuntimeUsageAggregate>(
  records: RuntimeUsageRecord[],
  keyOf: (record: RuntimeUsageRecord) => string,
  seed: (record: RuntimeUsageRecord) => Omit<T, keyof RuntimeUsageTotals>,
): T[] {
  const aggregated = new Map<string, T>();

  for (const record of records) {
    const key = keyOf(record);
    let target = aggregated.get(key);
    if (!target) {
      target = {
        ...seed(record),
        observationCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        confidenceCounts: createConfidenceCounts(),
      } as T;
      aggregated.set(key, target);
    }

    applyUsageRecordToAggregate(target, record);
  }

  return Array.from(aggregated.values()).sort((left, right) =>
    (right.totalTokens ?? 0) - (left.totalTokens ?? 0),
  );
}

function applyUsageRecordToAggregate(
  aggregate: RuntimeUsageTotals,
  record: RuntimeUsageRecord,
): void {
  aggregate.observationCount += 1;
  aggregate.inputTokens += record.inputTokens ?? 0;
  aggregate.outputTokens += record.outputTokens ?? 0;
  aggregate.totalTokens = (aggregate.totalTokens ?? 0) + (record.totalTokens ?? 0);
  if (record.estimatedCost !== undefined) {
    aggregate.estimatedCost = (aggregate.estimatedCost ?? 0) + record.estimatedCost;
  }
  aggregate.currency = aggregate.currency ?? record.currency;
  aggregate.lastObservedAt = record.observedAt;
  const confidence = record.sourceConfidence ?? 'unknown';
  aggregate.confidenceCounts[confidence] += 1;

  if (record.latencyMs !== undefined) {
    aggregate.latencyMs = aggregate.latencyMs === undefined
      ? record.latencyMs
      : Math.max(aggregate.latencyMs, record.latencyMs);
  }
}

function buildSummary(
  usageRecords: number,
  incidents: number,
  activeGuardrails: RuntimeGuardrailResult[],
): RuntimeMeteringSummary {
  const activeCooldowns = activeGuardrails.filter((guardrail) => guardrail.outcome === 'cooldown').length;
  const activeBlocks = activeGuardrails.filter((guardrail) => guardrail.outcome === 'blocked').length;
  const degraded = incidents > 0 || activeGuardrails.length > 0;

  return {
    status: degraded ? 'degraded' : 'ok',
    summary: degraded
      ? `${incidents} incident(s), ${activeCooldowns} cooldown(s), ${activeBlocks} block(s).`
      : 'No active metering incidents or guardrails.',
    usageRecords,
    incidents,
    activeGuardrails: activeGuardrails.length,
    activeCooldowns,
    activeBlocks,
  };
}

function defaultSourceConfidence(session: SessionInfo): RuntimeUsageSourceConfidence {
  if (session.providerName === 'goose') {
    return 'estimated';
  }
  if (session.providerName === 'junie' || session.providerBackend === 'api') {
    return 'aggregated';
  }
  if (session.providerBackend === 'agent') {
    return 'aggregated';
  }
  return 'reported';
}

function workspaceKeyForSession(session: SessionInfo): string {
  const normalized = session.cwd.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) {
    return normalized.toLowerCase();
  }
  return normalized;
}

function mergeEventMetadata(
  event: StreamEvent,
  patch: Record<string, unknown>,
): StreamEvent {
  return {
    ...event,
    metadata: {
      ...(event.metadata ?? {}),
      ...patch,
    },
  };
}

function createConfidenceCounts(): Record<RuntimeUsageSourceConfidence, number> {
  return {
    reported: 0,
    aggregated: 0,
    estimated: 0,
    unknown: 0,
  };
}

function sumTokens(
  inputTokens?: number,
  outputTokens?: number,
): number | undefined {
  if (typeof inputTokens !== 'number' && typeof outputTokens !== 'number') {
    return undefined;
  }

  return (inputTokens ?? 0) + (outputTokens ?? 0);
}

function readConfidence(value: unknown): RuntimeUsageSourceConfidence | undefined {
  switch (value) {
    case 'reported':
    case 'aggregated':
    case 'estimated':
    case 'unknown':
      return value;
    default:
      return undefined;
  }
}

function readQuota(
  value: Record<string, unknown> | null,
): Record<string, string | number | boolean> | undefined {
  if (!value) {
    return undefined;
  }

  const quota = Object.fromEntries(
    Object.entries(value).filter(([, entry]) =>
      typeof entry === 'string'
      || typeof entry === 'number'
      || typeof entry === 'boolean',
    ),
  ) as Record<string, string | number | boolean>;

  return Object.keys(quota).length > 0 ? quota : undefined;
}
