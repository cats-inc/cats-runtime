import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from './types.js';
import { ClineProvider } from './cline.js';

const fixtureRoot = new URL('../../../../docs/research/fixtures/cline-3.0.51/', import.meta.url);

function readFixtureLines(name: string): string[] {
  return readFileSync(fileURLToPath(new URL(name, fixtureRoot)), 'utf8')
    .trim()
    .split(/\r?\n/);
}

function asEvents(event: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!event) return [];
  return Array.isArray(event) ? event : [event];
}

function normalize(name: string): StreamEvent[] {
  const provider = new ClineProvider();
  return readFixtureLines(name).flatMap((line) => asEvents(provider.parseStreamLine(line)));
}

describe('Cline 3.0.51 authenticated stream fixtures', () => {
  it('streams assistant text exactly once despite four copies in the stream', () => {
    // The same text appears as content_start deltas, again complete in
    // content_end, again in done.text, and again in run_result.text.
    const raw = readFixtureLines('text.success.redacted.ndjson').map((line) => JSON.parse(line));
    const copies = raw.filter((line) => {
      if (line.type === 'run_result') return typeof line.text === 'string';
      if (line.type !== 'agent_event') return false;
      return line.event?.type === 'done'
        || (line.event?.type === 'content_end' && line.event?.contentType === 'text');
    });
    expect(copies.length).toBe(3);

    const events = normalize('text.success.redacted.ndjson');
    expect(events.filter((event) => event.type === 'text').map((event) => event.text).join(''))
      .toBe('OK');
    expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
  });

  it('emits one result carrying reconciled aggregate usage', () => {
    const result = normalize('text.success.redacted.ndjson')
      .find((event) => event.type === 'result');

    expect(result).toBeDefined();
    expect(result?.usage).toMatchObject({
      inputTokens: 7802,
      outputTokens: 4,
      promptInputTokens: 7802,
      cacheReadInputTokens: 0,
      currency: 'USD',
    });
    // No session id exists anywhere in the stream; the result must not invent one.
    expect(result?.sessionId).toBeUndefined();
  });

  it('normalizes a tool round trip into paired tool_use and tool_result', () => {
    const events = normalize('tool-use.success.redacted.ndjson');

    const toolUse = events.find((event) => event.type === 'tool_use');
    expect(toolUse).toMatchObject({ toolName: 'read_files' });
    expect(toolUse?.toolId).toMatch(/^toolu_/);
    expect(toolUse?.toolArgs).toBeDefined();

    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult).toMatchObject({ toolName: 'read_files' });
    expect(toolResult?.toolId).toBe(toolUse?.toolId);
    expect(toolResult?.isError).toBeUndefined();
    expect(toolResult?.text).toContain('bravo');

    expect(events.filter((event) => event.type === 'text').map((event) => event.text).join(''))
      .toBe('bravo');
  });

  it('does not double count usage across the per-iteration usage events', () => {
    // The tool fixture carries two `usage` events whose running totals already
    // include the earlier call. Only run_result.aggregateUsage is used.
    const raw = readFixtureLines('tool-use.success.redacted.ndjson').map((line) => JSON.parse(line));
    const usageEvents = raw.filter((line) => line.event?.type === 'usage');
    expect(usageEvents.length).toBe(2);

    const results = normalize('tool-use.success.redacted.ndjson')
      .filter((event) => event.type === 'result');
    expect(results).toHaveLength(1);
    expect(results[0].usage).toMatchObject({
      inputTokens: 15906,
      outputTokens: 166,
      cacheReadInputTokens: 7806,
      promptInputTokens: 8100,
    });
  });

  it('surfaces the resume rejection as a normalized error', () => {
    const events = normalize('resume-rejected.error.redacted.ndjson');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect(events[0].text).toContain('JSON output mode requires a prompt argument');
  });

  it('drops metadata lines instead of leaking them as raw events', () => {
    const events = normalize('tool-use.success.redacted.ndjson');

    expect(events.filter((event) => event.type === 'raw')).toHaveLength(0);
  });
});
