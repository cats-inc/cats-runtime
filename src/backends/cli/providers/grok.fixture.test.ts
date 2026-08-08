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

function normalizeFixture(name: string): StreamEvent[] {
  const provider = new GrokProvider();
  return readFixture(name).raw.trim().split(/\r?\n/)
    .flatMap((line) => asEvents(provider.parseStreamLine(line)));
}

function fixtureText(name: string): string {
  return normalizeFixture(name)
    .filter((event) => event.type === 'text')
    .map((event) => event.text)
    .join('');
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

  it('normalizes observed tool success and failure lifecycles', () => {
    const success = normalizeFixture('tool-success.redacted.ndjson');
    const failure = normalizeFixture('tool-failure.redacted.ndjson');

    expect(success.filter((event) => event.type === 'tool_use')).toMatchObject([
      { toolName: 'search_replace', toolId: 'fixture-tool-call-1' },
      { toolName: 'read_file', toolId: 'fixture-tool-call-2' },
    ]);
    expect(success.filter((event) => event.type === 'tool_result')).toMatchObject([
      { toolName: 'search_replace', toolId: 'fixture-tool-call-1' },
      {
        toolName: 'read_file',
        toolId: 'fixture-tool-call-2',
        text: '1→CATS_GROK_TOOL_PROBE_OK\n',
      },
    ]);
    expect(failure.filter((event) => event.type === 'tool_result')).toMatchObject([
      {
        toolName: 'read_file',
        toolId: 'fixture-tool-call-3',
        isError: true,
      },
    ]);
    expect(fixtureText('tool-failure.redacted.ndjson')).toBe('CATS_GROK_TOOL_FAILURE_OK');
  });

  it('captures the only reliable permission boundary and unsafe alternatives', () => {
    const allowlist = readFixture('tool-allowlist-read-only.redacted.ndjson');
    const plan = readFixture('permission-plan-executes.redacted.ndjson');
    const disallowed = readFixture('permission-disallowed-tools-executes.redacted.ndjson');

    expect(allowlist.lines.some((line) => line.type === 'tool_call')).toBe(false);
    expect(plan.lines.some((line) => line.type === 'tool_call')).toBe(true);
    expect(disallowed.lines.some((line) => line.type === 'tool_call')).toBe(true);
  });

  it('normalizes model, auth, and toolset initialization errors', () => {
    expect(normalizeFixture('invalid-model.error.redacted.ndjson')).toMatchObject([
      { type: 'error', text: expect.stringContaining('unknown model id') },
    ]);
    expect(normalizeFixture('auth-missing.error.redacted.ndjson')).toMatchObject([
      { type: 'error', text: expect.stringContaining('Not signed in') },
    ]);
    expect(normalizeFixture('toolset-init-error.redacted.ndjson')).toMatchObject([
      { type: 'error', text: expect.stringContaining('Requirements unsatisfied') },
    ]);
  });

  it('preserves resume identity, fork identity, and conversation context', () => {
    const seed = readFixture('resume-seed.success.redacted.ndjson');
    const resumed = readFixture('resume.success.redacted.ndjson');
    const forked = readFixture('fork.success.redacted.ndjson');
    const seedSession = seed.lines.at(-1)?.sessionId;
    const resumedSession = resumed.lines.at(-1)?.sessionId;
    const forkedSession = forked.lines.at(-1)?.sessionId;

    expect(seedSession).toBeTruthy();
    expect(resumedSession).toBe(seedSession);
    expect(forkedSession).not.toBe(seedSession);
    expect(fixtureText('resume-seed.success.redacted.ndjson'))
      .toBe('CATS_GROK_RESUME_SEED_OK');
    expect(fixtureText('resume.success.redacted.ndjson'))
      .toBe('CATS_GROK_RESUME_TOKEN_82F1');
    expect(fixtureText('fork.success.redacted.ndjson'))
      .toBe('CATS_GROK_RESUME_TOKEN_82F1');
  });

  it('records cancellation as a partial stream without a terminal record', () => {
    const fixture = readFixture('cancellation.partial.redacted.ndjson');

    expect(fixture.lines.some((line) => line.type === 'text')).toBe(true);
    expect(fixture.lines.some((line) => line.type === 'end' || line.type === 'error'))
      .toBe(false);
  });

  it('contains only redacted machine- and account-specific evidence', () => {
    const fixtureNames = [
      'streaming-json.success.redacted.ndjson',
      'streaming-messages-json.success.redacted.ndjson',
      'tool-success.redacted.ndjson',
      'tool-failure.redacted.ndjson',
      'tool-allowlist-read-only.redacted.ndjson',
      'permission-plan-executes.redacted.ndjson',
      'permission-disallowed-tools-executes.redacted.ndjson',
      'toolset-init-error.redacted.ndjson',
      'invalid-model.error.redacted.ndjson',
      'auth-missing.error.redacted.ndjson',
      'cancellation.partial.redacted.ndjson',
      'resume-seed.success.redacted.ndjson',
      'resume.success.redacted.ndjson',
      'fork.success.redacted.ndjson',
    ];
    const fixtures = [
      ...fixtureNames.map((name) => readFixture(name).raw),
      readFileSync(fileURLToPath(new URL('models.success.redacted.txt', fixtureRoot)), 'utf8'),
    ].join('\n');

    expect(fixtures).toContain('<REDACTED_SIGNATURE>');
    expect(fixtures).toContain('<REDACTED_CWD>');
    expect(fixtures).toContain('<REDACTED_AUTH_SOURCE>');
    expect(fixtures).not.toMatch(/C:\\Users\\|AppData|cats-grok-(?:stream|lifecycle|adapter)-probe|sammy/i);
  });
});
