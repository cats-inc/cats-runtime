import { randomUUID } from 'node:crypto';
import type {
  ProviderBackend,
  RuntimeGuardrailResult,
  RuntimeIncidentClassification,
  RuntimeIncidentScope,
  RuntimeRateLimitIncident,
} from '../types.js';
import { asRecord, readPositiveNumber, readString } from './utils.js';

interface DetectRuntimeIncidentInput {
  provider: string;
  instance: string;
  backend: ProviderBackend;
  sessionId?: string;
  providerSessionId?: string;
  workspaceKey?: string;
  errorText?: string;
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

interface IncidentHint {
  classification?: RuntimeIncidentClassification;
  retryAfterMs?: number;
  statusCode?: number;
  evidenceSummary?: string;
  scope?: RuntimeIncidentScope;
  metadata?: Record<string, unknown>;
}

export function providerGuardrailKey(
  provider: string,
  instance: string,
  backend: ProviderBackend,
): string {
  return `${backend}:${provider}:${instance}`;
}

export function detectRuntimeIncident(
  input: DetectRuntimeIncidentInput,
): RuntimeRateLimitIncident | undefined {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const metadata = asRecord(input.metadata);
  const incidentHint = readIncidentHint(metadata);
  const errorText = readString(input.errorText) ?? readString(incidentHint?.evidenceSummary) ?? '';
  const statusCode = incidentHint?.statusCode ?? readPositiveNumber(asRecord(metadata?.incidentHint)?.statusCode);
  const classification = incidentHint?.classification
    ?? inferClassification(errorText, statusCode);

  if (!classification) {
    return undefined;
  }

  const retryAfterMs = incidentHint?.retryAfterMs
    ?? readPositiveNumber(asRecord(metadata?.incidentHint)?.retryAfterMs)
    ?? parseRetryAfterMs(errorText);

  return {
    id: randomUUID(),
    provider: input.provider,
    instance: input.instance,
    backend: input.backend,
    sessionId: input.sessionId,
    providerSessionId: input.providerSessionId,
    workspaceKey: input.workspaceKey,
    classification,
    scope: incidentHint?.scope ?? inferScope(),
    observedAt,
    retryAfterMs,
    retryAt: retryAfterMs ? new Date(Date.parse(observedAt) + retryAfterMs).toISOString() : undefined,
    evidenceSummary: errorText || incidentHint?.evidenceSummary,
    metadata: {
      ...(statusCode ? { statusCode } : {}),
      ...(incidentHint?.metadata ? { hint: incidentHint.metadata } : {}),
    },
  };
}

export function deriveGuardrailFromIncident(
  incident: RuntimeRateLimitIncident,
  options: {
    fallbackCooldownMs?: number;
  } = {},
): RuntimeGuardrailResult {
  const observedAt = incident.observedAt;

  if (incident.classification === 'quota_exhausted') {
    return {
      outcome: 'blocked',
      scope: 'provider_instance',
      metric: 'rate_limit_incidents',
      action: 'block',
      provider: incident.provider,
      instance: incident.instance,
      backend: incident.backend,
      sessionId: incident.sessionId,
      workspaceKey: incident.workspaceKey,
      currentValue: 1,
      observedAt,
      reason: `Execution blocked because ${incident.provider}/${incident.instance} exhausted quota.`,
      incidentId: incident.id,
    };
  }

  const cooldownMs = incident.retryAfterMs ?? options.fallbackCooldownMs;
  return {
    outcome: 'cooldown',
    scope: 'provider_instance',
    metric: 'rate_limit_incidents',
    action: 'cooldown',
    provider: incident.provider,
    instance: incident.instance,
    backend: incident.backend,
    sessionId: incident.sessionId,
    workspaceKey: incident.workspaceKey,
    currentValue: 1,
    observedAt,
    reason: `Execution cooled down because ${incident.provider}/${incident.instance} hit ${incident.classification}.`,
    cooldownUntil: cooldownMs
      ? new Date(Date.parse(observedAt) + cooldownMs).toISOString()
      : undefined,
    incidentId: incident.id,
  };
}

export function isGuardrailActive(
  guardrail: RuntimeGuardrailResult,
  now = Date.now(),
): boolean {
  if (guardrail.outcome === 'blocked') {
    return true;
  }

  if (guardrail.outcome !== 'cooldown' || !guardrail.cooldownUntil) {
    return false;
  }

  const until = Date.parse(guardrail.cooldownUntil);
  return Number.isFinite(until) && until > now;
}

function inferClassification(
  errorText: string,
  statusCode?: number,
): RuntimeIncidentClassification | undefined {
  const normalized = errorText.toLowerCase();

  if (
    normalized.includes('insufficient_quota')
    || normalized.includes('quota')
    || normalized.includes('billing')
    || normalized.includes('credit balance')
    || normalized.includes('resource exhausted')
  ) {
    return 'quota_exhausted';
  }

  if (
    normalized.includes('concurrency')
    || normalized.includes('concurrent')
    || normalized.includes('already running')
    || normalized.includes('another request is active')
  ) {
    return 'concurrency_limited';
  }

  if (
    statusCode === 429
    || normalized.includes('rate limit')
    || normalized.includes('too many requests')
    || normalized.includes('retry after')
  ) {
    return 'rate_limited';
  }

  return undefined;
}

function inferScope(): RuntimeIncidentScope {
  // First slice only derives incidents at the provider-instance level.
  return 'provider_instance';
}

function parseRetryAfterMs(errorText: string): number | undefined {
  const normalized = errorText.toLowerCase();
  const millisecondMatch = normalized.match(/retry(?:ing)? after\s+(\d+)\s*ms/);
  if (millisecondMatch) {
    return Number.parseInt(millisecondMatch[1]!, 10);
  }

  const secondMatch = normalized.match(/retry(?:ing)? after\s+(\d+(?:\.\d+)?)\s*s/);
  if (secondMatch) {
    return Math.round(Number.parseFloat(secondMatch[1]!) * 1000);
  }

  const headerMatch = normalized.match(/retry-after[:= ]+(\d+)/);
  if (headerMatch) {
    return Number.parseInt(headerMatch[1]!, 10) * 1000;
  }

  return undefined;
}

function readIncidentHint(
  metadata: Record<string, unknown> | null,
): IncidentHint | undefined {
  const hintedIncident = asRecord(metadata?.incident);
  if (hintedIncident) {
    return {
      classification: readClassification(hintedIncident.classification),
      retryAfterMs: readPositiveNumber(hintedIncident.retryAfterMs),
      statusCode: readPositiveNumber(hintedIncident.statusCode),
      evidenceSummary: readString(hintedIncident.evidenceSummary),
      scope: readScope(hintedIncident.scope),
      metadata: asRecord(hintedIncident.metadata) ?? undefined,
    };
  }

  const hint = asRecord(metadata?.incidentHint);
  if (!hint) {
    return undefined;
  }

  return {
    classification: readClassification(hint.classification),
    retryAfterMs: readPositiveNumber(hint.retryAfterMs),
    statusCode: readPositiveNumber(hint.statusCode),
    evidenceSummary: readString(hint.evidenceSummary) ?? readString(hint.body),
    scope: readScope(hint.scope),
    metadata: hint,
  };
}

function readClassification(value: unknown): RuntimeIncidentClassification | undefined {
  switch (value) {
    case 'rate_limited':
    case 'quota_exhausted':
    case 'cooldown_active':
    case 'concurrency_limited':
      return value;
    default:
      return undefined;
  }
}

function readScope(value: unknown): RuntimeIncidentScope | undefined {
  switch (value) {
    case 'session':
    case 'provider_instance':
    case 'workspace':
    case 'runtime_global':
      return value;
    default:
      return undefined;
  }
}
