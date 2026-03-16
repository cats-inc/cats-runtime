import { describe, it, expect } from 'vitest';
import { PiProvider } from './pi.js';

describe('PiProvider', () => {
  const provider = new PiProvider();

  it('has correct name and capabilities', () => {
    expect(provider.name).toBe('pi');
    expect(provider.capabilities).toEqual({
      resume: true,
      fork: false,
      permissions: false,
    });
  });

  describe('buildSpawnArgs', () => {
    it('builds basic args with RPC mode', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp/test' });
      expect(args).toEqual(['--mode', 'rpc']);
    });

    it('splits model into --provider and --model flags', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'xai/grok-4',
      });
      expect(args).toContain('--provider');
      expect(args).toContain('xai');
      expect(args).toContain('--model');
      expect(args).toContain('grok-4');
    });

    it('includes session flag for resume', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        resumeSessionId: '/home/user/.pi/agent/sessions/session.jsonl',
      });
      expect(args).toContain('--session');
      expect(args).toContain('/home/user/.pi/agent/sessions/session.jsonl');
    });

    it('combines model and resume', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'openai/gpt-4o',
        resumeSessionId: '/tmp/session.jsonl',
      });
      expect(args).toEqual([
        '--mode', 'rpc',
        '--provider', 'openai',
        '--model', 'gpt-4o',
        '--session', '/tmp/session.jsonl',
      ]);
    });

    it('throws for invalid model format', () => {
      expect(() => provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'grok-4',
      })).toThrow(/Invalid Pi model format/);
    });
  });

  describe('buildStdinMessage', () => {
    it('formats as Pi RPC prompt JSON', () => {
      const msg = provider.buildStdinMessage('Hello world');
      const parsed = JSON.parse(msg.trim());
      expect(parsed.type).toBe('prompt');
      expect(parsed.message).toBe('Hello world');
    });
  });

  describe('parseStreamLine', () => {
    it('parses text delta from message_update', () => {
      const line = JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: 'Hello!',
        },
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('Hello!');
    });

    it('parses turn_end as result with usage', () => {
      const line = JSON.stringify({
        type: 'turn_end',
        message: {
          role: 'assistant',
          content: 'done',
          usage: { input: 200, output: 100, cacheRead: 50 },
        },
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('result');
      expect(event?.usage?.inputTokens).toBe(250);
      expect(event?.usage?.outputTokens).toBe(100);
    });

    it('parses tool_execution_start', () => {
      const line = JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'tc_1',
        toolName: 'read',
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('tool_use');
      expect(event?.toolName).toBe('read');
    });

    it('returns null for empty lines', () => {
      expect(provider.parseStreamLine('')).toBeNull();
      expect(provider.parseStreamLine('  ')).toBeNull();
    });

    it('returns raw for non-JSON lines', () => {
      const event = provider.parseStreamLine('Pi starting...');
      expect(event?.type).toBe('raw');
    });
  });
});
