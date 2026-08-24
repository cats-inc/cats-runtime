import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareProviderEvolutionSnapshots,
  deriveProviderEvolutionCapabilitySnapshot,
  formatProviderEvolutionProbeEntrySummary,
  getProviderEvolutionProbeProfile,
  ProviderEvolutionProbeService,
  PROVIDER_EVOLUTION_PROBE_PROFILES,
  summarizeProviderEvolutionProbeArtifact,
} from './providerEvolutionProbe.js';
import type { ProviderEvolutionEvidenceObserver } from './providerEvolution.js';

describe('provider evolution probe snapshot/compare', () => {
  it('derives capability truth from an evidence summary', () => {
    const snapshot = deriveProviderEvolutionCapabilitySnapshot({
      schemaVersion: 1,
      provider: 'codex',
      instance: 'default',
      parserId: 'codex-json-rpc',
      probeProfile: 'manual-smoke',
      transport: 'cli',
      capturedAt: '2026-03-27T00:00:00.000Z',
      rawSamples: [],
      normalizedSamples: [],
      summary: {
        normalizedCount: 6,
        ignoredCount: 2,
        unknownCount: 1,
        schemaFailureCount: 1,
        rawPassthroughCount: 1,
        normalizedEventTypes: {
          text: 2,
          progress: 1,
          tool_use: 1,
          tool_result: 1,
          result: 1,
        },
        ignoredEventTypes: {
          'turn/started': 1,
          'thread/status/changed': 1,
        },
        unknownEventTypes: {
          'future.event': 1,
        },
        schemaFailureCounts: {
          'session.start': 1,
        },
        rawPassthroughEventTypes: {
          non_json_line: 1,
        },
      },
    });

    expect(snapshot.incrementalText).toEqual({ observed: true, count: 2 });
    expect(snapshot.toolUse.observed).toBe(true);
    expect(snapshot.toolResult.observed).toBe(true);
    expect(snapshot.progress.observed).toBe(true);
    expect(snapshot.finalResult.observed).toBe(true);
    expect(snapshot.ignoredEventTypes).toEqual([
      'thread/status/changed',
      'turn/started',
    ]);
    expect(snapshot.rawPassthroughEventTypes).toEqual(['non_json_line']);
    expect(snapshot.observedEventTypes).toContain('future.event');
  });

  it('compares snapshots for added/removed/frequency/schema/drift signals', () => {
    const baseline = {
      incrementalText: { observed: true, count: 4 },
      toolUse: { observed: true, count: 2 },
      toolResult: { observed: false, count: 0 },
      progress: { observed: true, count: 3 },
      finalResult: { observed: true, count: 1 },
      ignoredEventTypes: ['turn/started'],
      schemaFailures: {},
      observedEventTypes: ['progress', 'result', 'text', 'tool_use', 'turn/started'],
      normalizedEventTypes: {
        text: 4,
        progress: 3,
        tool_use: 2,
        result: 1,
      },
      rawPassthroughEventTypes: [],
      counters: {
        normalized: 10,
        ignored: 1,
        unknown: 0,
        schemaFailure: 0,
        rawPassthrough: 0,
      },
    };
    const current = {
      incrementalText: { observed: true, count: 1 },
      toolUse: { observed: true, count: 1 },
      toolResult: { observed: true, count: 1 },
      progress: { observed: true, count: 1 },
      finalResult: { observed: true, count: 1 },
      ignoredEventTypes: ['turn/started'],
      schemaFailures: { 'session.start': 1 },
      observedEventTypes: [
        'progress',
        'result',
        'text',
        'tool_result',
        'tool_use',
        'turn/started',
      ],
      normalizedEventTypes: {
        text: 1,
        progress: 1,
        tool_use: 1,
        tool_result: 1,
        result: 1,
      },
      rawPassthroughEventTypes: ['non_json_line'],
      counters: {
        normalized: 5,
        ignored: 7,
        unknown: 0,
        schemaFailure: 1,
        rawPassthrough: 4,
      },
    };

    const compare = compareProviderEvolutionSnapshots(current, baseline, {
      baselineArtifactId: 'baseline-1',
      baselineCapturedAt: '2026-03-27T00:00:00.000Z',
    });

    expect(compare.addedEventTypes).toEqual(['tool_result']);
    expect(compare.removedEventTypes).toEqual([]);
    expect(compare.frequencyDrops).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'text', previousCount: 4, currentCount: 1 }),
      expect.objectContaining({ eventType: 'progress', previousCount: 3, currentCount: 1 }),
      expect.objectContaining({ eventType: 'tool_use', previousCount: 2, currentCount: 1 }),
    ]));
    expect(compare.schemaChanges).toEqual([
      { eventType: 'session.start', previousCount: 0, currentCount: 1 },
    ]);
    expect(compare.semanticDriftSuspected).toBe(true);
  });

  it('summarizes review classifications from compare output', () => {
    const summary = summarizeProviderEvolutionProbeArtifact({
      artifact: {
        schemaVersion: 1,
        id: 'artifact-1',
        provider: 'codex',
        instance: 'default',
        parserId: 'codex-json-rpc',
        probeProfile: 'manual-smoke',
        transport: 'cli',
        runtimeMode: 'native',
        capturedAt: '2026-03-27T00:00:00.000Z',
        execution: {
          status: 'completed',
          durationMs: 1000,
          turnsPlanned: 2,
          turnsCompleted: 2,
        },
        capabilitySnapshot: {
          incrementalText: { observed: true, count: 1 },
          toolUse: { observed: true, count: 1 },
          toolResult: { observed: false, count: 0 },
          progress: { observed: true, count: 1 },
          finalResult: { observed: true, count: 1 },
          ignoredEventTypes: [],
          schemaFailures: {},
          observedEventTypes: ['progress', 'result', 'text', 'tool_use'],
          normalizedEventTypes: { text: 1, progress: 1, tool_use: 1, result: 1 },
          rawPassthroughEventTypes: [],
          counters: {
            normalized: 4,
            ignored: 0,
            unknown: 0,
            schemaFailure: 0,
            rawPassthrough: 0,
          },
        },
        compare: {
          baselineArtifactId: 'baseline-1',
          baselineCapturedAt: '2026-03-26T00:00:00.000Z',
          addedEventTypes: ['tool_use'],
          removedEventTypes: ['progress'],
          frequencyDrops: [{ eventType: 'text', previousCount: 4, currentCount: 1 }],
          schemaChanges: [{ eventType: 'session.start', previousCount: 0, currentCount: 1 }],
          semanticDriftSuspected: true,
          semanticDriftReasons: ['Progress volume fell sharply.'],
        },
        review: {
          classifications: ['upgrade', 'regression', 'schema_change', 'semantic_drift_suspected'],
          summary: 'Detected upgrade, regression, schema changes, suspected semantic drift relative to the latest baseline.',
          highlights: [
            'Added event types: tool_use',
            'Removed event types: progress',
            'Schema changes: session.start 0->1',
            'Progress volume fell sharply.',
          ],
        },
        evidence: {
          schemaVersion: 1,
          provider: 'codex',
          instance: 'default',
          parserId: 'codex-json-rpc',
          probeProfile: 'manual-smoke',
          transport: 'cli',
          capturedAt: '2026-03-27T00:00:00.000Z',
          rawSamples: [],
          normalizedSamples: [],
          summary: {
            normalizedCount: 4,
            ignoredCount: 0,
            unknownCount: 0,
            schemaFailureCount: 0,
            rawPassthroughCount: 0,
            normalizedEventTypes: { text: 1, progress: 1, tool_use: 1, result: 1 },
            ignoredEventTypes: {},
            unknownEventTypes: {},
            schemaFailureCounts: {},
            rawPassthroughEventTypes: {},
          },
        },
      },
      relativePath: 'codex/artifact-1.json',
      artifactPath: join('C:/tmp/provider-evolution', 'codex', 'artifact-1.json'),
    });

    expect(summary.review.classifications).toEqual([
      'upgrade',
      'regression',
      'schema_change',
      'semantic_drift_suspected',
    ]);
    expect(summary.runtimeMode).toBe('native');
    expect(summary.compare).toEqual({
      baselineArtifactId: 'baseline-1',
      baselineCapturedAt: '2026-03-26T00:00:00.000Z',
      addedEventTypeCount: 1,
      removedEventTypeCount: 1,
      frequencyDropCount: 1,
      schemaChangeCount: 1,
      semanticDriftSuspected: true,
    });
  });
});

describe('ProviderEvolutionProbeService', () => {
  it('stores probe artifacts and compares with the latest matching baseline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-provider-evolution-'));
    let now = Date.parse('2026-03-27T00:00:00.000Z');
    const service = new ProviderEvolutionProbeService({
      rootDir: root,
      now: () => now,
    });

    const request = {
      target: {
        provider: 'codex',
        instance: 'default',
        parserId: 'codex-json-rpc',
        probeProfile: 'manual_text',
        transport: 'cli' as const,
        runtimeMode: 'native' as const,
        version: '1.2.3',
      },
      reviewContext: {
        references: [
          {
            kind: 'release_notes' as const,
            url: 'https://docs.example.com/releases/codex-cli-1-2-3',
          },
          {
            kind: 'release_notes' as const,
            url: 'https://docs.example.com/releases/codex-cli-1-2-3',
          },
          {
            kind: 'changelog' as const,
            url: 'https://docs.example.com/changelog/codex-cli',
          },
        ],
      },
      profile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text,
      run: async ({ observer }: { observer: ProviderEvolutionEvidenceObserver }) => {
        observer.recordNormalized({
          rawEventType: 'item/agentMessage/delta',
          rawSample: { method: 'item/agentMessage/delta' },
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'turn/completed',
          rawSample: { method: 'turn/completed' },
          events: { type: 'result' },
        });
        return {
          status: 'completed' as const,
          turnsCompleted: 1,
          emittedEventCount: 2,
        };
      },
    };

    const baseline = await service.run(request);
    now += 1000;
    const current = await service.run({
      ...request,
      run: async ({ observer }: { observer: ProviderEvolutionEvidenceObserver }) => {
        observer.recordNormalized({
          rawEventType: 'item/agentMessage/delta',
          rawSample: { method: 'item/agentMessage/delta' },
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'turn/completed',
          rawSample: { method: 'turn/completed' },
          events: { type: 'result' },
        });
        observer.recordUnknown({
          rawEventType: 'future.event',
          rawSample: { method: 'future.event' },
        });
        return {
          status: 'completed' as const,
          turnsCompleted: 1,
          emittedEventCount: 2,
        };
      },
    });

    expect(baseline.artifact.compare).toBeUndefined();
    expect(current.artifact.baseline?.artifactId).toBe(baseline.artifact.id);
    expect(current.artifact.compare?.addedEventTypes).toEqual(['future.event']);
    expect(current.artifact.review.classifications).toEqual(['upgrade']);
    expect(current.artifact.review.highlights).toContain('Added event types: future.event');
    expect(current.artifact.reviewContext).toEqual({
      references: [
        {
          kind: 'changelog',
          url: 'https://docs.example.com/changelog/codex-cli',
        },
        {
          kind: 'release_notes',
          url: 'https://docs.example.com/releases/codex-cli-1-2-3',
        },
      ],
    });
    expect(current.artifactPath).toContain('codex');
    expect(formatProviderEvolutionProbeEntrySummary(current)).toContain(
      'Provider evolution probe completed for codex/default.',
    );
    expect(formatProviderEvolutionProbeEntrySummary(current)).toContain(
      'Review: Detected upgrade relative to the latest baseline.',
    );
    expect(formatProviderEvolutionProbeEntrySummary(current)).toContain(
      'External references: changelog=https://docs.example.com/changelog/codex-cli, release_notes=https://docs.example.com/releases/codex-cli-1-2-3',
    );

    const latest = await service.readLatestArtifact({
      provider: 'codex',
      instance: 'default',
    });
    expect(latest).toEqual(expect.objectContaining({
      artifactId: current.artifact.id,
      runtimeMode: 'native',
      review: expect.objectContaining({
        classifications: ['upgrade'],
      }),
      reviewContext: {
        references: [
          {
            kind: 'changelog',
            url: 'https://docs.example.com/changelog/codex-cli',
          },
          {
            kind: 'release_notes',
            url: 'https://docs.example.com/releases/codex-cli-1-2-3',
          },
        ],
      },
    }));

    const listed = await service.listArtifacts({
      provider: 'codex',
      limit: 2,
    });
    expect(listed).toHaveLength(2);
    expect(listed.map((item) => item.artifactId)).toEqual([
      current.artifact.id,
      baseline.artifact.id,
    ]);
    expect(listed[1]?.review.classifications).toEqual(['baseline']);

    const filtered = await service.listArtifacts({
      provider: 'codex',
      reviewClassifications: ['upgrade'],
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.artifactId).toBe(current.artifact.id);

    const noMatch = await service.listArtifacts({
      provider: 'codex',
      reviewClassifications: ['schema_change'],
    });
    expect(noMatch).toEqual([]);

    const reread = await service.readArtifactById(current.artifact.id, {
      provider: 'codex',
    });
    expect(reread?.artifact.review.classifications).toEqual(['upgrade']);
    expect(reread?.artifact.runtimeMode).toBe('native');
    expect(reread?.artifact.reviewContext).toEqual({
      references: [
        {
          kind: 'changelog',
          url: 'https://docs.example.com/changelog/codex-cli',
        },
        {
          kind: 'release_notes',
          url: 'https://docs.example.com/releases/codex-cli-1-2-3',
        },
      ],
    });
    await expect(service.readArtifactById(current.artifact.id, {
      provider: 'codex',
      parserId: 'other-parser',
    })).resolves.toBeNull();
    await expect(service.readLatestArtifact({
      provider: 'codex',
      reviewClassifications: ['baseline'],
    })).resolves.toEqual(expect.objectContaining({
      artifactId: baseline.artifact.id,
    }));

    now += 1000;
    const docker = await service.run({
      ...request,
      target: {
        ...request.target,
        runtimeMode: 'docker',
      },
    });
    expect(docker.artifact.compare).toBeUndefined();

    await expect(service.readLatestArtifact({
      provider: 'codex',
      runtimeMode: 'docker',
    })).resolves.toEqual(expect.objectContaining({
      artifactId: docker.artifact.id,
      runtimeMode: 'docker',
    }));

    const reviewed = await service.updateArtifactReviewById(
      current.artifact.id,
      {
        classifications: ['regression', 'schema_change'],
        summary: 'Manual review flagged a regression with schema changes.',
        highlights: [
          'Removed event types: future.event',
          'Schema changes observed for tool_result.',
        ],
        references: [
          {
            kind: 'issue',
            url: 'https://docs.example.com/issues/codex-cli-regression',
          },
        ],
      },
      {
        provider: 'codex',
      },
    );
    expect(reviewed?.artifact.review).toEqual({
      classifications: ['regression', 'schema_change'],
      summary: 'Manual review flagged a regression with schema changes.',
      highlights: [
        'Removed event types: future.event',
        'Schema changes observed for tool_result.',
      ],
    });
    expect(reviewed?.artifact.reviewContext).toEqual({
      references: [
        {
          kind: 'issue',
          url: 'https://docs.example.com/issues/codex-cli-regression',
        },
      ],
    });
    await expect(service.readLatestArtifact({
      provider: 'codex',
      reviewClassifications: ['regression'],
    })).resolves.toEqual(expect.objectContaining({
      artifactId: current.artifact.id,
      review: expect.objectContaining({
        classifications: ['regression', 'schema_change'],
      }),
    }));

    rmSync(root, { recursive: true, force: true });
  });

  it('prunes older retained provider-evolution artifacts per provider', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-runtime-provider-evolution-'));
    let now = Date.parse('2026-03-27T00:00:00.000Z');
    const service = new ProviderEvolutionProbeService({
      rootDir: root,
      retentionLimit: 2,
      now: () => now,
    });

    const runProbe = async () => service.run({
      target: {
        provider: 'codex',
        instance: 'default',
        parserId: 'codex-json-rpc',
        probeProfile: 'manual_text',
        transport: 'cli',
      },
      profile: PROVIDER_EVOLUTION_PROBE_PROFILES.manual_text,
      run: async ({ observer }) => {
        observer.recordNormalized({
          rawEventType: 'assistant',
          events: { type: 'text', text: 'alpha' },
        });
        observer.recordNormalized({
          rawEventType: 'result',
          events: { type: 'result' },
        });
        return {
          status: 'completed',
          turnsCompleted: 1,
          emittedEventCount: 2,
        };
      },
    });

    try {
      const first = await runProbe();
      now += 1000;
      const second = await runProbe();
      now += 1000;
      const third = await runProbe();

      expect(readdirSync(join(root, 'codex'))
        .filter((name) => name.endsWith('.json'))
        .sort())
        .toEqual([
          `${second.artifact.id}.json`,
          `${third.artifact.id}.json`,
        ].sort());
      await expect(service.readArtifactById(first.artifact.id, {
        provider: 'codex',
      })).resolves.toBeNull();
      await expect(service.listArtifacts({
        provider: 'codex',
      })).resolves.toEqual([
        expect.objectContaining({ artifactId: third.artifact.id }),
        expect.objectContaining({ artifactId: second.artifact.id }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('provider evolution probe profiles', () => {
  it('keeps manual_smoke as the default and splits text from tool observation', () => {
    const profile = getProviderEvolutionProbeProfile(undefined);

    expect(profile.id).toBe('manual_smoke');
    expect(profile.turns).toHaveLength(2);
    expect(profile.turns[1].prompt).toContain('probe-note.txt');
  });

  it('exposes a single-turn tool profile for providers that cannot carry a second turn', () => {
    const profile = getProviderEvolutionProbeProfile('manual_tool');

    expect(profile.id).toBe('manual_tool');
    expect(profile.turns).toHaveLength(1);
    // Both signals have to ride the first turn: a provider like Cline declares
    // resume: false, so turn two never reaches the model.
    expect(profile.turns[0].prompt).toContain('probe-note.txt');
    expect(profile.turns[0].prompt).toContain('alpha, beta, gamma');
  });

  it('falls back to manual_smoke for an unknown profile id', () => {
    expect(getProviderEvolutionProbeProfile('nope').id).toBe('manual_smoke');
  });
});
