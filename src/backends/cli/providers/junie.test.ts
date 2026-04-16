import { describe, it, expect } from 'vitest';
import { JunieProvider } from './junie.js';

describe('JunieProvider', () => {
  it('has correct name and capabilities', () => {
    const provider = new JunieProvider();
    expect(provider.name).toBe('junie');
    expect(provider.ephemeral).toBe(true);
    expect(provider.capabilities).toEqual({
      resume: true,
      fork: false,
      permissions: false,
    });
  });

  describe('buildSpawnArgs', () => {
    it('builds basic args with json output', () => {
      const provider = new JunieProvider();
      const args = provider.buildSpawnArgs({ cwd: '/tmp/test' });
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
      expect(args).toContain('--skip-update-check');
      expect(args).toContain('--timeout');
      expect(args).toContain('600000');
      expect(args).toContain('--project');
      expect(args).toContain('/tmp/test');
    });

    it('uses the configured Junie turn timeout when provided via env', () => {
      const previous = process.env.CATS_JUNIE_TURN_TIMEOUT_MS;
      process.env.CATS_JUNIE_TURN_TIMEOUT_MS = '12345';

      try {
        const provider = new JunieProvider();
        const args = provider.buildSpawnArgs({ cwd: '/tmp/test' });
        const timeoutIndex = args.indexOf('--timeout');
        expect(timeoutIndex).toBeGreaterThanOrEqual(0);
        expect(args[timeoutIndex + 1]).toBe('12345');
      } finally {
        if (previous === undefined) {
          delete process.env.CATS_JUNIE_TURN_TIMEOUT_MS;
        } else {
          process.env.CATS_JUNIE_TURN_TIMEOUT_MS = previous;
        }
      }
    });

    it('passes through Claude model names as-is', () => {
      const provider = new JunieProvider();
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'Claude Sonnet 4.6',
      });
      expect(args).toContain('--model');
      expect(args).toContain('Claude Sonnet 4.6');
    });

    it('passes through GPT-family model names as-is', () => {
      const provider = new JunieProvider();
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'GPT-5.4',
      });
      expect(args).toContain('--model');
      expect(args).toContain('GPT-5.4');
    });

    it('passes through Codex-family model names as-is', () => {
      const provider = new JunieProvider();
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        model: 'GPT-5.3-codex',
      });
      expect(args).toContain('--model');
      expect(args).toContain('GPT-5.3-codex');
    });

    it('includes session-id for resume', () => {
      const provider = new JunieProvider();
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        resumeSessionId: 'session-260317-070403-d8r2',
      });
      expect(args).toContain('--session-id');
      expect(args).toContain('session-260317-070403-d8r2');
    });

    it('includes prompt from prepareEphemeralTurn', () => {
      const provider = new JunieProvider();
      provider.prepareEphemeralTurn({ message: 'Fix the bug' });
      const args = provider.buildSpawnArgs({ cwd: '/tmp' });
      expect(args).toContain('Fix the bug');
    });
  });

  describe('buildStdinMessage', () => {
    it('returns empty string (prompt goes as positional arg)', () => {
      const provider = new JunieProvider();
      expect(provider.buildStdinMessage('hello')).toBe('');
    });
  });

  describe('parseStreamLine', () => {
    it('parses complete JSON result', () => {
      const provider = new JunieProvider();
      const event = provider.parseStreamLine(JSON.stringify({
        sessionId: 'session-1',
        taskName: 'Test',
        result: 'Done',
        llmUsage: [{ inputTokens: 100, outputTokens: 50 }],
      }));
      expect(event).toEqual([
        { type: 'text', text: 'Done' },
        expect.objectContaining({
          type: 'result',
          sessionId: 'session-1',
          usage: expect.objectContaining({
            inputTokens: 100,
            outputTokens: 50,
            promptInputTokens: 100,
          }),
          metadata: {
            runtimeUsage: {
              totalTokens: 150,
              sourceConfidence: 'aggregated',
            },
          },
        }),
      ]);
    });

    it('returns null for empty lines', () => {
      const provider = new JunieProvider();
      expect(provider.parseStreamLine('')).toBeNull();
    });
  });
});
