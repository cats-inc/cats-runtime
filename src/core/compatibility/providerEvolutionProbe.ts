import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeMode } from '../../backends/cli/config.js';
import type { ProviderEvolutionEvidenceObserver, ProviderEvolutionEvidenceBundle, ProviderEvolutionTransport } from './providerEvolution.js';
import { ProviderEvolutionEvidenceCollector } from './providerEvolution.js';
import {
  listProviderArtifactRelativePaths,
  pruneProviderArtifacts,
  sanitizeArtifactProviderSegment,
} from './retainedArtifacts.js';

export const PROVIDER_EVOLUTION_PROBE_ARTIFACT_SCHEMA_VERSION = 1;
export const DEFAULT_PROVIDER_EVOLUTION_PROBE_RETENTION_LIMIT = 50;

export interface ProviderEvolutionProbeTurn {
  id: string;
  prompt: string;
  summary: string;
}

export interface ProviderEvolutionProbeProfile {
  id: string;
  label: string;
  description: string;
  turns: ProviderEvolutionProbeTurn[];
}

export interface ProviderEvolutionCapabilitySignal {
  observed: boolean;
  count: number;
}

export interface ProviderEvolutionCapabilitySnapshot {
  incrementalText: ProviderEvolutionCapabilitySignal;
  toolUse: ProviderEvolutionCapabilitySignal;
  toolResult: ProviderEvolutionCapabilitySignal;
  progress: ProviderEvolutionCapabilitySignal;
  finalResult: ProviderEvolutionCapabilitySignal;
  ignoredEventTypes: string[];
  schemaFailures: Record<string, number>;
  observedEventTypes: string[];
  normalizedEventTypes: Record<string, number>;
  rawPassthroughEventTypes: string[];
  counters: {
    normalized: number;
    ignored: number;
    unknown: number;
    schemaFailure: number;
    rawPassthrough: number;
  };
}

export interface ProviderEvolutionFrequencyDrop {
  eventType: string;
  previousCount: number;
  currentCount: number;
}

export interface ProviderEvolutionSchemaChange {
  eventType: string;
  previousCount: number;
  currentCount: number;
}

export interface ProviderEvolutionBaselineCompare {
  baselineArtifactId: string;
  baselineCapturedAt: string;
  addedEventTypes: string[];
  removedEventTypes: string[];
  frequencyDrops: ProviderEvolutionFrequencyDrop[];
  schemaChanges: ProviderEvolutionSchemaChange[];
  semanticDriftSuspected: boolean;
  semanticDriftReasons: string[];
}

export type ProviderEvolutionReviewClassification =
  | 'baseline'
  | 'stable'
  | 'upgrade'
  | 'regression'
  | 'schema_change'
  | 'semantic_drift_suspected';

export type ProviderEvolutionExternalReferenceKind =
  | 'release_notes'
  | 'changelog'
  | 'issue'
  | 'announcement'
  | 'other';

export interface ProviderEvolutionExternalReference {
  kind: ProviderEvolutionExternalReferenceKind;
  url: string;
}

export interface ProviderEvolutionProbeReviewSummary {
  classifications: ProviderEvolutionReviewClassification[];
  summary: string;
  highlights: string[];
}

export interface ProviderEvolutionProbeReviewUpdate {
  classifications?: ProviderEvolutionReviewClassification[];
  summary?: string;
  highlights?: string[];
  references?: ProviderEvolutionExternalReference[];
}

export interface ProviderEvolutionProbeExecutionSummary {
  status: 'completed' | 'failed';
  durationMs: number;
  turnsPlanned: number;
  turnsCompleted: number;
  emittedEventCount?: number;
  error?: string;
}

export interface ProviderEvolutionProbeArtifact {
  schemaVersion: typeof PROVIDER_EVOLUTION_PROBE_ARTIFACT_SCHEMA_VERSION;
  id: string;
  provider: string;
  instance: string;
  parserId: string;
  probeProfile: string;
  transport: ProviderEvolutionTransport;
  runtimeMode?: RuntimeMode;
  version?: string;
  capturedAt: string;
  execution: ProviderEvolutionProbeExecutionSummary;
  capabilitySnapshot: ProviderEvolutionCapabilitySnapshot;
  compare?: ProviderEvolutionBaselineCompare;
  review: ProviderEvolutionProbeReviewSummary;
  reviewContext?: {
    references: ProviderEvolutionExternalReference[];
  };
  baseline?: {
    artifactId: string;
    capturedAt: string;
  };
  evidence: ProviderEvolutionEvidenceBundle;
}

export interface ProviderEvolutionProbeStoredArtifact {
  artifact: ProviderEvolutionProbeArtifact;
  relativePath: string;
  artifactPath: string;
}

export interface ProviderEvolutionProbeArtifactSummary {
  artifactId: string;
  provider: string;
  instance: string;
  parserId: string;
  probeProfile: string;
  transport: ProviderEvolutionTransport;
  runtimeMode?: RuntimeMode;
  version?: string;
  capturedAt: string;
  execution: ProviderEvolutionProbeExecutionSummary;
  capabilitySnapshot: ProviderEvolutionCapabilitySnapshot;
  compare?: {
    baselineArtifactId: string;
    baselineCapturedAt: string;
    addedEventTypeCount: number;
    removedEventTypeCount: number;
    frequencyDropCount: number;
    schemaChangeCount: number;
    semanticDriftSuspected: boolean;
  };
  review: ProviderEvolutionProbeReviewSummary;
  reviewContext?: {
    references: ProviderEvolutionExternalReference[];
  };
  relativePath: string;
  artifactPath: string;
}

export interface ProviderEvolutionProbeArtifactQuery {
  provider?: string;
  instance?: string;
  parserId?: string;
  probeProfile?: string;
  transport?: ProviderEvolutionTransport;
  runtimeMode?: RuntimeMode;
  reviewClassifications?: ProviderEvolutionReviewClassification[];
  limit?: number;
}

export interface ProviderEvolutionProbeRequest {
  target: {
    provider: string;
    instance: string;
    parserId: string;
    probeProfile: string;
    transport?: ProviderEvolutionTransport;
    runtimeMode?: RuntimeMode;
    version?: string;
  };
  reviewContext?: {
    references?: ProviderEvolutionExternalReference[];
  };
  profile: ProviderEvolutionProbeProfile;
  run: (input: {
    profile: ProviderEvolutionProbeProfile;
    observer: ProviderEvolutionEvidenceObserver;
  }) => Promise<Omit<ProviderEvolutionProbeExecutionSummary, 'durationMs' | 'turnsPlanned'>>;
}

export interface ProviderEvolutionProbeServiceOptions {
  rootDir: string;
  retentionLimit?: number;
  now?: () => number;
}

export const PROVIDER_EVOLUTION_PROBE_PROFILES: Record<string, ProviderEvolutionProbeProfile> = {
  manual_text: {
    id: 'manual_text',
    label: 'Manual Text Probe',
    description: 'Minimal text/final-result probe with deterministic plain output.',
    turns: [
      {
        id: 'text-baseline',
        summary: 'Short deterministic text response',
        prompt: 'Reply with exactly three lines: alpha, beta, gamma.',
      },
    ],
  },
  manual_tool: {
    id: 'manual_tool',
    label: 'Manual Tool Probe',
    description:
      'Single-turn text and tool probe for providers that cannot carry a second turn.',
    turns: [
      {
        id: 'text-and-tool',
        summary: 'Short deterministic text response plus one workspace inspection tool call',
        prompt:
          'Inspect the current directory with one safe tool if tool use is available, and '
          + 'mention the file named "probe-note.txt" in your answer. Then reply with exactly '
          + 'three lines: alpha, beta, gamma. If tools are unavailable, say so briefly and '
          + 'still reply with those three lines.',
      },
    ],
  },
  manual_smoke: {
    id: 'manual_smoke',
    label: 'Manual Smoke Probe',
    description: 'Text baseline plus a bounded tool-friendly workspace inspection prompt.',
    turns: [
      {
        id: 'text-baseline',
        summary: 'Short deterministic text response',
        prompt: 'Reply with exactly three lines: alpha, beta, gamma.',
      },
      {
        id: 'tool-observe',
        summary: 'Try to inspect the local probe workspace with one tool',
        prompt:
          'Inspect the current directory with one safe tool if tool use is available. '
          + 'Mention the file named "probe-note.txt" in your answer, then finish with the '
          + 'single line "probe-complete". If tools are unavailable, say so briefly and still '
          + 'finish with "probe-complete".',
      },
    ],
  },
};

export class ProviderEvolutionProbeService {
  private readonly now: () => number;
  private readonly retentionLimit: number;

  constructor(private readonly options: ProviderEvolutionProbeServiceOptions) {
    this.now = options.now ?? Date.now;
    this.retentionLimit = Math.max(
      1,
      Math.trunc(options.retentionLimit ?? DEFAULT_PROVIDER_EVOLUTION_PROBE_RETENTION_LIMIT),
    );
  }

  async run(request: ProviderEvolutionProbeRequest): Promise<ProviderEvolutionProbeStoredArtifact> {
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: request.target.provider,
      instance: request.target.instance,
      parserId: request.target.parserId,
      probeProfile: request.target.probeProfile,
      transport: request.target.transport ?? 'unknown',
      version: request.target.version,
    }, {
      now: this.now,
    });

    const startedAt = this.now();
    let execution: ProviderEvolutionProbeExecutionSummary;
    try {
      const result = await request.run({
        profile: request.profile,
        observer: collector,
      });
      execution = {
        ...result,
        durationMs: Math.max(0, this.now() - startedAt),
        turnsPlanned: request.profile.turns.length,
      };
    } catch (error) {
      execution = {
        status: 'failed',
        durationMs: Math.max(0, this.now() - startedAt),
        turnsPlanned: request.profile.turns.length,
        turnsCompleted: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const evidence = collector.finalize();
    const capabilitySnapshot = deriveProviderEvolutionCapabilitySnapshot(evidence);
    const baseline = await this.findLatestBaseline(request.target, request.profile.id);
    const compare = baseline
      ? compareProviderEvolutionSnapshots(capabilitySnapshot, baseline.artifact.capabilitySnapshot, {
          baselineArtifactId: baseline.artifact.id,
          baselineCapturedAt: baseline.artifact.capturedAt,
        })
      : undefined;
    const review = summarizeProviderEvolutionProbeReview(compare);
    const reviewContext = normalizeProviderEvolutionReviewContext(request.reviewContext);

    const artifact: ProviderEvolutionProbeArtifact = {
      schemaVersion: PROVIDER_EVOLUTION_PROBE_ARTIFACT_SCHEMA_VERSION,
      id: buildArtifactId(request.target, capabilitySnapshot, evidence, this.now()),
      provider: request.target.provider,
      instance: request.target.instance,
      parserId: request.target.parserId,
      probeProfile: request.profile.id,
      transport: request.target.transport ?? 'unknown',
      ...(request.target.runtimeMode ? { runtimeMode: request.target.runtimeMode } : {}),
      version: request.target.version,
      capturedAt: new Date(this.now()).toISOString(),
      execution,
      capabilitySnapshot,
      compare,
      review,
      ...(reviewContext ? { reviewContext } : {}),
      baseline: baseline ? {
        artifactId: baseline.artifact.id,
        capturedAt: baseline.artifact.capturedAt,
      } : undefined,
      evidence,
    };

    const relativePath = join(
      sanitizeArtifactProviderSegment(request.target.provider),
      `${artifact.id}.json`,
    );
    const artifactPath = join(this.options.rootDir, relativePath);
    await mkdir(join(this.options.rootDir, sanitizeArtifactProviderSegment(request.target.provider)), {
      recursive: true,
    });
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await this.pruneRetainedArtifacts(request.target.provider);

    return {
      artifact,
      relativePath,
      artifactPath,
    };
  }

  async readArtifactById(
    artifactId: string,
    query: ProviderEvolutionProbeArtifactQuery = {},
  ): Promise<ProviderEvolutionProbeStoredArtifact | null> {
    const artifactPaths = await this.listArtifactRelativePaths(query.provider);
    for (const relativePath of artifactPaths.relativePaths) {
      if (!relativePath.endsWith(`${artifactId}.json`)) {
        continue;
      }
      const stored = await this.readStoredArtifact(relativePath);
      if (stored && matchesProviderEvolutionArtifactQuery(stored.artifact, query)) {
        return stored;
      }
    }
    return null;
  }

  async readLatestArtifact(
    query: ProviderEvolutionProbeArtifactQuery = {},
  ): Promise<ProviderEvolutionProbeArtifactSummary | null> {
    if (query.provider) {
      const artifactPaths = await this.listArtifactRelativePaths(query.provider, {
        newestFirst: true,
      });
      if (artifactPaths.orderedByRecency) {
        for (const relativePath of artifactPaths.relativePaths) {
          const stored = await this.readStoredArtifact(relativePath);
          if (stored && matchesProviderEvolutionArtifactQuery(stored.artifact, query)) {
            return summarizeProviderEvolutionProbeArtifact(stored);
          }
        }

        return null;
      }
    }

    const summaries = await this.listArtifacts({
      ...query,
      limit: 1,
    });
    return summaries[0] ?? null;
  }

  async listArtifacts(
    query: ProviderEvolutionProbeArtifactQuery = {},
  ): Promise<ProviderEvolutionProbeArtifactSummary[]> {
    const limit = normalizeArtifactListLimit(query.limit);
    const artifactPaths = await this.listArtifactRelativePaths(query.provider, {
      newestFirst: Boolean(query.provider && limit),
    });
    const artifacts: ProviderEvolutionProbeArtifactSummary[] = [];

    for (const relativePath of artifactPaths.relativePaths) {
      const stored = await this.readStoredArtifact(relativePath);
      if (!stored || !matchesProviderEvolutionArtifactQuery(stored.artifact, query)) {
        continue;
      }
      artifacts.push(summarizeProviderEvolutionProbeArtifact(stored));
      if (artifactPaths.orderedByRecency && limit && artifacts.length >= limit) {
        return artifacts;
      }
    }

    artifacts.sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
    return limit ? artifacts.slice(0, limit) : artifacts;
  }

  async updateArtifactReviewById(
    artifactId: string,
    update: ProviderEvolutionProbeReviewUpdate,
    query: ProviderEvolutionProbeArtifactQuery = {},
  ): Promise<ProviderEvolutionProbeStoredArtifact | null> {
    const stored = await this.readArtifactById(artifactId, query);
    if (!stored) {
      return null;
    }

    const artifact = applyProviderEvolutionReviewUpdate(stored.artifact, update);
    await writeFile(stored.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

    return {
      ...stored,
      artifact,
    };
  }

  async pruneRetainedArtifacts(provider?: string): Promise<number> {
    return pruneProviderArtifacts(this.options.rootDir, this.retentionLimit, provider);
  }

  private async findLatestBaseline(
    target: ProviderEvolutionProbeRequest['target'],
    profileId: string,
  ): Promise<ProviderEvolutionProbeStoredArtifact | undefined> {
    const latestCandidatePaths = await this.listArtifactRelativePaths(target.provider, {
      newestFirst: true,
    });
    if (latestCandidatePaths.orderedByRecency) {
      for (const relativePath of latestCandidatePaths.relativePaths) {
        const stored = await this.readStoredArtifact(relativePath);
        if (!stored) {
          continue;
        }
        const parsed = stored.artifact;
        if (
          parsed.provider === target.provider
          && parsed.instance === target.instance
          && parsed.parserId === target.parserId
          && parsed.probeProfile === profileId
          && matchesBaselineRuntimeMode(parsed.runtimeMode, target.runtimeMode)
        ) {
          return stored;
        }
      }

      return undefined;
    }

    const artifacts: ProviderEvolutionProbeStoredArtifact[] = [];
    const artifactPaths = await this.listArtifactRelativePaths(target.provider);
    for (const relativePath of artifactPaths.relativePaths) {
      const stored = await this.readStoredArtifact(relativePath);
      if (!stored) {
        continue;
      }
      const parsed = stored.artifact;
      if (
        parsed.provider === target.provider
        && parsed.instance === target.instance
        && parsed.parserId === target.parserId
        && parsed.probeProfile === profileId
        && matchesBaselineRuntimeMode(parsed.runtimeMode, target.runtimeMode)
      ) {
        artifacts.push(stored);
      }
    }

    return artifacts
      .sort((left, right) => Date.parse(right.artifact.capturedAt) - Date.parse(left.artifact.capturedAt))[0];
  }

  private async listArtifactRelativePaths(
    provider?: string,
    options: {
      newestFirst?: boolean;
    } = {},
  ) {
    return listProviderArtifactRelativePaths(this.options.rootDir, provider, options);
  }

  private async readStoredArtifact(
    relativePath: string,
  ): Promise<ProviderEvolutionProbeStoredArtifact | null> {
    const artifactPath = join(this.options.rootDir, relativePath);
    try {
      const parsed = JSON.parse(await readFile(artifactPath, 'utf8')) as ProviderEvolutionProbeArtifact;
      return {
        artifact: hydrateProviderEvolutionProbeArtifact(parsed),
        relativePath,
        artifactPath,
      };
    } catch {
      return null;
    }
  }
}

export function getProviderEvolutionProbeProfile(
  profileId: string | undefined,
): ProviderEvolutionProbeProfile {
  return PROVIDER_EVOLUTION_PROBE_PROFILES[profileId || 'manual_smoke']
    || PROVIDER_EVOLUTION_PROBE_PROFILES.manual_smoke;
}

export function deriveProviderEvolutionCapabilitySnapshot(
  evidence: ProviderEvolutionEvidenceBundle,
): ProviderEvolutionCapabilitySnapshot {
  const normalizedEventTypes = { ...evidence.summary.normalizedEventTypes };
  const ignoredEventTypes = Object.keys(evidence.summary.ignoredEventTypes).sort();
  const rawPassthroughEventTypes = Object.keys(evidence.summary.rawPassthroughEventTypes).sort();
  const unknownEventTypes = Object.keys(evidence.summary.unknownEventTypes).sort();
  const observedEventTypes = Array.from(new Set([
    ...Object.keys(normalizedEventTypes),
    ...ignoredEventTypes,
    ...rawPassthroughEventTypes,
    ...unknownEventTypes,
  ])).sort();

  return {
    incrementalText: buildCapabilitySignal(normalizedEventTypes.text),
    toolUse: buildCapabilitySignal(normalizedEventTypes.tool_use),
    toolResult: buildCapabilitySignal(normalizedEventTypes.tool_result),
    progress: buildCapabilitySignal(normalizedEventTypes.progress),
    finalResult: buildCapabilitySignal(normalizedEventTypes.result),
    ignoredEventTypes,
    schemaFailures: { ...evidence.summary.schemaFailureCounts },
    observedEventTypes,
    normalizedEventTypes,
    rawPassthroughEventTypes,
    counters: {
      normalized: evidence.summary.normalizedCount,
      ignored: evidence.summary.ignoredCount,
      unknown: evidence.summary.unknownCount,
      schemaFailure: evidence.summary.schemaFailureCount,
      rawPassthrough: evidence.summary.rawPassthroughCount,
    },
  };
}

export function compareProviderEvolutionSnapshots(
  current: ProviderEvolutionCapabilitySnapshot,
  baseline: ProviderEvolutionCapabilitySnapshot,
  baselineRef: {
    baselineArtifactId: string;
    baselineCapturedAt: string;
  },
): ProviderEvolutionBaselineCompare {
  const currentEvents = new Set(current.observedEventTypes);
  const baselineEvents = new Set(baseline.observedEventTypes);

  const addedEventTypes = [...currentEvents]
    .filter((eventType) => !baselineEvents.has(eventType))
    .sort();
  const removedEventTypes = [...baselineEvents]
    .filter((eventType) => !currentEvents.has(eventType))
    .sort();

  const sharedNormalizedTypes = new Set([
    ...Object.keys(current.normalizedEventTypes),
    ...Object.keys(baseline.normalizedEventTypes),
  ]);
  const frequencyDrops: ProviderEvolutionFrequencyDrop[] = [];
  for (const eventType of sharedNormalizedTypes) {
    const previousCount = baseline.normalizedEventTypes[eventType] ?? 0;
    const currentCount = current.normalizedEventTypes[eventType] ?? 0;
    if (previousCount >= 2 && currentCount < previousCount && currentCount <= Math.floor(previousCount / 2)) {
      frequencyDrops.push({
        eventType,
        previousCount,
        currentCount,
      });
    }
  }

  const schemaKeys = new Set([
    ...Object.keys(current.schemaFailures),
    ...Object.keys(baseline.schemaFailures),
  ]);
  const schemaChanges: ProviderEvolutionSchemaChange[] = [];
  for (const eventType of schemaKeys) {
    const previousCount = baseline.schemaFailures[eventType] ?? 0;
    const currentCount = current.schemaFailures[eventType] ?? 0;
    if (previousCount !== currentCount) {
      schemaChanges.push({
        eventType,
        previousCount,
        currentCount,
      });
    }
  }

  const semanticDriftReasons: string[] = [];
  if (
    current.counters.rawPassthrough >= baseline.counters.rawPassthrough + 3
    && schemaChanges.length === 0
  ) {
    semanticDriftReasons.push(
      'Raw passthrough volume increased without a direct schema-failure spike.',
    );
  }
  if (
    current.counters.ignored >= baseline.counters.ignored + 5
    && removedEventTypes.length === 0
  ) {
    semanticDriftReasons.push(
      'Ignored event volume increased while the normalized event family stayed largely intact.',
    );
  }
  if (
    baseline.finalResult.observed
    && current.finalResult.observed
    && baseline.counters.normalized >= 4
    && current.counters.normalized <= Math.floor(baseline.counters.normalized / 2)
    && removedEventTypes.length === 0
  ) {
    semanticDriftReasons.push(
      'Normalized event volume dropped sharply even though terminal results still arrived.',
    );
  }

  return {
    ...baselineRef,
    addedEventTypes,
    removedEventTypes,
    frequencyDrops,
    schemaChanges,
    semanticDriftSuspected: semanticDriftReasons.length > 0,
    semanticDriftReasons,
  };
}

export function formatProviderEvolutionProbeEntrySummary(
  result: ProviderEvolutionProbeStoredArtifact,
): string {
  const snapshot = result.artifact.capabilitySnapshot;
  const review = result.artifact.review;
  const lines = [
    `Provider evolution probe completed for ${result.artifact.provider}/${result.artifact.instance}.`,
    `Profile: ${result.artifact.probeProfile}`,
    `Observed capabilities: text=${formatObserved(snapshot.incrementalText)}, `
      + `tool_use=${formatObserved(snapshot.toolUse)}, `
      + `tool_result=${formatObserved(snapshot.toolResult)}, `
      + `progress=${formatObserved(snapshot.progress)}, `
      + `result=${formatObserved(snapshot.finalResult)}`,
    `Review: ${review.summary}`,
  ];

  if (result.artifact.compare) {
    lines.push(
      `Baseline compare: +${result.artifact.compare.addedEventTypes.length} added, `
      + `${result.artifact.compare.removedEventTypes.length} removed, `
      + `${result.artifact.compare.schemaChanges.length} schema changes.`,
    );
  } else {
    lines.push('Baseline compare: none (no prior matching artifact).');
  }

  if (result.artifact.reviewContext?.references.length) {
    lines.push(
      `External references: ${result.artifact.reviewContext.references
        .map((reference) => `${reference.kind}=${reference.url}`)
        .join(', ')}`,
    );
  }

  for (const highlight of review.highlights) {
    lines.push(`- ${highlight}`);
  }

  lines.push(`Artifact: ${result.artifactPath}`);
  return `${lines.join('\n')}\n`;
}

export function summarizeProviderEvolutionProbeArtifact(
  result: ProviderEvolutionProbeStoredArtifact,
): ProviderEvolutionProbeArtifactSummary {
  return {
    artifactId: result.artifact.id,
    provider: result.artifact.provider,
    instance: result.artifact.instance,
    parserId: result.artifact.parserId,
    probeProfile: result.artifact.probeProfile,
    transport: result.artifact.transport,
    runtimeMode: result.artifact.runtimeMode,
    version: result.artifact.version,
    capturedAt: result.artifact.capturedAt,
    execution: result.artifact.execution,
    capabilitySnapshot: result.artifact.capabilitySnapshot,
    compare: result.artifact.compare
      ? {
          baselineArtifactId: result.artifact.compare.baselineArtifactId,
          baselineCapturedAt: result.artifact.compare.baselineCapturedAt,
          addedEventTypeCount: result.artifact.compare.addedEventTypes.length,
          removedEventTypeCount: result.artifact.compare.removedEventTypes.length,
          frequencyDropCount: result.artifact.compare.frequencyDrops.length,
          schemaChangeCount: result.artifact.compare.schemaChanges.length,
          semanticDriftSuspected: result.artifact.compare.semanticDriftSuspected,
        }
      : undefined,
    review: result.artifact.review,
    reviewContext: result.artifact.reviewContext,
    relativePath: result.relativePath,
    artifactPath: result.artifactPath,
  };
}

function buildCapabilitySignal(count: number | undefined): ProviderEvolutionCapabilitySignal {
  return {
    observed: (count ?? 0) > 0,
    count: count ?? 0,
  };
}

function buildArtifactId(
  target: ProviderEvolutionProbeRequest['target'],
  snapshot: ProviderEvolutionCapabilitySnapshot,
  evidence: ProviderEvolutionEvidenceBundle,
  now: number,
): string {
  const digest = createHash('sha1')
    .update(JSON.stringify({
      provider: target.provider,
      instance: target.instance,
      parserId: target.parserId,
      probeProfile: target.probeProfile,
      version: target.version,
      normalizedEventTypes: snapshot.normalizedEventTypes,
      ignoredEventTypes: snapshot.ignoredEventTypes,
      schemaFailures: snapshot.schemaFailures,
      lastObservedAt: evidence.lastObservedAt,
    }))
    .digest('hex')
    .slice(0, 12);

  return `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${digest}-${randomUUID().slice(0, 8)}`;
}

function formatObserved(signal: ProviderEvolutionCapabilitySignal): string {
  return signal.observed ? `yes(${signal.count})` : 'no';
}

function hydrateProviderEvolutionProbeArtifact(
  artifact: ProviderEvolutionProbeArtifact,
): ProviderEvolutionProbeArtifact {
  return {
    ...artifact,
    review: artifact.review ?? summarizeProviderEvolutionProbeReview(artifact.compare),
    reviewContext: normalizeProviderEvolutionReviewContext(artifact.reviewContext),
  };
}

function applyProviderEvolutionReviewUpdate(
  artifact: ProviderEvolutionProbeArtifact,
  update: ProviderEvolutionProbeReviewUpdate,
): ProviderEvolutionProbeArtifact {
  const nextClassifications = update.classifications
    ? Array.from(new Set(update.classifications))
    : artifact.review.classifications;
  const nextHighlights = update.highlights
    ? normalizeProviderEvolutionReviewHighlights(update.highlights)
    : artifact.review.highlights;
  const nextReview: ProviderEvolutionProbeReviewSummary = {
    classifications: nextClassifications,
    summary: update.summary?.trim()
      || (update.classifications ? buildManualProviderEvolutionReviewSummary(nextClassifications) : artifact.review.summary),
    highlights: nextHighlights,
  };
  const nextReviewContext = update.references !== undefined
    ? normalizeProviderEvolutionReviewContext({ references: update.references })
    : normalizeProviderEvolutionReviewContext(artifact.reviewContext);
  const { reviewContext: _previousReviewContext, ...artifactWithoutReviewContext } = artifact;

  return hydrateProviderEvolutionProbeArtifact({
    ...artifactWithoutReviewContext,
    review: nextReview,
    ...(nextReviewContext ? { reviewContext: nextReviewContext } : {}),
  });
}

function normalizeProviderEvolutionReviewHighlights(
  highlights: string[],
): string[] {
  return Array.from(new Set(
    highlights
      .map((highlight) => highlight.trim())
      .filter((highlight) => highlight.length > 0),
  ));
}

function normalizeProviderEvolutionReviewContext(
  value: { references?: ProviderEvolutionExternalReference[] } | undefined,
): { references: ProviderEvolutionExternalReference[] } | undefined {
  if (!value?.references?.length) {
    return undefined;
  }

  const deduped = new Map<string, ProviderEvolutionExternalReference>();
  for (const reference of value.references) {
    const key = `${reference.kind}\u0000${reference.url}`;
    deduped.set(key, {
      kind: reference.kind,
      url: reference.url,
    });
  }

  const references = [...deduped.values()]
    .sort((left, right) => {
      const kindOrder = left.kind.localeCompare(right.kind);
      return kindOrder !== 0 ? kindOrder : left.url.localeCompare(right.url);
    });
  return references.length > 0 ? { references } : undefined;
}

function matchesProviderEvolutionArtifactQuery(
  artifact: ProviderEvolutionProbeArtifact,
  query: ProviderEvolutionProbeArtifactQuery,
): boolean {
  if (query.provider && artifact.provider !== query.provider) {
    return false;
  }
  if (query.instance && artifact.instance !== query.instance) {
    return false;
  }
  if (query.parserId && artifact.parserId !== query.parserId) {
    return false;
  }
  if (query.probeProfile && artifact.probeProfile !== query.probeProfile) {
    return false;
  }
  if (query.transport && artifact.transport !== query.transport) {
    return false;
  }
  if (query.runtimeMode && artifact.runtimeMode !== query.runtimeMode) {
    return false;
  }
  if (
    query.reviewClassifications?.length
    && !query.reviewClassifications.some((classification) => artifact.review.classifications.includes(classification))
  ) {
    return false;
  }
  return true;
}

function matchesBaselineRuntimeMode(
  artifactRuntimeMode: RuntimeMode | undefined,
  targetRuntimeMode: RuntimeMode | undefined,
): boolean {
  if (!targetRuntimeMode) {
    return artifactRuntimeMode === undefined;
  }

  return artifactRuntimeMode === undefined || artifactRuntimeMode === targetRuntimeMode;
}

function summarizeProviderEvolutionProbeReview(
  compare: ProviderEvolutionBaselineCompare | undefined,
): ProviderEvolutionProbeReviewSummary {
  if (!compare) {
    return {
      classifications: ['baseline'],
      summary: 'No prior matching baseline artifact was available.',
      highlights: [],
    };
  }

  const classifications: ProviderEvolutionReviewClassification[] = [];
  const highlights: string[] = [];

  if (compare.addedEventTypes.length > 0) {
    classifications.push('upgrade');
    highlights.push(`Added event types: ${compare.addedEventTypes.join(', ')}`);
  }
  if (compare.removedEventTypes.length > 0 || compare.frequencyDrops.length > 0) {
    classifications.push('regression');
    if (compare.removedEventTypes.length > 0) {
      highlights.push(`Removed event types: ${compare.removedEventTypes.join(', ')}`);
    }
    if (compare.frequencyDrops.length > 0) {
      highlights.push(
        `Frequency drops: ${compare.frequencyDrops
          .map((drop) => `${drop.eventType} ${drop.previousCount}->${drop.currentCount}`)
          .join(', ')}`,
      );
    }
  }
  if (compare.schemaChanges.length > 0) {
    classifications.push('schema_change');
    highlights.push(
      `Schema changes: ${compare.schemaChanges
        .map((change) => `${change.eventType} ${change.previousCount}->${change.currentCount}`)
        .join(', ')}`,
    );
  }
  if (compare.semanticDriftSuspected) {
    classifications.push('semantic_drift_suspected');
    highlights.push(...compare.semanticDriftReasons);
  }

  if (classifications.length === 0) {
    return {
      classifications: ['stable'],
      summary: 'No material capability changes were detected relative to the latest baseline.',
      highlights: [],
    };
  }

  return {
    classifications,
    summary: `Detected ${classifications.map(formatReviewClassification).join(', ')} relative to the latest baseline.`,
    highlights,
  };
}

function normalizeArtifactListLimit(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.trunc(value));
}

function buildManualProviderEvolutionReviewSummary(
  classifications: ProviderEvolutionReviewClassification[],
): string {
  const labels = classifications.map(formatReviewClassification);
  return `Manual review classified this artifact as ${labels.join(', ')}.`;
}

function formatReviewClassification(value: ProviderEvolutionReviewClassification): string {
  switch (value) {
    case 'schema_change':
      return 'schema changes';
    case 'semantic_drift_suspected':
      return 'suspected semantic drift';
    default:
      return value.replace(/_/g, ' ');
  }
}
