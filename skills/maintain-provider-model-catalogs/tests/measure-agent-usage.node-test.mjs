// Keep this Node test out of Vitest's *.test.* auto-discovery.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { measureAgentUsage } from '../scripts/measure-agent-usage.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/measure-agent-usage.mjs');
const SECRET = 'SECRET-TRANSCRIPT-TEXT';

function withScratch(run) {
  const root = mkdtempSync(join(tmpdir(), 'agent-usage-test-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeLines(path, values) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join('\n')}\n`);
}

function claudeLine(id, timestamp, text, usage, model = 'claude-example') {
  return {
    type: 'assistant',
    timestamp,
    message: { id, model, content: [{ type: 'text', text }], usage },
  };
}

function claudeUsage(input, write, read, output) {
  return { input_tokens: input, cache_creation_input_tokens: write, cache_read_input_tokens: read, output_tokens: output };
}

test('claude counts each message once, includes subagents and splits phases', () => withScratch((root) => {
  const session = join(root, 'session-1.jsonl');
  writeLines(session, [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: `${SECRET} MARK-CAPTURE in a prompt` } },
    { ...claudeLine('m1', '2026-01-01T00:00:01Z', `${SECRET} reading`, claudeUsage(1, 10, 100, 1)), cwd: 'MARK-CAPTURE' },
    claudeLine('m1', '2026-01-01T00:00:01Z', 'second block', claudeUsage(1, 10, 100, 5)),
    { type: 'user', timestamp: '2026-01-01T00:00:02Z', message: { content: [{ type: 'tool_result', content: 'MARK-CAPTURE' }] } },
    claudeLine('m2', '2026-01-01T00:00:03Z', 'run MARK-CAPTURE in C:\\capture\\dir', claudeUsage(2, 20, 200, 7)),
    claudeLine('m9', '2026-01-01T00:00:04Z', 'API error', claudeUsage(0, 0, 0, 0), '<synthetic>'),
    'not json',
    claudeLine('m3', '2026-01-01T00:10:00Z', 'wrap up', claudeUsage(3, 30, 300, 9)),
  ]);
  writeLines(join(root, 'session-1', 'subagents', 'agent-a.jsonl'), [
    claudeLine('s1', '2026-01-01T00:05:00Z', 'subagent', claudeUsage(4, 40, 400, 11), 'claude-small'),
  ]);

  const result = measureAgentUsage({
    host: 'claude',
    path: session,
    phaseStarts: ['text:MARK-CAPTURE', 'at:2026-01-01T00:06:00Z'],
    phaseNames: ['Prep', 'Capture', 'Wrap'],
  });
  assert.deepEqual(result.sources, ['session-1.jsonl', 'agent-a.jsonl']);
  assert.equal(result.skippedLines, 1);
  assert.deepEqual(result.totals, {
    calls: 4, uncachedInput: 10, cacheWrite: 100, cacheRead: 1000, output: 32,
    from: '2026-01-01T00:00:01.000Z', to: '2026-01-01T00:10:00.000Z',
  });
  assert.deepEqual(Object.keys(result.byModel), ['claude-example', 'claude-small']);
  assert.deepEqual(result.phases.map((phase) => [phase.phase, phase.firstCall, phase.calls, phase.output]),
    [['Prep', 1, 1, 5], ['Capture', 2, 2, 18], ['Wrap', 4, 1, 9]]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|reading|MARK/);
  const byPath = measureAgentUsage({ host: 'claude', path: session, phaseStarts: ['text:C:\\capture\\dir'] });
  assert.deepEqual(byPath.phases.map((phase) => phase.calls), [1, 3]);
}));

test('codex uses per-call deltas, skips repeated counts and reads the model context', () => withScratch((root) => {
  const rollout = join(root, 'rollout-example.jsonl');
  const count = (timestamp, total, last) => ({
    timestamp, type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } },
  });
  const usage = (input, cached, output, reasoning) => ({
    input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0,
    output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output,
  });
  writeLines(rollout, [
    { timestamp: '2026-01-01T00:00:00Z', type: 'turn_context', payload: { model: 'gpt-example' } },
    { timestamp: '2026-01-01T00:00:01Z', type: 'response_item', payload: { type: 'message', role: 'user', content: 'MARK-CAPTURE' } },
    count('2026-01-01T00:00:02Z', usage(1100, 1000, 50, 10), usage(100, 0, 50, 10)),
    count('2026-01-01T00:00:03Z', usage(1100, 1000, 50, 10), usage(100, 0, 50, 10)),
    { timestamp: '2026-01-01T00:00:04Z', type: 'response_item', payload: { type: 'function_call_output', output: 'MARK-CAPTURE' } },
    { timestamp: '2026-01-01T00:00:05Z', type: 'response_item', payload: { type: 'function_call', arguments: `${SECRET} MARK-CAPTURE` } },
    count('2026-01-01T00:00:06Z', usage(1500, 1300, 80, 20), usage(400, 300, 30, 10)),
    { timestamp: '2026-01-01T00:00:07Z', type: 'turn_context', payload: { model: 'gpt-other' } },
    count('2026-01-01T00:00:08Z', usage(10, 5, 2, 1), usage(10, 5, 2, 1)),
  ]);

  const result = measureAgentUsage({ host: 'codex', path: rollout, phaseStarts: ['text:MARK-CAPTURE'] });
  assert.deepEqual(result.byModel, {
    'gpt-example': { calls: 2, uncachedInput: 200, cacheWrite: 0, cacheRead: 300, output: 80, reasoningOutput: 20 },
    'gpt-other': { calls: 1, uncachedInput: 5, cacheWrite: 0, cacheRead: 5, output: 2, reasoningOutput: 1 },
  });
  assert.deepEqual(result.phases.map((phase) => [phase.firstCall, phase.calls]), [[1, 1], [2, 2]]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|MARK/);
}));

test('junie sums usage and cost per call and splits by turn or time', () => withScratch((root) => {
  const session = join(root, 'session-example');
  const usageEvent = (timestampMs, model, input, read, write, output, cost) => ({
    kind: 'SessionA2uxEvent',
    timestampMs,
    event: { agentEvent: { kind: 'LlmResponseMetadataEvent', modelUsage: [{
      model, cost, inputTokens: input, cacheInputTokens: read, cacheCreateTokens: write, outputTokens: output,
    }] } },
  });
  writeLines(join(session, 'events.jsonl'), [
    { kind: 'UserPromptEvent', timestampMs: 1000, prompt: SECRET },
    usageEvent(2000, 'main-model', 10, 100, 1000, 5, 0.25),
    usageEvent(3000, 'helper-model', 1, 0, 0, 1, 0.001),
    { kind: 'UserPromptEvent', timestampMs: 4000, prompt: SECRET },
    usageEvent(5000, 'main-model', 20, 200, 0, 7, 0.5),
  ]);

  const byTurn = measureAgentUsage({ host: 'junie', path: session, phaseStarts: ['turn:2'] });
  assert.deepEqual(byTurn.totals, {
    calls: 3, uncachedInput: 31, cacheWrite: 1000, cacheRead: 300, output: 13, costUsd: 0.751,
    from: '1970-01-01T00:00:02.000Z', to: '1970-01-01T00:00:05.000Z',
  });
  assert.deepEqual(byTurn.phases.map((phase) => [phase.calls, phase.costUsd]), [[2, 0.251], [1, 0.5]]);
  const byTime = measureAgentUsage({ host: 'junie', path: session, phaseStarts: ['at:1970-01-01T00:00:03Z'] });
  assert.deepEqual(byTime.phases.map((phase) => phase.calls), [1, 2]);
  assert.doesNotMatch(JSON.stringify(byTurn), /SECRET/);
  assert.throws(() => measureAgentUsage({ host: 'junie', path: session, phaseStarts: ['text:x'] }),
    /does not support text: phase starts/);
  assert.throws(() => measureAgentUsage({ host: 'junie', path: join(root, 'missing') }), /events\.jsonl/);
}));

test('auggie reads each exchange token_usage and splits by text, time or turn', () => withScratch((root) => {
  const path = join(root, 'auggie-session.json');
  const exchange = (message, ms, text, usage, model = 'auggie-model') => ({
    exchange: {
      request_message: message, model_id: model,
      request_nodes: [{ type: 1, tool_result_node: { content: `${SECRET} MARK-CAPTURE in a tool result` } }],
      response_nodes: [
        { type: 8, thinking: { summary: `${SECRET} MARK-WRAP thinking` }, timestamp_ms: ms },
        { type: 0, content: text, timestamp_ms: ms },
        { type: 5, tool_use: { tool_name: 'launch-process', input_json: `{"command":"${text}"}` }, timestamp_ms: ms },
        ...(usage ? [{ type: 10, token_usage: {
          input_tokens: usage[0], cache_creation_input_tokens: usage[1], cache_read_input_tokens: usage[2],
          output_tokens: usage[3], system_prompt_tokens: 999, max_context_tokens: 200000,
        }, timestamp_ms: ms }] : []),
      ],
    },
    finishedAt: new Date(ms).toISOString(),
  });
  writeFileSync(path, JSON.stringify({
    sessionId: 'auggie-session', agentState: { userEmail: SECRET },
    subAgentCreditsUsed: 0, subAgentCostUsd: 0,
    chatHistory: [
      exchange(`${SECRET} first request`, 1000, 'reading the skill', [2, 100, 1000, 10]),
      exchange('', 2000, 'run MARK-CAPTURE now', [1, 20, 1100, 30]),
      exchange('', 2500, 'no usage recorded', null),
      exchange('', 3000, 'MARK-WRAP and report', [3, 0, 1200, 5]),
      exchange(`${SECRET} second request`, 4000, 'second turn', [4, 50, 500, 7], 'auggie-other'),
    ],
  }));

  const result = measureAgentUsage({ host: 'auggie', path,
    phaseStarts: ['text:MARK-CAPTURE', 'text:MARK-WRAP', 'turn:2'], phaseNames: ['Prep', 'Capture', 'Wrap', 'Second'] });
  assert.deepEqual(result.totals, {
    calls: 4, uncachedInput: 10, cacheWrite: 170, cacheRead: 3800, output: 52,
    from: '1970-01-01T00:00:01.000Z', to: '1970-01-01T00:00:04.000Z',
  });
  assert.deepEqual(Object.keys(result.byModel), ['auggie-model', 'auggie-other']);
  assert.deepEqual(result.phases.map((phase) => [phase.phase, phase.firstCall, phase.calls, phase.output]),
    [['Prep', 1, 1, 10], ['Capture', 2, 1, 30], ['Wrap', 3, 1, 5], ['Second', 4, 1, 7]]);
  assert.deepEqual(result.subAgents, { credits: 0, costUsd: 0 });
  assert.doesNotMatch(JSON.stringify(result), /SECRET|reading the skill|MARK/);
  const byTime = measureAgentUsage({ host: 'auggie', path, phaseStarts: ['at:1970-01-01T00:00:02.500Z'] });
  assert.deepEqual(byTime.phases.map((phase) => phase.calls), [2, 2]);
  writeFileSync(path, JSON.stringify({ sessionId: 'x' }));
  assert.throws(() => measureAgentUsage({ host: 'auggie', path }), /no chatHistory array/);
}));

function writeKiroSession(root, sessionId) {
  const metering = (values) => values.map((value) => ({ value, unit: 'credit', unitPlural: 'credits' }));
  const turn = (requests, secs, context, meteringValues, inputTokens = 0) => ({
    total_request_count: requests, turn_duration: { secs, nanos: 5 }, model: 'example-model',
    input_token_count: inputTokens, output_token_count: 0, cache_read_input_token_count: 0,
    cache_write_input_token_count: 0, context_usage_percentage: context, metering_usage: metering(meteringValues),
  });
  writeFileSync(join(root, `${sessionId}.json`), JSON.stringify({
    session_id: sessionId,
    session_state: { conversation_metadata: { user_turn_metadatas: [
      turn(4, 60, 12.5, [0.5, 0.25, 1, 2]),
      turn(3, 30, 20, [1, 1], 10),
    ] } },
  }));
  const line = (kind, text) => ({ version: 'v1', kind, data: { content: [{ kind: 'text', data: text }] } });
  writeLines(join(root, `${sessionId}.jsonl`), [
    line('Prompt', `${SECRET} first request`),
    line('AssistantMessage', 'reading the skill'),
    line('ToolResults', `${SECRET} MARK-CAPTURE in a tool result`),
    line('AssistantMessage', 'run MARK-CAPTURE now'),
    line('AssistantMessage', 'still capturing'),
    line('AssistantMessage', 'MARK-WRAP and report'),
    line('Prompt', `${SECRET} second request`),
    line('AssistantMessage', 'one'),
    line('AssistantMessage', 'two'),
    line('AssistantMessage', 'three'),
    line('Prompt', `${SECRET} third request, still running`),
    line('AssistantMessage', 'working'),
  ]);
  return join(root, `${sessionId}.json`);
}

test('kiro reports turn credits, pairs call credits and splits phases', () => withScratch((root) => {
  const path = writeKiroSession(root, '00000000-1111-2222-3333-444444444444');
  const result = measureAgentUsage({
    host: 'kiro',
    path,
    phaseStarts: ['text:MARK-CAPTURE', 'text:MARK-WRAP', 'turn:2', 'turn:3'],
    phaseNames: ['Prep', 'Capture', 'Wrap', 'Second', 'Running'],
  });
  assert.deepEqual(result.turns.map((turn) => [turn.turn, turn.recorded, turn.requests, turn.credits, turn.tokensRecorded]),
    [[1, true, 4, 3.75, false], [2, true, 3, 2, true], [3, false, undefined, undefined, undefined]]);
  assert.equal(result.turns[0].durationSeconds, 60);
  assert.equal(result.turns[0].contextUsagePercent, 12.5);
  assert.deepEqual(result.recordedTurnTotals, { turns: 2, requests: 7, credits: 5.75 });
  assert.deepEqual(result.phases.map((phase) => [phase.phase, phase.firstCall, phase.calls, phase.credits, phase.callsWithoutCredits]), [
    ['Prep', 1, 1, 0.5, undefined],
    ['Capture', 2, 2, 1.25, undefined],
    ['Wrap', 4, 1, 2, undefined],
    ['Second', 5, 3, 0, 3],
    ['Running', 8, 1, 0, 1],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|reading the skill|MARK/);
  assert.throws(() => measureAgentUsage({ host: 'kiro', path, phaseStarts: ['text:NOT-PRESENT'] }), /was not found/);
  assert.throws(() => measureAgentUsage({ host: 'kiro', path, phaseStarts: ['at:2026-01-01T00:00:00Z'] }),
    /does not support at: phase starts/);
}));

test('rejects malformed phase starts and unpaired names', () => withScratch((root) => {
  const path = writeKiroSession(root, 'session');
  assert.throws(() => measureAgentUsage({ host: 'kiro', path, phaseStarts: ['text:MARK-CAPTURE'], phaseNames: ['only'] }),
    /one more --phase-name/);
  assert.throws(() => measureAgentUsage({ host: 'kiro', path, phaseStarts: ['MARK-CAPTURE'] }), /must be at:/);
  assert.throws(() => measureAgentUsage({ host: 'junie', path: root, phaseStarts: ['at:2026-01-01T00:00:00'] }),
    /with a zone/);
  assert.throws(() => measureAgentUsage({ host: 'kiro', path, phaseStarts: ['turn:0'] }), /1-based turn/);
  assert.throws(() => measureAgentUsage({ host: 'other', path }), /Unknown host/);
}));

test('the command line prints JSON and rejects a path-like KIRO_SESSION_ID', () => withScratch((root) => {
  const path = writeKiroSession(root, 'session');
  const ok = spawnSync(process.execPath, [SCRIPT, 'kiro', path, '--phase-start', 'turn:2'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).phases.length, 2);
  assert.doesNotMatch(ok.stdout, /SECRET/);

  const unsafe = spawnSync(process.execPath, [SCRIPT, 'kiro'], {
    encoding: 'utf8',
    env: { ...process.env, KIRO_SESSION_ID: '..\\outside' },
  });
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stderr, /unexpected characters/);
}));
