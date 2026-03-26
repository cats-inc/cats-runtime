import type { StreamEvent } from '../types.js';

export const PROVIDER_EVOLUTION_EVIDENCE_SCHEMA_VERSION = 1;

export type ProviderEvolutionObservationKind =
  | 'normalized'
  | 'ignored'
  | 'unknown'
  | 'schema_failure'
  | 'raw_passthrough';

export type ProviderEvolutionTransport = 'cli' | 'agent' | 'api' | 'unknown';

export interface ProviderEvolutionEvidenceIdentity {
  provider: string;
  instance: string;
  parserId: string;
  probeProfile: string;
  transport?: ProviderEvolutionTransport;
  version?: string;
}

export interface ProviderEvolutionObservationInput {
  rawEventType?: string;
  reason?: string;
  details?: Record<string, unknown>;
  rawSample?: unknown;
  observedAt?: string;
}

export interface ProviderEvolutionNormalizedObservationInput
  extends ProviderEvolutionObservationInput {
  events: StreamEvent | StreamEvent[];
}

export interface ProviderEvolutionRawSample {
  kind: Exclude<ProviderEvolutionObservationKind, 'normalized'>;
  observedAt: string;
  rawEventType?: string;
  reason?: string;
  details?: Record<string, unknown>;
  rawSample?: unknown;
}

export interface ProviderEvolutionNormalizedSample {
  observedAt: string;
  rawEventType?: string;
  eventTypes: StreamEvent['type'][];
  details?: Record<string, unknown>;
  rawSample?: unknown;
}

export interface ProviderEvolutionEvidenceBundle {
  schemaVersion: typeof PROVIDER_EVOLUTION_EVIDENCE_SCHEMA_VERSION;
  provider: string;
  instance: string;
  parserId: string;
  probeProfile: string;
  transport: ProviderEvolutionTransport;
  version?: string;
  capturedAt: string;
  lastObservedAt?: string;
  rawSamples: ProviderEvolutionRawSample[];
  normalizedSamples: ProviderEvolutionNormalizedSample[];
  summary: {
    normalizedCount: number;
    ignoredCount: number;
    unknownCount: number;
    schemaFailureCount: number;
    rawPassthroughCount: number;
    normalizedEventTypes: Record<string, number>;
    ignoredEventTypes: Record<string, number>;
    unknownEventTypes: Record<string, number>;
    schemaFailureCounts: Record<string, number>;
    rawPassthroughEventTypes: Record<string, number>;
  };
}

export interface ProviderEvolutionEvidenceCollectorOptions {
  now?: () => number;
  maxRawSamples?: number;
  maxNormalizedSamples?: number;
}

export interface ProviderEvolutionEvidenceObserver {
  recordNormalized(input: ProviderEvolutionNormalizedObservationInput): void;
  recordIgnored(input: ProviderEvolutionObservationInput): void;
  recordUnknown(input: ProviderEvolutionObservationInput): void;
  recordSchemaFailure(input: ProviderEvolutionObservationInput): void;
  recordRawPassthrough(input: ProviderEvolutionObservationInput): void;
}

export class ProviderEvolutionEvidenceCollector
  implements ProviderEvolutionEvidenceObserver {
  private readonly now: () => number;
  private readonly maxRawSamples: number;
  private readonly maxNormalizedSamples: number;
  private readonly capturedAt: string;
  private lastObservedAt: string | undefined;
  private readonly rawSamples: ProviderEvolutionRawSample[] = [];
  private readonly normalizedSamples: ProviderEvolutionNormalizedSample[] = [];
  private readonly summary = {
    normalizedCount: 0,
    ignoredCount: 0,
    unknownCount: 0,
    schemaFailureCount: 0,
    rawPassthroughCount: 0,
    normalizedEventTypes: {} as Record<string, number>,
    ignoredEventTypes: {} as Record<string, number>,
    unknownEventTypes: {} as Record<string, number>,
    schemaFailureCounts: {} as Record<string, number>,
    rawPassthroughEventTypes: {} as Record<string, number>,
  };

  constructor(
    private readonly identity: ProviderEvolutionEvidenceIdentity,
    options: ProviderEvolutionEvidenceCollectorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.maxRawSamples = Math.max(0, options.maxRawSamples ?? 25);
    this.maxNormalizedSamples = Math.max(0, options.maxNormalizedSamples ?? 25);
    this.capturedAt = new Date(this.now()).toISOString();
  }

  recordNormalized(input: ProviderEvolutionNormalizedObservationInput): void {
    const observedAt = this.resolveObservedAt(input.observedAt);
    const eventTypes = toEventTypes(input.events);
    this.summary.normalizedCount += 1;
    for (const eventType of eventTypes) {
      incrementCounter(this.summary.normalizedEventTypes, eventType);
    }
    this.pushNormalizedSample({
      observedAt,
      rawEventType: input.rawEventType,
      eventTypes,
      details: cloneDetails(input.details),
      rawSample: normalizeSample(input.rawSample),
    });
  }

  recordIgnored(input: ProviderEvolutionObservationInput): void {
    const observedAt = this.resolveObservedAt(input.observedAt);
    this.summary.ignoredCount += 1;
    incrementCounter(
      this.summary.ignoredEventTypes,
      input.rawEventType || input.reason || 'unknown',
    );
    this.pushRawSample('ignored', observedAt, input);
  }

  recordUnknown(input: ProviderEvolutionObservationInput): void {
    const observedAt = this.resolveObservedAt(input.observedAt);
    this.summary.unknownCount += 1;
    incrementCounter(
      this.summary.unknownEventTypes,
      input.rawEventType || input.reason || 'unknown',
    );
    this.pushRawSample('unknown', observedAt, input);
  }

  recordSchemaFailure(input: ProviderEvolutionObservationInput): void {
    const observedAt = this.resolveObservedAt(input.observedAt);
    this.summary.schemaFailureCount += 1;
    incrementCounter(
      this.summary.schemaFailureCounts,
      input.rawEventType || input.reason || 'unknown',
    );
    this.pushRawSample('schema_failure', observedAt, input);
  }

  recordRawPassthrough(input: ProviderEvolutionObservationInput): void {
    const observedAt = this.resolveObservedAt(input.observedAt);
    this.summary.rawPassthroughCount += 1;
    incrementCounter(
      this.summary.rawPassthroughEventTypes,
      input.rawEventType || input.reason || 'unknown',
    );
    this.pushRawSample('raw_passthrough', observedAt, input);
  }

  finalize(): ProviderEvolutionEvidenceBundle {
    return {
      schemaVersion: PROVIDER_EVOLUTION_EVIDENCE_SCHEMA_VERSION,
      provider: this.identity.provider,
      instance: this.identity.instance,
      parserId: this.identity.parserId,
      probeProfile: this.identity.probeProfile,
      transport: this.identity.transport ?? 'unknown',
      version: this.identity.version,
      capturedAt: this.capturedAt,
      lastObservedAt: this.lastObservedAt,
      rawSamples: [...this.rawSamples],
      normalizedSamples: [...this.normalizedSamples],
      summary: {
        normalizedCount: this.summary.normalizedCount,
        ignoredCount: this.summary.ignoredCount,
        unknownCount: this.summary.unknownCount,
        schemaFailureCount: this.summary.schemaFailureCount,
        rawPassthroughCount: this.summary.rawPassthroughCount,
        normalizedEventTypes: { ...this.summary.normalizedEventTypes },
        ignoredEventTypes: { ...this.summary.ignoredEventTypes },
        unknownEventTypes: { ...this.summary.unknownEventTypes },
        schemaFailureCounts: { ...this.summary.schemaFailureCounts },
        rawPassthroughEventTypes: { ...this.summary.rawPassthroughEventTypes },
      },
    };
  }

  private resolveObservedAt(input: string | undefined): string {
    const observedAt = input || new Date(this.now()).toISOString();
    this.lastObservedAt = observedAt;
    return observedAt;
  }

  private pushRawSample(
    kind: ProviderEvolutionRawSample['kind'],
    observedAt: string,
    input: ProviderEvolutionObservationInput,
  ): void {
    if (this.maxRawSamples === 0 || this.rawSamples.length >= this.maxRawSamples) {
      return;
    }

    this.rawSamples.push({
      kind,
      observedAt,
      rawEventType: input.rawEventType,
      reason: input.reason,
      details: cloneDetails(input.details),
      rawSample: normalizeSample(input.rawSample),
    });
  }

  private pushNormalizedSample(sample: ProviderEvolutionNormalizedSample): void {
    if (
      this.maxNormalizedSamples === 0
      || this.normalizedSamples.length >= this.maxNormalizedSamples
    ) {
      return;
    }

    this.normalizedSamples.push(sample);
  }
}

export function observeNormalized<T extends StreamEvent | StreamEvent[]>(
  observer: ProviderEvolutionEvidenceObserver | undefined,
  input: Omit<ProviderEvolutionNormalizedObservationInput, 'events'>,
  value: T,
): T {
  observer?.recordNormalized({
    ...input,
    events: value,
  });
  return value;
}

export function observeIgnored<T>(
  observer: ProviderEvolutionEvidenceObserver | undefined,
  input: ProviderEvolutionObservationInput,
  value: T,
): T {
  observer?.recordIgnored(input);
  return value;
}

export function observeUnknown<T>(
  observer: ProviderEvolutionEvidenceObserver | undefined,
  input: ProviderEvolutionObservationInput,
  value: T,
): T {
  observer?.recordUnknown(input);
  return value;
}

export function observeSchemaFailure<T>(
  observer: ProviderEvolutionEvidenceObserver | undefined,
  input: ProviderEvolutionObservationInput,
  value: T,
): T {
  observer?.recordSchemaFailure(input);
  return value;
}

export function observeRawPassthrough<T>(
  observer: ProviderEvolutionEvidenceObserver | undefined,
  input: ProviderEvolutionObservationInput,
  value: T,
): T {
  observer?.recordRawPassthrough(input);
  return value;
}

function toEventTypes(events: StreamEvent | StreamEvent[]): StreamEvent['type'][] {
  const list = Array.isArray(events) ? events : [events];
  return list.map((event) => event.type);
}

function incrementCounter(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function cloneDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }
  return normalizeSample(details) as Record<string, unknown>;
}

function normalizeSample(value: unknown, depth = 0): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }

  if (depth >= 4) {
    return '[truncated]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => normalizeSample(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(0, 20)) {
      const normalized = normalizeSample(entry, depth + 1);
      if (normalized !== undefined) {
        output[key] = normalized;
      }
    }
    return output;
  }

  return String(value);
}
