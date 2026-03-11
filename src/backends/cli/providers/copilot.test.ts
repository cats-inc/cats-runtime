import { describe, it, expect, beforeEach } from 'vitest';
import { CopilotProvider } from './copilot.js';

describe('CopilotProvider', () => {
  let provider: CopilotProvider;

  beforeEach(() => {
    provider = new CopilotProvider();
  });

  it('has correct name and capabilities', () => {
    expect(provider.name).toBe('copilot');
    expect(provider.ephemeral).toBe(true);
    expect(provider.capabilities).toEqual({
      resume: true,
      fork: false,
      permissions: false,
    });
  });

  describe('buildSpawnArgs', () => {
    it('includes --output-format json and --stream on', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp' });
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
      expect(args).toContain('--stream');
      expect(args).toContain('on');
    });

    it('does not include -s (silent flag)', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp' });
      expect(args).not.toContain('-s');
    });

    it('adds --allow-all-tools by default', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp' });
      expect(args).toContain('--allow-all-tools');
      expect(args).not.toContain('--yolo');
    });

    it('adds --yolo when permissionMode is skip', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp', permissionMode: 'skip' });
      expect(args).toContain('--yolo');
      expect(args).not.toContain('--allow-all-tools');
    });

    it('adds --model when specified', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp', model: 'gpt-5.1' });
      expect(args).toContain('--model');
      expect(args).toContain('gpt-5.1');
    });

    it('adds --resume when resumeSessionId specified', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp', resumeSessionId: 'sess-abc' });
      expect(args).toContain('--resume');
      expect(args).toContain('sess-abc');
    });

    it('includes -p with message after prepareEphemeralTurn', () => {
      provider.prepareEphemeralTurn('Hello, copilot!');
      const args = provider.buildSpawnArgs({ cwd: '/tmp' });
      expect(args).toContain('-p');
      expect(args).toContain('Hello, copilot!');
    });

    it('clears pending prompt after buildSpawnArgs', () => {
      provider.prepareEphemeralTurn('First message');
      provider.buildSpawnArgs({ cwd: '/tmp' });

      // Second call should NOT include -p
      const args = provider.buildSpawnArgs({ cwd: '/tmp' });
      expect(args).not.toContain('-p');
      expect(args).not.toContain('First message');
    });
  });

  describe('buildStdinMessage', () => {
    it('returns empty string', () => {
      expect(provider.buildStdinMessage('anything')).toBe('');
    });
  });

  describe('parseStreamLine', () => {
    it('returns null for empty lines', () => {
      expect(provider.parseStreamLine('')).toBeNull();
      expect(provider.parseStreamLine('   ')).toBeNull();
    });

    it('parses session.start as init with sessionId', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'session.start',
          data: { sessionId: 'sess-1' },
        }),
      );
      expect(event).toEqual({ type: 'init', sessionId: 'sess-1' });
    });

    it('parses assistant.turn_start as init using the last sessionId', () => {
      provider.parseStreamLine(
        JSON.stringify({
          type: 'session.start',
          data: { sessionId: 'sess-1' },
        }),
      );

      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'assistant.turn_start', data: { turnId: '0' } }),
      );
      expect(event).toEqual({ type: 'init', sessionId: 'sess-1' });
    });

    it('parses assistant.message_delta with data.deltaContent as text', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.message_delta',
          data: { messageId: 'msg-1', deltaContent: 'Hello' },
        }),
      );
      expect(event).toEqual({ type: 'text', text: 'Hello' });
    });

    it('handles missing deltaContent in message_delta', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'assistant.message_delta', data: {} }),
      );
      expect(event).toEqual({ type: 'text', text: '' });
    });

    it('handles missing data wrapper in message_delta', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'assistant.message_delta' }),
      );
      expect(event).toEqual({ type: 'text', text: '' });
    });

    it('parses assistant.message with toolRequests as tool_use', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.message',
          data: { toolRequests: [{ name: 'read_file', id: 'tool-123' }] },
        }),
      );
      expect(event).toEqual({ type: 'tool_use', toolName: 'read_file', toolId: 'tool-123' });
    });

    it('parses assistant.message content as text when no deltas were streamed', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.message',
          data: { content: 'Hello', toolRequests: [] },
        }),
      );
      expect(event).toEqual({ type: 'text', text: 'Hello' });
    });

    it('does not duplicate assistant.message content after deltas were streamed', () => {
      provider.prepareEphemeralTurn('test');
      provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.message_delta',
          data: { deltaContent: 'Hello' },
        }),
      );

      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.message',
          data: { content: 'Hello', toolRequests: [] },
        }),
      );
      expect(event).toBeNull();
    });

    it('captures outputTokens from assistant.message for result usage', () => {
      provider.prepareEphemeralTurn('test');
      // assistant.message with outputTokens
      provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.message',
          data: { content: 'Hi!', toolRequests: [], outputTokens: 42 },
        }),
      );
      // result event should carry the captured outputTokens
      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'result', sessionId: 'sess-1' }),
      );
      expect(event).toEqual({
        type: 'result',
        sessionId: 'sess-1',
        usage: { inputTokens: 0, outputTokens: 42 },
      });
    });

    it('parses session.shutdown as the completion result with model usage', () => {
      provider.parseStreamLine(
        JSON.stringify({
          type: 'session.start',
          data: { sessionId: 'sess-shutdown' },
        }),
      );

      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'session.shutdown',
          data: {
            currentModel: 'gpt-5.4',
            modelMetrics: {
              'gpt-5.4': {
                usage: {
                  inputTokens: 24504,
                  outputTokens: 94,
                },
              },
            },
          },
        }),
      );

      expect(event).toEqual({
        type: 'result',
        sessionId: 'sess-shutdown',
        usage: { inputTokens: 24504, outputTokens: 94 },
      });
    });

    it('parses result event with sessionId', () => {
      provider.parseStreamLine(
        JSON.stringify({
          type: 'session.start',
          data: { sessionId: 'sess-xyz' },
        }),
      );

      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'result',
          sessionId: 'sess-xyz',
          exitCode: 0,
          usage: { premiumRequests: 1, totalApiDurationMs: 5000 },
        }),
      );
      expect(event).toEqual({
        type: 'result',
        sessionId: 'sess-xyz',
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    });

    it('parses result event without sessionId', () => {
      provider.parseStreamLine(
        JSON.stringify({
          type: 'session.start',
          data: { sessionId: 'sess-prev' },
        }),
      );

      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'result', exitCode: 0 }),
      );
      expect(event).toEqual({
        type: 'result',
        sessionId: 'sess-prev',
        usage: { inputTokens: 0, outputTokens: 0 },
      });
    });

    it('skips user.message events', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'user.message', data: { content: 'echo' } }),
      );
      expect(event).toBeNull();
    });

    it('skips session.model_change events', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'session.model_change', data: { newModel: 'gpt-5.4' } }),
      );
      expect(event).toBeNull();
    });

    it('skips assistant.reasoning_delta events', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.reasoning_delta',
          data: { deltaContent: 'thinking...' },
        }),
      );
      expect(event).toBeNull();
    });

    it('skips assistant.reasoning events', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.reasoning',
          data: { content: 'full reasoning' },
        }),
      );
      expect(event).toBeNull();
    });

    it('skips assistant.turn_end events', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'assistant.turn_end', data: { turnId: '0' } }),
      );
      expect(event).toBeNull();
    });

    it('emits raw for non-JSON lines with ANSI stripped', () => {
      const event = provider.parseStreamLine('\x1b[32mSome output\x1b[0m');
      expect(event).toEqual({ type: 'raw', text: 'Some output' });
    });

    it('returns null for non-JSON lines that are empty after ANSI stripping', () => {
      const event = provider.parseStreamLine('\x1b[0m');
      expect(event).toBeNull();
    });

    it('skips unknown JSON event types', () => {
      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'some.unknown.event' }),
      );
      expect(event).toBeNull();
    });

    it('resets outputTokens counter on prepareEphemeralTurn', () => {
      // First turn: capture outputTokens
      provider.prepareEphemeralTurn('turn 1');
      provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.message',
          data: { toolRequests: [], outputTokens: 100 },
        }),
      );

      // New turn: counter should reset
      provider.prepareEphemeralTurn('turn 2');
      const event = provider.parseStreamLine(
        JSON.stringify({ type: 'result', sessionId: 'sess-2' }),
      );
      expect(event!.usage!.outputTokens).toBe(0);
    });

    it('resets delta tracking on a new turn', () => {
      provider.prepareEphemeralTurn('turn 1');
      provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.message_delta',
          data: { deltaContent: 'Hello' },
        }),
      );

      provider.prepareEphemeralTurn('turn 2');
      const event = provider.parseStreamLine(
        JSON.stringify({
          type: 'assistant.message',
          data: { content: 'Fresh answer', toolRequests: [] },
        }),
      );

      expect(event).toEqual({ type: 'text', text: 'Fresh answer' });
    });
  });
});
