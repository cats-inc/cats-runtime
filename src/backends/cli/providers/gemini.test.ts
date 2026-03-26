import { describe, it, expect } from 'vitest';
import { GeminiProvider } from './gemini.js';
import type { StreamEvent } from './types.js';

function toEventList(event: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!event) {
    return [];
  }
  return Array.isArray(event) ? event : [event];
}

describe('GeminiProvider', () => {
  const provider = new GeminiProvider();

  it('has correct name and capabilities', () => {
    expect(provider.name).toBe('gemini');
    expect(provider.ephemeral).toBe(true);
    expect(provider.capabilities).toEqual({
      resume: true,
      fork: false,
      permissions: false,
    });
  });

  describe('buildSpawnArgs', () => {
    it('builds base args with --yolo', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp' });
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--yolo');
    });

    it('adds --model when specified', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp', model: 'gemini-2.5-pro' });
      expect(args).toContain('--model');
      expect(args).toContain('gemini-2.5-pro');
    });

    it('adds --resume when resumeSessionId specified', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp', resumeSessionId: 'abc-123' });
      expect(args).toContain('--resume');
      expect(args).toContain('abc-123');
    });
  });

  describe('buildStdinMessage', () => {
    it('returns raw content', () => {
      expect(provider.buildStdinMessage('hello')).toBe('hello');
    });

    it('prefixes layered instructions when provided', () => {
      expect(provider.buildStdinMessage('hello', {
        message: 'hello',
        sessionInstructions: 'Session-level instructions.',
        instructions: 'Turn-level instructions.',
      })).toContain('Turn-level instructions.');
    });
  });

  describe('parseStreamLine', () => {
    it('returns null for empty lines', () => {
      expect(provider.parseStreamLine('')).toBeNull();
      expect(provider.parseStreamLine('   ')).toBeNull();
    });

    it('parses init event', () => {
      const line = JSON.stringify({ type: 'init', session_id: 'sess-1' });
      const event = provider.parseStreamLine(line);
      expect(event).toEqual({ type: 'init', sessionId: 'sess-1' });
    });

    it('parses assistant message with string content', () => {
      const line = JSON.stringify({ type: 'message', role: 'assistant', content: 'Hello!' });
      const event = provider.parseStreamLine(line);
      expect(event).toEqual({ type: 'text', text: 'Hello!' });
    });

    it('parses assistant message with part-list content', () => {
      const line = JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: [{ text: 'Part 1' }, { functionCall: {} }, { text: 'Part 2' }],
      });
      const event = provider.parseStreamLine(line);
      expect(event).toEqual({ type: 'text', text: 'Part 1Part 2' });
    });

    it('promotes assistant multipart functionCall blocks into progress plus tool_use', () => {
      const line = JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: [
          { text: 'Checking the workspace.' },
          { functionCall: { name: 'readFile', args: { path: 'README.md' } } },
        ],
      });

      expect(toEventList(provider.parseStreamLine(line))).toEqual([
        { type: 'text', text: 'Checking the workspace.' },
        {
          type: 'progress',
          text: 'Running tool: readFile',
          metadata: {
            kind: 'tool',
            status: 'running',
            source: 'provider',
            provider: 'gemini',
            backend: 'cli',
            native: {
              sourceEvent: 'message:assistant',
              toolName: 'readFile',
            },
          },
        },
        {
          type: 'tool_use',
          toolName: 'readFile',
          toolArgs: { path: 'README.md' },
        },
      ]);
    });

    it('promotes assistant multipart functionResponse blocks into progress plus tool_result', () => {
      const line = JSON.stringify({
        type: 'message',
        role: 'assistant',
        content: [
          {
            functionResponse: {
              name: 'readFile',
              response: { contents: 'hello' },
            },
          },
        ],
      });

      expect(toEventList(provider.parseStreamLine(line))).toEqual([
        {
          type: 'progress',
          text: 'Gemini completed tool: readFile',
          metadata: {
            kind: 'tool',
            status: 'updated',
            source: 'provider',
            provider: 'gemini',
            backend: 'cli',
            native: {
              sourceEvent: 'message:assistant',
              toolName: 'readFile',
            },
          },
        },
        {
          type: 'tool_result',
          toolName: 'readFile',
          text: '{"contents":"hello"}',
        },
      ]);
    });

    it('skips user message echo', () => {
      const line = JSON.stringify({ type: 'message', role: 'user', content: 'Hi' });
      expect(provider.parseStreamLine(line)).toBeNull();
    });

    it('parses tool_use event with snake_case fields', () => {
      const line = JSON.stringify({ type: 'tool_use', tool_name: 'readFile', tool_id: 't1' });
      const event = provider.parseStreamLine(line);
      expect(event).toEqual({ type: 'tool_use', toolName: 'readFile', toolId: 't1' });
    });

    it('promotes tool_result events into progress plus tool_result output', () => {
      const line = JSON.stringify({
        type: 'tool_result',
        tool_name: 'readFile',
        tool_id: 't1',
        content: [{ text: 'File contents' }],
      });
      expect(toEventList(provider.parseStreamLine(line))).toEqual([
        {
          type: 'progress',
          text: 'Gemini completed tool: readFile',
          metadata: {
            kind: 'tool',
            status: 'updated',
            source: 'provider',
            provider: 'gemini',
            backend: 'cli',
            native: {
              sourceEvent: 'tool_result',
              toolName: 'readFile',
              toolId: 't1',
            },
          },
        },
        {
          type: 'tool_result',
          toolName: 'readFile',
          toolId: 't1',
          text: 'File contents',
        },
      ]);
    });

    it('drops malformed tool_result events with a schema failure instead of fabricating output', () => {
      const line = JSON.stringify({ type: 'tool_result' });
      expect(provider.parseStreamLine(line)).toBeNull();
    });

    it('parses error event', () => {
      const line = JSON.stringify({ type: 'error', message: 'Something failed' });
      const event = provider.parseStreamLine(line);
      expect(event).toEqual({ type: 'error', text: 'Something failed' });
    });

    it('parses result event with usage', () => {
      const line = JSON.stringify({
        type: 'result',
        stats: { input_tokens: 100, output_tokens: 50 },
      });
      const event = provider.parseStreamLine(line);
      expect(event).toEqual({
        type: 'result',
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    });

    it('parses result event without stats', () => {
      const line = JSON.stringify({ type: 'result' });
      const event = provider.parseStreamLine(line);
      expect(event).toEqual({ type: 'result', usage: undefined });
    });

    it('returns raw for non-JSON lines', () => {
      const event = provider.parseStreamLine('not json');
      expect(event).toEqual({ type: 'raw', text: 'not json' });
    });

    it('returns raw for unknown event types', () => {
      const line = JSON.stringify({ type: 'unknown_event' });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('raw');
    });
  });
});
