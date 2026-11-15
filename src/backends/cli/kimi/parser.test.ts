import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '../../../core/types.js';
import {
  createKimiParseState,
  parseKimiFailure,
  parseKimiStreamLine,
  readKimiTurnTelemetry,
} from './parser.js';

const fixtureRoot = new URL('../../../../tests/fixtures/provider-captures/kimi-2.5.3/', import.meta.url);

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, fixtureRoot)), 'utf8');
}

function replay(name: string): StreamEvent[] {
  const state = createKimiParseState();
  return fixture(name).split(/\r?\n/u).flatMap((line) => {
    const parsed = parseKimiStreamLine(line, undefined, state);
    return parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed];
  });
}

describe('Kimi Code 2.5.3 print-mode stream-json', () => {
  it('normalizes a text turn and takes the session id from the resume hint', () => {
    const events = replay('text-turn.success.stdout.redacted.ndjson');

    expect(events.map((event) => event.type)).toEqual(['progress', 'text', 'result']);
    expect(events[0]).toMatchObject({
      text: 'Kimi Code 2.5.3 started',
      metadata: { kind: 'status', status: 'started', provider: 'kimi', native: { version: '2.5.3' } },
    });
    expect(events[1]).toEqual({ type: 'text', text: 'OK' });
    expect(events[2]).toEqual({ type: 'result', sessionId: 'session_e2582112-778b-4af1-b02a-9f6f27f27822' });
  });

  it('pairs a tool call with its result and keeps the step texts in order', () => {
    const events = replay('tool-turn.success.stdout.redacted.ndjson');

    expect(events.map((event) => event.type))
      .toEqual(['progress', 'text', 'progress', 'tool_use', 'tool_result', 'text', 'result']);
    expect(events[1]).toEqual({ type: 'text', text: 'Reading the file.' });
    expect(events[2]).toMatchObject({ text: 'Running tool: Read', metadata: { kind: 'tool', status: 'running' } });
    expect(events[3]).toEqual({
      type: 'tool_use', toolName: 'Read', toolId: 'call_mock_1', toolArgs: { path: 'hello.txt' },
    });
    expect(events[4]).toEqual({ type: 'tool_result', toolId: 'call_mock_1', toolName: 'Read', text: '1\thello' });
    expect(events[5]).toEqual({ type: 'text', text: 'The file says hello.' });
    expect(events[6]).toEqual({ type: 'result', sessionId: 'session_40d3a7c9-b49e-4df6-875b-c62d6f616fe3' });
  });

  it('keeps multi-line and non-ASCII text of a resumed turn intact', () => {
    const events = replay('resume-turn.success.stdout.redacted.ndjson');

    expect(events.find((event) => event.type === 'text')).toEqual({ type: 'text', text: '第一行\nsecond line' });
    expect(events.at(-1)).toEqual({ type: 'result', sessionId: 'session_1f05d96e-47c2-40ca-a357-c0a3cf66f97c' });
  });

  it('writes only the version line to stdout when the turn fails', () => {
    for (const name of [
      'resume-missing.error.stdout.redacted.ndjson',
      'resume-other-directory.error.stdout.redacted.ndjson',
      'provider-api.error.stdout.redacted.ndjson',
      'model-not-configured.error.stdout.redacted.ndjson',
      'subscription-required.error.stdout.redacted.ndjson',
    ]) {
      expect(replay(name).map((event) => event.type), name).toEqual(['progress']);
    }
  });

  it('maps retry notices, the busy-session error frame and unknown frames', () => {
    const retry = parseKimiStreamLine(JSON.stringify({
      role: 'meta', type: 'turn.step.retrying', failed_attempt: 1, next_attempt: 2, max_attempts: 3,
      delay_ms: 1000, error_name: 'APIError', error_message: 'upstream 503', status_code: 503,
    }));
    expect(retry).toMatchObject({
      type: 'progress', text: 'Retrying the model request (attempt 2 of 3): upstream 503',
      metadata: { kind: 'status', status: 'running' },
    });

    expect(parseKimiStreamLine(JSON.stringify({
      type: 'error', code: 'session.occupied', message: 'Session is in use by another client.',
    }))).toMatchObject({ type: 'error', text: 'Session is in use by another client.' });

    expect(parseKimiStreamLine(JSON.stringify({ type: 'goal.summary', goalId: null }))).toBeNull();
    expect(parseKimiStreamLine(JSON.stringify({ role: 'meta', type: 'future.thing' }))).toBeNull();
    expect(parseKimiStreamLine(JSON.stringify({ role: 'assistant' }))).toBeNull();
    expect(parseKimiStreamLine('not json')).toEqual({ type: 'raw', text: 'not json' });
    expect(parseKimiStreamLine('   ')).toBeNull();
  });

  it('keeps tool calls whose arguments are not a JSON object', () => {
    const events = parseKimiStreamLine(JSON.stringify({
      role: 'assistant',
      tool_calls: [{ type: 'function', id: 'c1', function: { name: 'Bash', arguments: '{partial' } }],
    }));

    expect(events).toEqual([
      expect.objectContaining({ type: 'progress', text: 'Running tool: Bash' }),
      { type: 'tool_use', toolName: 'Bash', toolId: 'c1' },
    ]);
  });
});

describe('parseKimiFailure', () => {
  const stderr = (name: string) => fixture(name).split(/\r?\n/u);

  it('reads the failure sentence and drops the log path', () => {
    expect(parseKimiFailure(stderr('provider-api.error.stderr.redacted.txt'))).toEqual({
      message: 'provider.api_error: mock bad request', sessionUnavailable: false,
    });
    expect(parseKimiFailure(stderr('subscription-required.error.stderr.redacted.txt'))?.message)
      .toMatch(/^provider\.auth_error: Your current subscription does not have access to Kimi Code/u);
    expect(parseKimiFailure(stderr('model-not-configured.error.stderr.redacted.txt'))).toEqual({
      message: 'Model "kimi-code/k3" is not configured in config.toml.', sessionUnavailable: false,
    });
  });

  it('marks a missing session and a session bound to another directory as unavailable', () => {
    expect(parseKimiFailure(stderr('resume-missing.error.stderr.redacted.txt'))).toEqual({
      message: 'Session "session_00000000-0000-0000-0000-000000000000" not found.',
      sessionUnavailable: true,
    });
    expect(parseKimiFailure(stderr('resume-other-directory.error.stderr.redacted.txt'))).toMatchObject({
      sessionUnavailable: true,
    });
  });

  it('returns null when Kimi wrote no failure sentence', () => {
    expect(parseKimiFailure(['Warning: this folder is not trusted', ''])).toBeNull();
  });
});

describe('readKimiTurnTelemetry', () => {
  const wire = () => fixture('wire-two-turns.excerpt.redacted.jsonl');

  it('sums the newest turn only and reports the served model', () => {
    expect(readKimiTurnTelemetry(wire(), '__kimi_env_model__')).toEqual({
      usage: { inputTokens: 120, outputTokens: 7, totalTokens: 127, sourceConfidence: 'reported' },
      reportedModels: [{ model: 'mock-model', matchesRequest: true }],
    });
  });

  it('compares the alias the step used with the requested alias', () => {
    expect(readKimiTurnTelemetry(wire(), 'kimi-code/k3').reportedModels)
      .toEqual([{ model: 'mock-model', matchesRequest: false }]);
    expect(readKimiTurnTelemetry(wire()).reportedModels).toEqual([{ model: 'mock-model' }]);
  });

  it('counts cache reads separately and returns nothing for an empty journal', () => {
    const journal = [
      JSON.stringify({ type: 'turn.prompt', turnId: 0 }),
      JSON.stringify({ type: 'usage.record', usageScope: 'turn',
        usage: { inputOther: 10, inputCacheRead: 90, inputCacheCreation: 5, output: 3 } }),
      JSON.stringify({ type: 'usage.record', usageScope: 'session', usage: { inputOther: 999, output: 999 } }),
    ].join('\n');
    expect(readKimiTurnTelemetry(journal).usage).toEqual({
      inputTokens: 10, outputTokens: 3, cacheReadInputTokens: 90, cacheCreationInputTokens: 5,
      totalTokens: 108, sourceConfidence: 'reported',
    });
    expect(readKimiTurnTelemetry('')).toEqual({});
  });
});
