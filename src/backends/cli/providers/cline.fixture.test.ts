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
    for (const fixture of [
      'text.success.redacted.ndjson',
      'tool-use.success.redacted.ndjson',
      'tool-denied.aborted.redacted.ndjson',
    ]) {
      expect(normalize(fixture).filter((event) => event.type === 'raw')).toHaveLength(0);
    }
  });

  it('marks a denied tool call as an error even though output is an object', () => {
    // On failure `output` is `{ error }` rather than the success-path array. A
    // parser that only inspects arrays reports every failed tool as successful.
    const raw = readFixtureLines('tool-denied.aborted.redacted.ndjson').map((l) => JSON.parse(l));
    const denied = raw.find((line) => line.event?.type === 'content_end'
      && line.event?.contentType === 'tool');
    expect(Array.isArray(denied.event.output)).toBe(false);

    const results = normalize('tool-denied.aborted.redacted.ndjson')
      .filter((event) => event.type === 'tool_result');
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.isError).toBe(true);
      expect(result.text).toContain('Tool approval requires an interactive session');
    }
  });

  it('streams the reasoning channel as reasoning progress', () => {
    const events = normalize('tool-denied.aborted.redacted.ndjson');
    const reasoning = events.filter((event) => event.type === 'progress'
      && event.metadata?.kind === 'reasoning');

    expect(reasoning.length).toBeGreaterThan(0);
    expect(reasoning.map((event) => event.text).join('')).toContain('tools are blocked');
    // Reasoning must not leak into the assistant text channel.
    expect(events.filter((event) => event.type === 'text').map((event) => event.text).join(''))
      .not.toContain('tools are blocked');
  });

  it('terminates an aborted run from run_result rather than waiting for a stderr line', () => {
    const events = normalize('tool-denied.aborted.redacted.ndjson');
    const terminal = events.filter((event) => event.type === 'error' || event.type === 'result');

    // run_result is on stdout; the trailing `error` line is on stderr and never
    // reaches this parser. Terminating here is what keeps a failed turn from
    // degrading into a turn-timeout.
    expect(terminal.length).toBeGreaterThan(0);
    expect(terminal[0].type).toBe('error');
    expect(terminal[0].text).toContain('finishReason: aborted');
    expect(events.some((event) => event.type === 'result')).toBe(false);
  });

  it('reports a provider refusal from run_result text, not as a successful result', () => {
    const events = normalize('provider-error.balance.redacted.ndjson');
    const terminal = events.filter((event) => event.type === 'error' || event.type === 'result');

    // run_result carries finishReason "error" and zero usage; taking it at face
    // value would report a clean turn that cost nothing.
    expect(terminal.every((event) => event.type === 'error')).toBe(true);
    expect(terminal.some((event) => event.text?.includes('Insufficient balance'))).toBe(true);
    expect(events.some((event) => event.type === 'result')).toBe(false);
  });

  it('emits a terminal event from stdout alone, without the stderr error lines', () => {
    // Regression guard for the stream split found by the end-to-end run: the
    // fixtures were captured with `2>&1`, so they merge stderr into stdout. A
    // parser that depends on those `error` lines produces no terminal event at
    // all in the real runtime, which only feeds stdout to parseStreamLine.
    const stdoutOnly = readFixtureLines('provider-error.balance.redacted.ndjson')
      .filter((line) => JSON.parse(line).type !== 'error');
    const provider = new ClineProvider();
    const events = stdoutOnly.flatMap((line) => asEvents(provider.parseStreamLine(line)));

    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(events.find((event) => event.type === 'error')?.text)
      .toContain('Insufficient balance');
  });
});

describe('Cline 3.0.57 authenticated stream fixtures', () => {
  const fixture357Root = new URL(
    '../../../../docs/research/fixtures/cline-3.0.57/',
    import.meta.url,
  );

  function normalize357(name: string): StreamEvent[] {
    const provider = new ClineProvider();
    return readFileSync(fileURLToPath(new URL(name, fixture357Root)), 'utf8')
      .trim()
      .split(/\r?\n/)
      .flatMap((line) => asEvents(provider.parseStreamLine(line)));
  }

  it('streams tool output through content_update instead of dropping it as raw', () => {
    // 3.0.57 added content_update between the content_start call and the
    // content_end result. The 3.0.51 parser had no case for it, so tool output
    // arrived as unhandled raw events and never reached hosts.
    const events = normalize357('tool-use.success.redacted.ndjson');

    expect(events.some((event) => event.type === 'raw')).toBe(false);
    expect(events.filter((event) => event.type === 'tool_use')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1);

    const toolProgress = events.filter((event) => (
      event.type === 'progress'
      && event.metadata?.native?.sourceEvent === 'content_update'
    ));
    expect(toolProgress).toHaveLength(1);
    expect(toolProgress[0].text).toContain('probe-note.txt');
    expect(toolProgress[0].metadata?.native?.stream).toBe('stdout');
  });

  it('drops the empty chunks each tool stream opens with', () => {
    // Two of the three content_update events carry chunk: "" before the command
    // writes anything; emitting those would be pure noise on the host side.
    const raw = readFileSync(
      fileURLToPath(new URL('tool-use.success.redacted.ndjson', fixture357Root)),
      'utf8',
    )
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const updates = raw.filter((line) => line.event?.type === 'content_update');
    expect(updates).toHaveLength(3);
    expect(updates.filter((line) => line.event.update?.chunk === '')).toHaveLength(2);
  });
});
