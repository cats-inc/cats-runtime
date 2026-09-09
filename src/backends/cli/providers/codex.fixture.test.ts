import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from './types.js';
import { CodexProvider } from './codex.js';

const fixtureRoot = new URL('../../../../docs/research/fixtures/codex-0.153.4/', import.meta.url);

function readFixtureLines(name: string): string[] {
  return readFileSync(fileURLToPath(new URL(name, fixtureRoot)), 'utf8')
    .trim()
    .split(/\r?\n/);
}

function asEvents(event: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!event) return [];
  return Array.isArray(event) ? event : [event];
}

describe('codex-cli 0.153.4 app-server fixtures', () => {
  it('normalizes the observed token-usage and rate-limit notifications of one turn', () => {
    const provider = new CodexProvider();
    const lines = readFixtureLines('app-server.rate-limits.redacted.ndjson');
    expect(lines.map((line) => (JSON.parse(line) as { method: string }).method)).toEqual([
      'thread/tokenUsage/updated',
      'account/rateLimits/updated',
      'turn/completed',
    ]);

    const events = lines.flatMap((line) => asEvents(provider.parseStreamLine(line)));
    expect(events.map((event) => event.type)).toEqual(['progress', 'result']);

    const resetsAt = new Date(1789593617 * 1000).toISOString();
    expect(events[0]).toEqual(expect.objectContaining({
      type: 'progress',
      text: `Codex rate limit: primary 1% used of 10080-minute window (resets ${resetsAt}); plan pro.`,
      metadata: expect.objectContaining({
        kind: 'quota',
        status: 'updated',
        provider: 'codex',
        quota: expect.objectContaining({
          source: 'codex.account/rateLimits/updated',
          limitId: 'codex',
          planType: 'pro',
          'primary.usedPercent': 1,
          'primary.windowDurationMins': 10080,
          'primary.resetsAt': resetsAt,
          'credits.hasCredits': false,
        }),
      }),
    }));

    expect(events[1]).toEqual(expect.objectContaining({
      type: 'result',
      usage: {
        inputTokens: 16574,
        outputTokens: 5,
        promptInputTokens: 4286,
        cacheReadInputTokens: 12288,
        cacheCreationInputTokens: 0,
        totalTokens: 16579,
      },
      metadata: {
        runtimeUsage: { quota: expect.objectContaining({ 'primary.usedPercent': 1 }) },
        native: {
          sourceEvent: 'turn/completed',
          tokenUsage: expect.objectContaining({ modelContextWindow: 258400 }),
        },
      },
    }));
  });
});
