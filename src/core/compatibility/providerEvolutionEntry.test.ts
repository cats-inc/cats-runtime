import { describe, expect, it } from 'vitest';
import {
  formatProviderEvolutionProbeArtifactListSummary,
  formatProviderEvolutionProbeArtifactReadSummary,
} from './providerEvolutionEntry.js';

describe('provider evolution entry summaries', () => {
  it('renders a concise list summary for retained probe artifacts', () => {
    expect(formatProviderEvolutionProbeArtifactListSummary([
      {
        artifactId: 'artifact-1',
        provider: 'codex',
        instance: 'default',
        parserId: 'codex-json-rpc',
        probeProfile: 'manual_smoke',
        transport: 'cli',
        capturedAt: '2026-03-27T00:00:00.000Z',
        execution: {
          status: 'completed',
          durationMs: 1000,
          turnsPlanned: 2,
          turnsCompleted: 2,
        },
        capabilitySnapshot: {} as never,
        compare: {
          baselineArtifactId: 'baseline-1',
          baselineCapturedAt: '2026-03-26T00:00:00.000Z',
          addedEventTypeCount: 1,
          removedEventTypeCount: 0,
          frequencyDropCount: 0,
          schemaChangeCount: 0,
          semanticDriftSuspected: false,
        },
        review: {
          classifications: ['upgrade'],
          summary: 'Detected upgrade relative to the latest baseline.',
          highlights: ['Added event types: tool_result'],
        },
        relativePath: 'codex/artifact-1.json',
        artifactPath: 'C:/tmp/provider-evolution/codex/artifact-1.json',
      },
    ], {
      probeProvider: 'codex',
      probeInstance: 'default',
    })).toBe([
      'Listed 1 provider-evolution artifact(s) for codex/default.',
      '- 2026-03-27T00:00:00.000Z codex/default manual_smoke [upgrade] Detected upgrade relative to the latest baseline.',
      '',
    ].join('\n'));
  });

  it('renders a concise read summary for a retained artifact', () => {
    expect(formatProviderEvolutionProbeArtifactReadSummary({
      relativePath: 'codex/artifact-1.json',
      artifactPath: 'C:/tmp/provider-evolution/codex/artifact-1.json',
      artifact: {
        schemaVersion: 1,
        id: 'artifact-1',
        provider: 'codex',
        instance: 'default',
        parserId: 'codex-json-rpc',
        probeProfile: 'manual_smoke',
        transport: 'cli',
        capturedAt: '2026-03-27T00:00:00.000Z',
        execution: {
          status: 'completed',
          durationMs: 1000,
          turnsPlanned: 2,
          turnsCompleted: 2,
        },
        capabilitySnapshot: {} as never,
        review: {
          classifications: ['baseline'],
          summary: 'Captured the first retained provider-evolution baseline.',
          highlights: ['No prior matching baseline artifact was found.'],
        },
        evidence: {} as never,
      },
    })).toBe([
      'Loaded provider-evolution artifact artifact-1: Captured the first retained provider-evolution baseline.',
      '- No prior matching baseline artifact was found.',
      'Artifact: C:/tmp/provider-evolution/codex/artifact-1.json',
      '',
    ].join('\n'));
  });
});
