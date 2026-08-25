import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from './types.js';
import { AntigravityProvider } from './antigravity.js';

const fixtureRoot = new URL(
  '../../../../docs/research/fixtures/antigravity-1.1.20/',
  import.meta.url,
);

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
  const provider = new AntigravityProvider();
  return readFixtureLines(name).flatMap((line) => asEvents(provider.parseStreamLine(line)));
}

function textOf(events: StreamEvent[]): string {
  return events.filter((event) => event.type === 'text').map((event) => event.text).join('');
}

function finalResponse(events: StreamEvent[]): string {
  const result = events.find((event) => event.type === 'result');
  return result?.text ?? '';
}

describe('Antigravity 1.1.20 recorded stream fixtures', () => {
  it('normalizes every line of the text turn with nothing left unknown', () => {
    const lines = readFixtureLines('text-turn.success.redacted.ndjson');
    const events = normalize('text-turn.success.redacted.ndjson');

    expect(lines).toHaveLength(5);
    expect(events.map((event) => event.type)).toEqual(['init', 'text', 'result']);
    expect(events.some((event) => event.type === 'raw')).toBe(false);
    expect(events[0].sessionId).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('reassembles streamed deltas into exactly the response the CLI reported', () => {
    const events = normalize('text-stream.success.redacted.ndjson');

    // The whole point of treating text_delta as a delta: concatenating the
    // streamed pieces has to reproduce result.response byte for byte. Treating
    // them as cumulative snapshots would repeat the transcript six times over.
    expect(events.filter((event) => event.type === 'text')).toHaveLength(6);
    expect(textOf(events)).toBe(finalResponse(events));
    expect(textOf(events)).toHaveLength(1667);
  });

  it('pairs the tool call with its completion and never emits raw passthrough', () => {
    const events = normalize('tool-turn.success.redacted.ndjson');
    const toolUse = events.filter((event) => event.type === 'tool_use');
    const toolResult = events.filter((event) => event.type === 'tool_result');

    expect(toolUse).toHaveLength(1);
    expect(toolResult).toHaveLength(1);
    expect(toolUse[0].toolName).toBe('list_dir');
    expect(toolResult[0].toolName).toBe('list_dir');
    expect(toolResult[0].toolId).toBe(toolUse[0].toolId);
    expect(toolResult[0].isError).toBeUndefined();
    expect(events.some((event) => event.type === 'raw')).toBe(false);
  });

  it('surfaces the headless permission denial as a failed tool result', () => {
    const events = normalize('tool-denied.error.redacted.ndjson');
    const toolResult = events.find((event) => event.type === 'tool_result');

    expect(toolResult?.isError).toBe(true);
    expect(toolResult?.text).toMatch(/permission check failed/);

    // agy still reports SUCCESS with an empty response on a turn whose only
    // tool was denied, so the failed tool step is the sole in-band signal.
    const result = events.find((event) => event.type === 'result');
    expect(result?.isError).toBeUndefined();
    expect(result?.text).toBeUndefined();
  });
});
