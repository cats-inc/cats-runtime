import { describe, it, expect } from 'vitest';
import { parseJunieStreamLine } from './parser.js';

describe('parseJunieStreamLine', () => {
  it('returns null for empty lines', () => {
    expect(parseJunieStreamLine('')).toBeNull();
    expect(parseJunieStreamLine('  ')).toBeNull();
  });

  it('returns raw for non-JSON lines', () => {
    const event = parseJunieStreamLine('Starting Junie...');
    expect(event?.type).toBe('raw');
    expect(event?.text).toBe('Starting Junie...');
  });

  it('parses complete result with sessionId, result, and usage', () => {
    const event = parseJunieStreamLine(JSON.stringify({
      sessionId: 'session-260317-070403-d8r2',
      taskName: 'Simple Addition',
      result: '### Summary\n- 4',
      changes: [],
      llmUsage: [
        { model: 'gemini-3-flash', inputTokens: 100, cacheInputTokens: 50, outputTokens: 30, cost: 0.01 },
        { model: 'gpt-5', inputTokens: 200, outputTokens: 50, cost: 0.02 },
      ],
    }));
    expect(event?.type).toBe('result');
    expect(event?.sessionId).toBe('session-260317-070403-d8r2');
    expect(event?.usage?.inputTokens).toBe(350); // 100+50+200
    expect(event?.usage?.outputTokens).toBe(80); // 30+50
  });

  it('parses result without usage', () => {
    const event = parseJunieStreamLine(JSON.stringify({
      sessionId: 'session-1',
      taskName: 'Test',
      result: 'Done',
    }));
    expect(event?.type).toBe('result');
    expect(event?.sessionId).toBe('session-1');
    expect(event?.usage).toBeUndefined();
  });

  it('returns null for empty object', () => {
    expect(parseJunieStreamLine('{}')).toBeNull();
  });

  it('handles result with only sessionId', () => {
    const event = parseJunieStreamLine(JSON.stringify({
      sessionId: 'session-2',
    }));
    expect(event?.type).toBe('result');
    expect(event?.sessionId).toBe('session-2');
  });
});
