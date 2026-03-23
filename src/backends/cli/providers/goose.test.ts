import { describe, it, expect, vi } from 'vitest';
import { GooseProvider } from './goose.js';
import { GooseNativeSessionService } from '../goose/GooseNativeSessionService.js';

function createMockNative(): GooseNativeSessionService {
  return {
    listAllSessions: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    getLatestSession: vi.fn(async () => null),
    canResumeSession: vi.fn(async () => true),
    loadHistory: vi.fn(async () => []),
    deleteSession: vi.fn(async () => false),
  } as unknown as GooseNativeSessionService;
}

describe('GooseProvider', () => {
  it('has correct name and capabilities', () => {
    const provider = new GooseProvider(createMockNative());
    expect(provider.name).toBe('goose');
    expect(provider.ephemeral).toBe(true);
    expect(provider.capabilities).toEqual({
      resume: true,
      fork: false,
      permissions: false,
    });
  });

  describe('buildSpawnArgs', () => {
    it('builds basic args with stream-json output', () => {
      const provider = new GooseProvider(createMockNative());
      const args = provider.buildSpawnArgs({ cwd: '/tmp/test' });
      expect(args).toContain('run');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--quiet');
    });

    it('splits model into --provider and --model flags', () => {
      const provider = new GooseProvider(createMockNative());
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'anthropic/claude-sonnet-4',
      });
      expect(args).toContain('--provider');
      expect(args).toContain('anthropic');
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4');
    });

    it('normalizes generic Codex model aliases into Goose provider/model flags', () => {
      const provider = new GooseProvider(createMockNative());
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'gpt-5.2-codex',
      });
      expect(args).toContain('--provider');
      expect(args).toContain('openai');
      expect(args).toContain('--model');
      expect(args).toContain('gpt-5-codex');
    });

    it('includes --name and --resume for session resume', () => {
      const provider = new GooseProvider(createMockNative());
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        resumeSessionId: 'my-session',
      });
      expect(args).toContain('--name');
      expect(args).toContain('my-session');
      expect(args).toContain('--resume');
    });

    it('includes --text with prepared prompt', () => {
      const provider = new GooseProvider(createMockNative());
      provider.prepareEphemeralTurn({ message: 'Fix the bug' });
      const args = provider.buildSpawnArgs({ cwd: '/tmp' });
      expect(args).toContain('--text');
      expect(args).toContain('Fix the bug');
    });

    it('throws for unsupported shorthand model format', () => {
      const provider = new GooseProvider(createMockNative());
      expect(() => provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'claude-sonnet-4-6',
      })).toThrow(/Invalid Goose model format/);
    });
  });

  describe('buildStdinMessage', () => {
    it('returns empty string (prompt goes via --text)', () => {
      const provider = new GooseProvider(createMockNative());
      expect(provider.buildStdinMessage('hello')).toBe('');
    });
  });

  describe('parseStreamLine', () => {
    it('parses text message', () => {
      const provider = new GooseProvider(createMockNative());
      const event = provider.parseStreamLine(JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
        },
      }));
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('Hello!');
    });

    it('parses complete event', () => {
      const provider = new GooseProvider(createMockNative());
      const event = provider.parseStreamLine(JSON.stringify({
        type: 'complete',
        total_tokens: 5000,
      }));
      expect(event?.type).toBe('result');
      expect(event?.usage?.outputTokens).toBe(5000);
    });
  });
});
