import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from './types.js';
import { GrokProvider } from './grok.js';

const fixtureRoot = new URL('../../../../docs/research/fixtures/grok-1.0.0/', import.meta.url);

function readFixture(name: string): { raw: string; lines: Array<Record<string, unknown>> } {
  const raw = readFileSync(fileURLToPath(new URL(name, fixtureRoot)), 'utf8');
  return {
    raw,
    lines: raw.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

function asEvents(event: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!event) return [];
  return Array.isArray(event) ? event : [event];
}

describe('Grok authenticated stream fixtures', () => {
  it('preserves and normalizes the observed native success sequence', () => {
    const fixture = readFixture('streaming-json.success.redacted.ndjson');
    const provider = new GrokProvider();
    const types = fixture.lines.map((line) => line.type);
    const normalized = fixture.raw.trim().split(/\r?\n/)
      .flatMap((line) => asEvents(provider.parseStreamLine(line)));

    expect(fixture.lines).toHaveLength(37);
    expect(types.filter((type) => type === 'available_commands')).toHaveLength(3);
    expect(types.filter((type) => type === 'thought')).toHaveLength(21);
    expect(types.filter((type) => type === 'text')).toHaveLength(11);
    expect(types.slice(-2)).toEqual(['usage', 'end']);
    expect(normalized.filter((event) => event.type === 'text').map((event) => event.text).join(''))
      .toBe('CATS_GROK_STREAM_PROBE_OK');
    expect(normalized.findLast((event) => event.type === 'result')).toMatchObject({
      type: 'result',
      sessionId: '00000000-0000-0000-0000-000000000001',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        currency: 'USD',
      },
    });
  });

  it('preserves the observed Messages-compatible partial-event sequence', () => {
    const fixture = readFixture('streaming-messages-json.success.redacted.ndjson');
    const streamEvents = fixture.lines.filter((line) => line.type === 'stream_event');
    const eventTypes = streamEvents.map((line) => (line.event as { type?: string }).type);
    const assistant = fixture.lines.find((line) => line.type === 'assistant') as {
      message: { content: Array<{ type: string; text?: string }> };
    };
    const result = fixture.lines.at(-1);

    expect(fixture.lines).toHaveLength(42);
    expect(fixture.lines[0]).toMatchObject({ type: 'system', subtype: 'init' });
    expect(streamEvents).toHaveLength(39);
    expect(eventTypes[0]).toBe('message_start');
    expect(eventTypes.at(-1)).toBe('message_stop');
    expect(eventTypes.filter((type) => type === 'content_block_delta')).toHaveLength(32);
    expect(assistant.message.content.find((block) => block.type === 'text')?.text)
      .toBe('CATS_GROK_STREAM_PROBE_OK');
    expect(result).toMatchObject({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'CATS_GROK_STREAM_PROBE_OK',
      stop_reason: 'end_turn',
    });
  });

  it('contains only redacted machine- and account-specific evidence', () => {
    const fixtures = [
      readFixture('streaming-json.success.redacted.ndjson').raw,
      readFixture('streaming-messages-json.success.redacted.ndjson').raw,
    ].join('\n');

    expect(fixtures).toContain('<REDACTED_SIGNATURE>');
    expect(fixtures).toContain('<REDACTED_CWD>');
    expect(fixtures).toContain('<REDACTED_AUTH_SOURCE>');
    expect(fixtures).not.toMatch(/C:\\Users\\|AppData|cats-grok-stream-probe/i);
  });
});
