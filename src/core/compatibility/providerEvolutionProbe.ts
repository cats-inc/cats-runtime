import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderEvolutionEvidenceObserver, ProviderEvolutionEvidenceBundle, ProviderEvolutionTransport } from './providerEvolution.js';
import { ProviderEvolutionEvidenceCollector } from './providerEvolution.js';

export const PROVIDER_EVOLUTION_PROBE_ARTIFACT_SCHEMA_VERSION = 1;

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
  version?: string;
  capturedAt: string;
  execution: ProviderEvolutionProbeExecutionSummary;
  capabilitySnapshot: ProviderEvolutionCapabilitySnapshot;
  compare?: ProviderEvolutionBaselineCompare;
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

export interface ProviderEvolutionProbeRequest {
  target: {
    provider: string;
    instance: string;
    parserId: string;
    probeProfile: string;
    transport?: ProviderEvolutionTransport;
    version?: string;
  };
  profile: ProviderEvolutionProbeProfile;
  run: (input: {
    profile: ProviderEvolutionProbeProfile;
    observer: ProviderEvolutionEvidenceObserver;
  }) => Promise<Omit<ProviderEvolutionProbeExecutionSummary, 'durationMs' | 'turnsPlanned'>>;
}

export interface ProviderEvolutionProbeServiceOptions {
  rootDir: string;
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

  constructor(private readonly options: ProviderEvolutionProbeServiceOptions) {
    this.now = options.now ?? Date.now;
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

    const artifact: ProviderEvolutionProbeArtifact = {
      schemaVersion: PROVIDER_EVOLUTION_PROBE_ARTIFACT_SCHEMA_VERSION,
      id: buildArtifactId(request.target, capabilitySnapshot, evidence, this.now()),
      provider: request.target.provider,
      instance: request.target.instance,
      parserId: request.target.parserId,
      probeProfile: request.profile.id,
      transport: request.target.transport ?? 'unknown',
      version: request.target.version,
      capturedAt: new Date(this.now()).toISOString(),
      execution,
      capabilitySnapshot,
      compare,
      baseline: baseline ? {
        artifactId: baseline.artifact.id,
        capturedAt: baseline.artifact.capturedAt,
      } : undefined,
      evidence,
    };

    const relativePath = join(
      sanitizePathSegment(request.target.provider),
      `${artifact.id}.json`,
    );
    const artifactPath = join(this.options.rootDir, relativePath);
    await mkdir(join(this.options.rootDir, sanitizePathSegment(request.target.provider)), {
      recursive: true,
    });
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

    return {
      artifact,
      relativePath,
      artifactPath,
    };
  }

  private async findLatestBaseline(
    target: ProviderEvolutionProbeRequest['target'],
    profileId: string,
  ): Promise<ProviderEvolutionProbeStoredArtifact | undefined> {
    const providerDir = join(this.options.rootDir, sanitizePathSegment(target.provider));
    let names: string[];
    try {
      names = await readdir(providerDir);
    } catch {
      return undefined;
    }

    const artifacts: ProviderEvolutionProbeStoredArtifact[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }

      const relativePath = join(sanitizePathSegment(target.provider), name);
      const artifactPath = join(this.options.rootDir, relativePath);
      try {
        const parsed = JSON.parse(await readFile(artifactPath, 'utf8')) as ProviderEvolutionProbeArtifact;
        if (
          parsed.provider === target.provider
          && parsed.instance === target.instance
          && parsed.parserId === target.parserId
          && parsed.probeProfile === profileId
        ) {
          artifacts.push({
            artifact: parsed,
            relativePath,
            artifactPath,
          });
        }
      } catch {
        // Ignore unreadable historical artifacts.
      }
    }

    return artifacts
      .sort((left, right) => Date.parse(right.artifact.capturedAt) - Date.parse(left.artifact.capturedAt))[0];
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
  const lines = [
    `Provider evolution probe completed for ${result.artifact.provider}/${result.artifact.instance}.`,
    `Profile: ${result.artifact.probeProfile}`,
    `Observed capabilities: text=${formatObserved(snapshot.incrementalText)}, `
      + `tool_use=${formatObserved(snapshot.toolUse)}, `
      + `tool_result=${formatObserved(snapshot.toolResult)}, `
      + `progress=${formatObserved(snapshot.progress)}, `
      + `result=${formatObserved(snapshot.finalResult)}`,
  ];

  if (result.artifact.compare) {
    lines.push(
      `Baseline compare: +${result.artifact.compare.addedEventTypes.length} added, `
      + `${result.artifact.compare.removedEventTypes.length} removed, `
      + `${result.artifact.compare.schemaChanges.length} schema changes.`,
    );
    if (result.artifact.compare.semanticDriftSuspected) {
      lines.push('Semantic drift suspected; review the compare block in the artifact.');
    }
  } else {
    lines.push('Baseline compare: none (no prior matching artifact).');
  }

  lines.push(`Artifact: ${result.artifactPath}`);
  return `${lines.join('\n')}\n`;
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

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'default';
}

function formatObserved(signal: ProviderEvolutionCapabilitySignal): string {
  return signal.observed ? `yes(${signal.count})` : 'no';
}
