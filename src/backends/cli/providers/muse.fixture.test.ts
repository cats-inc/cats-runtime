import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from './types.js';
import { MuseProvider } from './muse.js';

const fixtureRoot = new URL('../../../../docs/research/fixtures/muse-1.0.3/', import.meta.url);

interface MuseFixtureRecord {
  payload_type?: string;
  stream?: { kind?: string; id?: string };
  payload?: Record<string, unknown>;
}

function readFixture(name: string): { raw: string; records: MuseFixtureRecord[] } {
  const raw = readFileSync(fileURLToPath(new URL(name, fixtureRoot)), 'utf8');
  return {
    raw,
    records: raw.trim().split(/\r?\n/).map((line) => JSON.parse(line) as MuseFixtureRecord),
  };
}

function asEvents(event: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!event) return [];
  return Array.isArray(event) ? event : [event];
}

function normalizeFixture(name: string): StreamEvent[] {
  const provider = new MuseProvider();
  return readFixture(name).raw.trim().split(/\r?\n/)
    .flatMap((line) => asEvents(provider.parseStreamLine(line)));
}

function fixtureText(name: string): string {
  return normalizeFixture(name)
    .filter((event) => event.type === 'text')
    .map((event) => event.text)
    .join('');
}

describe('Meta Muse exec --json fixtures', () => {
  it('normalizes the observed tool-calling success sequence', () => {
    const { records } = readFixture('tool-success.redacted.ndjson');
    const events = normalizeFixture('tool-success.redacted.ndjson');
    const payloadTypes = records.map((record) => record.payload_type);

    expect(records).toHaveLength(35);
    expect(payloadTypes[0]).toBe('runtime.command.accepted');
    expect(payloadTypes.at(-1)).toBe('run.terminal.completed');
    expect(payloadTypes.filter((type) => type === 'run.output.delta')).toHaveLength(2);
    expect(payloadTypes.filter((type) => type === 'tool.result')).toHaveLength(1);

    expect(fixtureText('tool-success.redacted.ndjson')).toBe('bravo');
    expect(events[0]).toMatchObject({
      type: 'init',
      sessionId: '00000000-0000-0000-0000-000000000001',
    });
    expect(events.filter((event) => event.type === 'init')).toHaveLength(1);
    expect(events.findLast((event) => event.type === 'result')).toMatchObject({
      type: 'result',
      sessionId: '00000000-0000-0000-0000-000000000001',
    });

    expect(events.find((event) => event.type === 'tool_use')).toMatchObject({
      type: 'tool_use',
      toolName: 'read_file',
    });
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      type: 'tool_result',
      toolName: 'read_file',
      text: 'Read text file `notes.txt`.\n1|alpha\n2|bravo\n3|charlie',
    });
  });

  it('replays the echo provider stream, which never reaches the model', () => {
    const { records } = readFixture('echo-provider.success.redacted.ndjson');
    expect(records).toHaveLength(13);
    // The echo provider proves the record envelope is the same with no account
    // involved, which is what makes this fixture reproducible offline.
    expect(records.some((record) => record.payload_type === 'run.model.configured')).toBe(false);
    expect(fixtureText('echo-provider.success.redacted.ndjson')).toBe('echo: hello from cats');
  });

  it('carries the resumed session id through a --session-id turn', () => {
    const seed = readFixture('resume-seed.success.redacted.ndjson');
    const resumed = readFixture('resume.success.redacted.ndjson');

    // Both turns were recorded against one session id, which is exactly what
    // `muse exec --session-id <uuid>` resumes.
    expect(seed.records[0]?.stream).toEqual({ kind: 'session', id: '00000000-0000-0000-0000-000000000001' });
    expect(resumed.records[0]?.stream).toEqual({ kind: 'session', id: '00000000-0000-0000-0000-000000000001' });

    expect(fixtureText('resume-seed.success.redacted.ndjson')).toBe('OK');
    // The second turn recalled the codeword the first turn was told, so the
    // resume carried conversation state and not just the id.
    expect(fixtureText('resume.success.redacted.ndjson')).toBe('TANGERINE');
  });

  it('records that the capability switches, not approval mode, are what gate tools', () => {
    // Two runs of the same "write a file" prompt. Under --approval-mode
    // untrusted muse still called write_file and succeeded; under
    // --disable-write --disable-shell --disable-web-tools it called no tool at
    // all and said so. This pair is the evidence behind the provider's
    // fail-safe default mode.
    const untrusted = readFixture('approval-untrusted-executes.redacted.ndjson');
    const readOnly = readFixture('read-only-capability-toggles.redacted.ndjson');

    const untrustedTools = untrusted.records
      .filter((record) => record.payload_type === 'tool.result')
      .map((record) => (record.payload?.correlation_facts as { tool_name?: string })?.tool_name);
    expect(untrustedTools).toEqual(['write_file']);

    expect(readOnly.records.some((record) => record.payload_type === 'tool.result')).toBe(false);
    expect(readOnly.records.some((record) => {
      const taskKind = (record.payload?.event as { task_kind?: string })?.task_kind;
      return typeof taskKind === 'string' && taskKind.startsWith('tool.');
    })).toBe(false);
    expect(fixtureText('read-only-capability-toggles.redacted.ndjson'))
      .toContain('file writes and shell execution are disabled');
  });

  it('leaves no fixture record unrecognized by the parser', () => {
    const fixtures = [
      'tool-success.redacted.ndjson',
      'echo-provider.success.redacted.ndjson',
      'resume-seed.success.redacted.ndjson',
      'resume.success.redacted.ndjson',
      'approval-untrusted-executes.redacted.ndjson',
      'read-only-capability-toggles.redacted.ndjson',
    ];

    for (const fixture of fixtures) {
      const events = normalizeFixture(fixture);
      // A `raw` event is the parser's "I do not know this record" fallback.
      expect(events.filter((event) => event.type === 'raw')).toEqual([]);
    }
  });
});
