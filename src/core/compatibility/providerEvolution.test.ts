import { describe, expect, it } from 'vitest';
import {
  ProviderEvolutionEvidenceCollector,
  observeIgnored,
  observeNormalized,
  observeRawPassthrough,
  observeSchemaFailure,
  observeUnknown,
} from './providerEvolution.js';

describe('ProviderEvolutionEvidenceCollector', () => {
  it('assembles bounded evidence bundles with normalized and dropped-path summaries', () => {
    let now = Date.parse('2026-03-27T00:00:00.000Z');
    const collector = new ProviderEvolutionEvidenceCollector({
      provider: 'codex',
      instance: 'default',
      parserId: 'codex-json-rpc',
      probeProfile: 'manual-smoke',
      transport: 'cli',
      version: '1.2.3',
    }, {
      now: () => now,
      maxRawSamples: 2,
      maxNormalizedSamples: 1,
    });

    observeNormalized(collector, {
      rawEventType: 'turn/completed',
      rawSample: { type: 'turn/completed' },
    }, {
      type: 'result',
    });
    now += 1000;
    observeIgnored(collector, {
      rawEventType: 'thread/status/changed',
      reason: 'informational_notification',
      rawSample: { method: 'thread/status/changed' },
    }, null);
    now += 1000;
    observeSchemaFailure(collector, {
      rawEventType: 'session.start',
      reason: 'missing_session_id',
      rawSample: { type: 'session.start' },
    }, null);
    now += 1000;
    observeUnknown(collector, {
      rawEventType: 'future.event',
      rawSample: { type: 'future.event' },
    }, null);
    now += 1000;
    observeRawPassthrough(collector, {
      reason: 'non_json_line',
      rawSample: 'plain output',
    }, null);

    const bundle = collector.finalize();
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.provider).toBe('codex');
    expect(bundle.instance).toBe('default');
    expect(bundle.version).toBe('1.2.3');
    expect(bundle.transport).toBe('cli');
    expect(bundle.summary.normalizedCount).toBe(1);
    expect(bundle.summary.ignoredCount).toBe(1);
    expect(bundle.summary.schemaFailureCount).toBe(1);
    expect(bundle.summary.unknownCount).toBe(1);
    expect(bundle.summary.rawPassthroughCount).toBe(1);
    expect(bundle.summary.normalizedEventTypes.result).toBe(1);
    expect(bundle.summary.ignoredEventTypes['thread/status/changed']).toBe(1);
    expect(bundle.summary.schemaFailureCounts['session.start']).toBe(1);
    expect(bundle.summary.unknownEventTypes['future.event']).toBe(1);
    expect(bundle.summary.rawPassthroughEventTypes.non_json_line).toBe(1);
    expect(bundle.normalizedSamples).toHaveLength(1);
    expect(bundle.rawSamples).toHaveLength(2);
    expect(bundle.lastObservedAt).toBe('2026-03-27T00:00:04.000Z');
  });
});
