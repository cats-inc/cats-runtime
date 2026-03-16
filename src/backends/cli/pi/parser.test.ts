import { describe, it, expect } from 'vitest';
import { parsePiStreamLine, parsePiModel } from './parser.js';

describe('parsePiStreamLine', () => {
  it('returns null for empty lines', () => {
    expect(parsePiStreamLine('')).toBeNull();
    expect(parsePiStreamLine('  ')).toBeNull();
  });

  it('returns raw for non-JSON lines', () => {
    const event = parsePiStreamLine('Starting Pi...');
    expect(event?.type).toBe('raw');
    expect(event?.text).toBe('Starting Pi...');
  });

  it('skips internal RPC protocol messages', () => {
    expect(parsePiStreamLine(JSON.stringify({ type: 'response' }))).toBeNull();
    expect(parsePiStreamLine(JSON.stringify({ type: 'extension_ui_request' }))).toBeNull();
    expect(parsePiStreamLine(JSON.stringify({ type: 'extension_ui_response' }))).toBeNull();
    expect(parsePiStreamLine(JSON.stringify({ type: 'extension_error' }))).toBeNull();
  });

  it('skips agent_start', () => {
    expect(parsePiStreamLine(JSON.stringify({ type: 'agent_start' }))).toBeNull();
  });

  it('parses agent_end with final assistant message', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'agent_end',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'Done!' },
      ],
    }));
    expect(event?.type).toBe('text');
    expect(event?.text).toBe('Done!');
  });

  it('parses agent_end with array content', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'agent_end',
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Result here' }] },
      ],
    }));
    expect(event?.type).toBe('text');
    expect(event?.text).toBe('Result here');
  });

  it('skips turn_start', () => {
    expect(parsePiStreamLine(JSON.stringify({ type: 'turn_start' }))).toBeNull();
  });

  it('parses turn_end with usage', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'turn_end',
      message: {
        role: 'assistant',
        content: 'hello',
        usage: {
          input: 100,
          output: 50,
          cacheRead: 10,
          cost: { total: 0.005 },
        },
      },
    }));
    expect(event?.type).toBe('result');
    expect(event?.usage?.inputTokens).toBe(110); // 100 + 10
    expect(event?.usage?.outputTokens).toBe(50);
  });

  it('parses turn_end without message as result', () => {
    const event = parsePiStreamLine(JSON.stringify({ type: 'turn_end' }));
    expect(event?.type).toBe('result');
  });

  it('parses message_update with text_delta', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        delta: 'Hello ',
      },
    }));
    expect(event?.type).toBe('text');
    expect(event?.text).toBe('Hello ');
  });

  it('skips message_update without text_delta', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'thinking',
        delta: 'hmm...',
      },
    }));
    expect(event).toBeNull();
  });

  it('parses tool_execution_start', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'tool_execution_start',
      toolCallId: 'tc_1',
      toolName: 'bash',
      args: { command: 'ls' },
    }));
    expect(event?.type).toBe('tool_use');
    expect(event?.toolName).toBe('bash');
    expect(event?.toolId).toBe('tc_1');
  });

  it('parses tool_execution_end', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'tc_1',
      toolName: 'bash',
      result: 'file1.ts\nfile2.ts',
      isError: false,
    }));
    expect(event?.type).toBe('tool_result');
    expect(event?.toolId).toBe('tc_1');
    expect(event?.text).toBe('file1.ts\nfile2.ts');
    expect(event?.isError).toBe(false);
  });

  it('parses tool_execution_end with error', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'tool_execution_end',
      toolCallId: 'tc_2',
      result: 'command not found',
      isError: true,
    }));
    expect(event?.type).toBe('tool_result');
    expect(event?.isError).toBe(true);
  });

  it('returns raw for unknown event types', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'some_future_event',
      data: 'test',
    }));
    expect(event?.type).toBe('raw');
  });
});

describe('parsePiModel', () => {
  it('parses valid provider/model format', () => {
    const result = parsePiModel('xai/grok-4');
    expect(result.provider).toBe('xai');
    expect(result.modelId).toBe('grok-4');
  });

  it('parses model with nested slashes', () => {
    const result = parsePiModel('openai/gpt-4o');
    expect(result.provider).toBe('openai');
    expect(result.modelId).toBe('gpt-4o');
  });

  it('trims whitespace', () => {
    const result = parsePiModel('  xai/grok-4  ');
    expect(result.provider).toBe('xai');
    expect(result.modelId).toBe('grok-4');
  });

  it('throws for model without slash', () => {
    expect(() => parsePiModel('grok-4')).toThrow(/Invalid Pi model format/);
  });

  it('throws for model with leading slash', () => {
    expect(() => parsePiModel('/grok-4')).toThrow(/Invalid Pi model format/);
  });

  it('throws for model with trailing slash', () => {
    expect(() => parsePiModel('xai/')).toThrow(/Invalid Pi model format/);
  });

  it('throws for empty string', () => {
    expect(() => parsePiModel('')).toThrow(/Invalid Pi model format/);
  });
});
