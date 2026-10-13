import { describe, expect, it } from 'vitest';
import { KiroProvider } from './kiro.js';

const SESSION = 'sess_bf2f8dc1-edb6-4351-83d8-be77cff7de18';
const HEADLESS = ['chat', '--no-interactive', '--agent-engine', 'v3', '--output-format', 'stream-json'];

const frame = (type: string, data: unknown) => JSON.stringify({ type, data });
const update = (body: Record<string, unknown>) => frame('sessionUpdate', { sessionId: SESSION, update: body });
const sessionInfo = (kiro: Record<string, unknown>) => update({ sessionUpdate: 'session_info_update', _meta: { kiro } });

function startedProvider(model = 'claude-haiku-4.5'): KiroProvider {
  const provider = new KiroProvider();
  provider.prepareEphemeralTurn({ message: 'Read notes.txt' });
  provider.buildSpawnArgs({ cwd: '/tmp/repo', model });
  expect(provider.parseStreamLine(frame('runStarted', { payloadSchema: 'acp', acpProtocolVersion: 1, engine: 'v3' })))
    .toBeNull();
  return provider;
}

describe('KiroProvider', () => {
  it('runs the V3 engine headless, resumes by id and sends the prompt over stdin', () => {
    const provider = new KiroProvider();
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    expect(provider.buildSpawnArgs({
      cwd: '/tmp/repo',
      model: 'claude-sonnet-4.5',
      resumeSessionId: SESSION,
      permissionMode: 'skip',
    })).toEqual([...HEADLESS, '--model', 'claude-sonnet-4.5', '--trust-all-tools', '--resume-id', SESSION]);
    expect(provider.buildStdinMessage('Say hi')).toBe('Say hi');
    // The prompt is consumed by the spawn that carries it.
    expect(provider.buildStdinMessage('Say hi')).toBe('');
  });

  it('trusts only the listed tools in whitelist mode and nothing in default mode', () => {
    const provider = new KiroProvider();
    expect(provider.buildSpawnArgs({
      cwd: '/tmp/repo', permissionMode: 'whitelist', allowedTools: ['read_file', 'fs_write'],
    })).toEqual([...HEADLESS, '--trust-tools=read_file,fs_write']);
    expect(provider.buildSpawnArgs({ cwd: '/tmp/repo', permissionMode: 'default' })).toEqual(HEADLESS);
    expect(provider.capabilities).toEqual({ resume: true, fork: false, permissions: false });
  });

  it('passes the selected effort after the model and omits it when absent', () => {
    const provider = new KiroProvider();

    expect(provider.buildSpawnArgs({
      cwd: '/tmp/repo',
      model: 'gpt-5.6-sol',
      modelControls: { 'kiro.reasoning_effort': 'none' },
    })).toEqual([...HEADLESS, '--model', 'gpt-5.6-sol', '--effort', 'none']);
    expect(provider.buildSpawnArgs({ cwd: '/tmp/repo', model: 'auto', modelControls: {} }))
      .toEqual([...HEADLESS, '--model', 'auto']);
    // Another provider's control is never forwarded as a Kiro flag.
    expect(provider.buildSpawnArgs({
      cwd: '/tmp/repo', model: 'claude-haiku-4.5',
      modelControls: { 'claude.reasoning_effort': 'high' },
    })).not.toContain('--effort');
  });

  it('rejects a non-string or control-character effort instead of emitting it', () => {
    const provider = new KiroProvider();

    for (const effort of [true, '', ' ', 'low\nhigh']) {
      expect(() => provider.buildSpawnArgs({
        cwd: '/tmp/repo',
        model: 'claude-opus-5',
        modelControls: { 'kiro.reasoning_effort': effort },
      })).toThrow('Unsupported Kiro reasoning effort.');
    }
  });

  it('announces the session, streams thought, tool and text updates, and ends with the served model', () => {
    const provider = startedProvider();

    expect(provider.parseStreamLine(update({
      sessionUpdate: 'config_option_update',
      configOptions: [
        { id: 'model', currentValue: 'claude-haiku-4.5' },
        { id: 'effortLevel', currentValue: 'high' },
      ],
    }))).toEqual([{
      type: 'init',
      sessionId: SESSION,
      metadata: { native: { sourceEvent: 'sessionUpdate', engine: 'v3' } },
    }]);
    expect(provider.parseStreamLine(update({ sessionUpdate: 'available_commands_update', availableCommands: [] })))
      .toBeNull();

    expect(provider.parseStreamLine(update({
      sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Looking at notes.txt' },
    }))).toEqual([expect.objectContaining({
      type: 'progress',
      text: 'Looking at notes.txt',
      metadata: expect.objectContaining({ kind: 'reasoning', status: 'running', provider: 'kiro' }),
    })]);

    expect(provider.parseStreamLine(update({
      sessionUpdate: 'tool_call',
      toolCallId: 'tooluse_1',
      title: 'Read File',
      kind: 'read',
      locations: [{ path: 'C:\\repo\\notes.txt' }],
      rawInput: { path: 'notes.txt', offset: null, limit: null },
    }))).toEqual([{
      type: 'tool_use',
      toolId: 'tooluse_1',
      toolName: 'Read File',
      toolArgs: { path: 'notes.txt', offset: null, limit: null },
      metadata: {
        native: {
          sourceEvent: 'session/update:tool_call',
          kind: 'read',
          locations: [{ path: 'C:\\repo\\notes.txt' }],
        },
      },
    }]);
    expect(provider.parseStreamLine(update({
      sessionUpdate: 'tool_call_update', toolCallId: 'tooluse_1', status: 'in_progress',
    }))).toBeNull();
    expect(provider.parseStreamLine(update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tooluse_1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'alpha\nbeta' } }],
      rawOutput: { message: 'alpha\nbeta' },
    }))).toEqual([{
      type: 'tool_result',
      toolId: 'tooluse_1',
      toolName: 'Read File',
      text: 'alpha\nbeta',
      metadata: { native: { sourceEvent: 'session/update:tool_call_update', status: 'completed' } },
    }]);

    expect(provider.parseStreamLine(update({
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'alpha, beta' },
    }))).toEqual([{ type: 'text', text: 'alpha, beta' }]);

    expect(provider.parseStreamLine(sessionInfo({ kind: 'context_usage', usagePercentage: 10.7 }))).toBeNull();
    expect(provider.parseStreamLine(sessionInfo({
      kind: 'turn_completion',
      promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage: 0.0885 }],
      elapsedTime: 3087,
      status: 'success',
      requestIds: ['ce014b2d-a88f-41a8-9963-806346dac25d'],
    }))).toBeNull();
    expect(provider.parseStreamLine(sessionInfo({ kind: 'turn_end', stopReason: 'end_turn' }))).toBeNull();

    expect(provider.parseStreamLine(frame('runFinished', {
      sessionId: SESSION, status: 'success', stopReason: 'end_turn', finalText: 'alpha, beta', finalTextTruncated: false,
    }))).toEqual([{
      type: 'result',
      sessionId: SESSION,
      reportedModels: [{ model: 'claude-haiku-4.5', matchesRequest: true }],
      metadata: {
        native: {
          sourceEvent: 'runFinished',
          status: 'success',
          stopReason: 'end_turn',
          engine: 'v3',
          effortLevel: 'high',
          credits: 0.0885,
          elapsedMs: 3087,
          requestIds: ['ce014b2d-a88f-41a8-9963-806346dac25d'],
          contextUsagePercentage: 10.7,
        },
      },
    }]);
  });

  it('reports a tool call Kiro denied as a failed tool result', () => {
    const provider = startedProvider();
    provider.parseStreamLine(update({
      sessionUpdate: 'tool_call', toolCallId: 'tooluse_2', title: 'Write File', kind: 'edit', status: 'in_progress',
    }));

    expect(provider.parseStreamLine(update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tooluse_2',
      status: 'failed',
      content: [{ type: 'diff', path: 'C:\\repo\\out.txt', oldText: null, newText: 'DONE' }],
      rawOutput: { message: 'The user rejected this tool call.' },
      _meta: { kiro: { failureReason: 'denied' } },
    }))).toEqual([{
      type: 'tool_result',
      toolId: 'tooluse_2',
      toolName: 'Write File',
      text: 'C:\\repo\\out.txt\nDONE',
      isError: true,
      metadata: {
        native: { sourceEvent: 'session/update:tool_call_update', status: 'failed', failureReason: 'denied' },
      },
    }]);
  });

  it('flags a served model that differs from the request', () => {
    const provider = startedProvider('claude-opus-5.5');
    provider.parseStreamLine(update({
      sessionUpdate: 'config_option_update', configOptions: [{ id: 'model', currentValue: 'auto' }],
    }));
    provider.parseStreamLine(update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OK' } }));

    expect(provider.parseStreamLine(frame('runFinished', {
      sessionId: SESSION, status: 'success', stopReason: 'end_turn', finalText: 'OK',
    }))).toEqual([expect.objectContaining({
      type: 'result',
      reportedModels: [{ model: 'auto', matchesRequest: false }],
    })]);
  });

  it('emits the final text once when no chunk streamed, and nothing for an unseen model', () => {
    const provider = startedProvider();

    expect(provider.parseStreamLine(frame('runFinished', {
      sessionId: SESSION, status: 'success', stopReason: 'end_turn', finalText: 'PONG',
    }))).toEqual([
      { type: 'text', text: 'PONG' },
      {
        type: 'result',
        sessionId: SESSION,
        metadata: { native: { sourceEvent: 'runFinished', status: 'success', stopReason: 'end_turn', engine: 'v3' } },
      },
    ]);
  });

  it('turns a failed or interrupted run into an error event', () => {
    const provider = startedProvider();
    expect(provider.parseStreamLine(frame('runFinished', {
      sessionId: SESSION, status: 'error', stopReason: 'cancelled', finalText: '',
    }))).toEqual({
      type: 'error',
      sessionId: SESSION,
      text: 'Kiro run error (cancelled).',
      metadata: { native: { sourceEvent: 'runFinished', status: 'error', stopReason: 'cancelled', engine: 'v3' } },
    });

    const interrupted = startedProvider();
    expect(interrupted.parseStreamLine(frame('interrupted', { message: 'Run interrupted by signal.' }))).toEqual({
      type: 'error',
      text: 'Run interrupted by signal.',
      metadata: { native: { sourceEvent: 'interrupted' } },
    });
  });

  it('passes non-JSON stdout and unknown frames through silently', () => {
    const provider = startedProvider();
    expect(provider.parseStreamLine('')).toBeNull();
    expect(provider.parseStreamLine('[INFO] kas.server.starting')).toBeNull();
    expect(provider.parseStreamLine(frame('heartbeat', { at: 1 }))).toBeNull();
    expect(provider.parseStreamLine(update({ sessionUpdate: 'plan', entries: [] }))).toEqual([expect.objectContaining({
      type: 'init',
      sessionId: SESSION,
    })]);
  });
});
