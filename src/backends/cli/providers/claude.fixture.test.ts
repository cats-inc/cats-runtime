import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from './types.js';
import { ClaudeProvider } from './claude.js';

const fixtureRoot = new URL('../../../../docs/research/fixtures/claude-2.1.267/', import.meta.url);

function readFixtureLines(name: string): string[] {
  return readFileSync(fileURLToPath(new URL(name, fixtureRoot)), 'utf8')
    .trim()
    .split(/\r?\n/);
}

function asEvents(event: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!event) return [];
  return Array.isArray(event) ? event : [event];
}

describe('Claude Code 2.1.267 stream-json fixtures', () => {
  it('normalizes the observed rate-limit and cost frames of a subscription-backed turn', () => {
    const provider = new ClaudeProvider();
    const lines = readFixtureLines('stream-json.rate-limit.redacted.ndjson');
    const rawTypes = lines.map((line) => {
      const frame = JSON.parse(line) as { type: string; subtype?: string };
      return frame.subtype ? `${frame.type}:${frame.subtype}` : frame.type;
    });
    expect(rawTypes.filter((type) => type === 'rate_limit_event')).toHaveLength(2);
    expect(rawTypes.at(-1)).toBe('result:success');

    const events = lines.flatMap((line) => asEvents(provider.parseStreamLine(line)));
    const quotaEvents = events.filter((event) =>
      event.type === 'progress' && event.metadata?.kind === 'quota',
    );
    expect(quotaEvents).toHaveLength(2);
    expect(quotaEvents[0]?.metadata?.quota).toEqual(expect.objectContaining({
      source: 'claude.rate_limit_event',
      status: 'allowed',
      rateLimitType: 'five_hour',
      'five_hour.utilization': 0.07,
      'seven_day.utilization': 0.01,
    }));
    expect(quotaEvents[1]?.metadata?.quota).toEqual(expect.objectContaining({
      'seven_day_overage_included.utilization': 0.02,
      isUsingOverage: false,
      overageStatus: 'rejected',
    }));

    expect(events.some((event) => event.type === 'text' && event.text === 'ok')).toBe(true);

    const result = events.find((event) => event.type === 'result');
    expect(result?.usage).toEqual({
      inputTokens: 22781,
      outputTokens: 4,
      promptInputTokens: 2,
      cacheReadInputTokens: 15055,
      cacheCreationInputTokens: 7724,
      estimatedCost: expect.closeTo(0.1594, 4),
      currency: 'USD',
    });
    expect(result?.metadata).toEqual({
      runtimeUsage: {
        quota: expect.objectContaining({ 'seven_day_overage_included.utilization': 0.02 }),
      },
      native: expect.objectContaining({
        sourceEvent: 'result',
        subtype: 'success',
        isError: false,
        numTurns: 1,
        durationMs: 4323,
        durationApiMs: 5275,
        modelUsage: expect.objectContaining({
          'claude-fable-5-1': expect.objectContaining({
            contextWindow: 1000000,
            costUSD: expect.closeTo(0.1585, 4),
          }),
        }),
      }),
    });
  });
});
