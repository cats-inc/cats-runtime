import { describe, it, expect } from 'vitest';
import { parseGooseStreamLine, parseGooseModel } from './parser.js';

describe('parseGooseStreamLine', () => {
  it('returns null for empty lines', () => {
    expect(parseGooseStreamLine('')).toBeNull();
    expect(parseGooseStreamLine('  ')).toBeNull();
  });

  it('returns raw for non-JSON lines', () => {
    const event = parseGooseStreamLine('Starting Goose...');
    expect(event?.type).toBe('raw');
    expect(event?.text).toBe('Starting Goose...');
  });

  it('parses assistant text message', () => {
    const event = parseGooseStreamLine(JSON.stringify({
      type: 'message',
      message: {
        id: 'resp_1',
        role: 'assistant',
        content: [{ type: 'text', text: '4' }],
      },
    }));
    expect(event?.type).toBe('text');
    expect(event?.text).toBe('4');
  });

  it('parses assistant text streaming delta', () => {
    const event = parseGooseStreamLine(JSON.stringify({
      type: 'message',
      message: {
        id: 'resp_1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
      },
    }));
    expect(event?.type).toBe('text');
    expect(event?.text).toBe('Hello');
  });

  it('parses tool request', () => {
    const event = parseGooseStreamLine(JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [{
          type: 'toolRequest',
          id: 'call_123',
          toolCall: {
            status: 'success',
            value: {
              name: 'todo__todo_write',
              arguments: { content: 'test' },
            },
          },
        }],
      },
    }));
    expect(event).toEqual([
      expect.objectContaining({
        type: 'progress',
        text: 'Running tool: todo__todo_write',
        metadata: expect.objectContaining({
          provider: 'goose',
          backend: 'cli',
          kind: 'tool',
          status: 'running',
        }),
      }),
      {
        type: 'tool_use',
        toolName: 'todo__todo_write',
        toolId: 'call_123',
      },
    ]);
  });

  it('parses tool response', () => {
    const event = parseGooseStreamLine(JSON.stringify({
      type: 'message',
      message: {
        role: 'user',
        content: [{
          type: 'toolResponse',
          id: 'call_123',
          toolResult: {
            status: 'success',
            value: {
              content: [{ type: 'text', text: 'Updated (70 chars)' }],
              isError: false,
            },
          },
        }],
      },
    }));
    expect(event).toEqual([
      expect.objectContaining({
        type: 'progress',
        text: 'Completed tool: call_123',
        metadata: expect.objectContaining({
          provider: 'goose',
          backend: 'cli',
          kind: 'tool',
          status: 'updated',
        }),
      }),
      {
        type: 'tool_result',
        toolId: 'call_123',
        text: 'Updated (70 chars)',
        isError: false,
      },
    ]);
  });

  it('parses complete event with token count', () => {
    const event = parseGooseStreamLine(JSON.stringify({
      type: 'complete',
      total_tokens: 8640,
    }));
    expect(event?.type).toBe('result');
    expect(event?.usage?.outputTokens).toBe(8640);
  });

  it('parses complete event without token count', () => {
    const event = parseGooseStreamLine(JSON.stringify({
      type: 'complete',
    }));
    expect(event?.type).toBe('result');
    expect(event?.usage).toBeUndefined();
  });

  it('returns null for message with empty content', () => {
    const event = parseGooseStreamLine(JSON.stringify({
      type: 'message',
      message: { role: 'assistant', content: [] },
    }));
    expect(event).toBeNull();
  });

  it('returns raw for unknown event types', () => {
    const event = parseGooseStreamLine(JSON.stringify({
      type: 'unknown_event',
      data: 'test',
    }));
    expect(event?.type).toBe('raw');
  });
});

describe('parseGooseModel', () => {
  it('parses valid provider/model format', () => {
    const result = parseGooseModel('anthropic/claude-sonnet-4');
    expect(result.provider).toBe('anthropic');
    expect(result.modelId).toBe('claude-sonnet-4');
  });

  it('trims whitespace', () => {
    const result = parseGooseModel('  openai/gpt-5  ');
    expect(result.provider).toBe('openai');
    expect(result.modelId).toBe('gpt-5');
  });

  it('normalizes GPT shorthand to the OpenAI provider/model form', () => {
    const result = parseGooseModel('gpt-5.4');
    expect(result.provider).toBe('openai');
    expect(result.modelId).toBe('gpt-5');
  });

  it('normalizes Codex shorthand to the OpenAI codex model', () => {
    const result = parseGooseModel('gpt-5.2-codex');
    expect(result.provider).toBe('openai');
    expect(result.modelId).toBe('gpt-5-codex');
  });

  it('normalizes OpenAI provider/model aliases', () => {
    const result = parseGooseModel('openai/gpt-5.4');
    expect(result.provider).toBe('openai');
    expect(result.modelId).toBe('gpt-5');
  });

  it('throws for empty string', () => {
    expect(() => parseGooseModel('')).toThrow(/Invalid Goose model format/);
  });

  it('throws for unsupported shorthand model format', () => {
    expect(() => parseGooseModel('claude-sonnet-4-6')).toThrow(/Invalid Goose model format/);
  });
});
