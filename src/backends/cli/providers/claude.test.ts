import { describe, it, expect } from 'vitest';
import { ClaudeProvider } from './claude.js';
import type { StreamEvent } from './types.js';

function toEventList(event: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (!event) {
    return [];
  }
  return Array.isArray(event) ? event : [event];
}

describe('ClaudeProvider', () => {
  const provider = new ClaudeProvider();

  describe('buildSpawnArgs', () => {
    it('builds basic args', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp/test' });
      expect(args).toContain('-p');
      expect(args).toContain('--input-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--output-format');
      expect(args).toContain('--verbose');
    });

    it('includes model flag', () => {
      const args = provider.buildSpawnArgs({ cwd: '/tmp', model: 'opus' });
      expect(args).toContain('--model');
      expect(args).toContain('opus');
    });

    it('passes the Ultracode effort value through to Claude Code', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        modelControls: {
          'claude.reasoning_effort': 'ultracode',
        },
      });
      expect(args).toContain('--effort');
      expect(args).toContain('ultracode');
    });

    it('includes resume flag', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        resumeSessionId: 'abc-123',
      });
      expect(args).toContain('--resume');
      expect(args).toContain('abc-123');
    });

    it('includes fork flag', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        resumeSessionId: 'abc-123',
        forkSession: true,
      });
      expect(args).toContain('--resume');
      expect(args).toContain('--fork-session');
    });

    it('includes skip permissions flag', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        permissionMode: 'skip',
      });
      expect(args).toContain('--dangerously-skip-permissions');
    });

    it('includes allowed tools flag', () => {
      const args = provider.buildSpawnArgs({
        cwd: '/tmp',
        permissionMode: 'whitelist',
        allowedTools: ['Bash', 'Read', 'Edit'],
      });
      expect(args).toContain('--allowedTools');
      expect(args).toContain('Bash,Read,Edit');
    });
  });

  describe('buildStdinMessage', () => {
    it('formats user message as JSON', () => {
      const msg = provider.buildStdinMessage('Hello world');
      const parsed = JSON.parse(msg.trim());
      expect(parsed.type).toBe('user');
      expect(parsed.message.role).toBe('user');
      expect(parsed.message.content).toBe('Hello world');
    });

    it('layers session and turn instructions into the prompt payload', () => {
      const msg = provider.buildStdinMessage('Hello world', {
        message: 'Hello world',
        sessionInstructions: 'Session-level instructions.',
        instructions: 'Turn-level instructions.',
      });
      const parsed = JSON.parse(msg.trim());
      expect(parsed.message.content).toContain('Instructions:');
      expect(parsed.message.content).toContain('Session-level instructions.');
      expect(parsed.message.content).toContain('Turn-level instructions.');
      expect(parsed.message.content).toContain('User message:');
    });
  });

  describe('parseStreamLine', () => {
    it('parses system/init event', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'claude-abc-123',
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('init');
      expect(event?.sessionId).toBe('claude-abc-123');
    });

    it('parses assistant message with text content', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
        },
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('Hello!');
    });

    it('parses assistant message with string content', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: ['Hello!'],
        },
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('Hello!');
    });

    it('parses assistant tool_use blocks into progress plus tool_use events', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            name: 'read_file',
            id: 'tool-1',
            input: { path: 'README.md' },
          }],
        },
      });

      expect(toEventList(provider.parseStreamLine(line))).toEqual([
        {
          type: 'progress',
          text: 'Running tool: read_file',
          metadata: {
            kind: 'tool',
            status: 'running',
            source: 'provider',
            provider: 'claude',
            backend: 'cli',
            native: {
              sourceEvent: 'assistant',
              toolName: 'read_file',
            },
          },
        },
        {
          type: 'tool_use',
          toolName: 'read_file',
          toolId: 'tool-1',
          toolArgs: { path: 'README.md' },
        },
      ]);
    });

    it('promotes assistant thinking blocks into reasoning progress', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'thinking',
            thinking: 'Checking the repo state.',
          }],
        },
      });

      expect(provider.parseStreamLine(line)).toEqual({
        type: 'progress',
        text: 'Checking the repo state.',
        metadata: {
          kind: 'reasoning',
          status: 'updated',
          source: 'provider',
          provider: 'claude',
          backend: 'cli',
          native: {
            sourceEvent: 'assistant',
          },
        },
      });
    });

    it('promotes assistant tool_result blocks into progress plus tool_result events', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: 'File contents',
          }],
        },
      });

      expect(toEventList(provider.parseStreamLine(line))).toEqual([
        {
          type: 'progress',
          text: 'Claude completed a tool call.',
          metadata: {
            kind: 'tool',
            status: 'updated',
            source: 'provider',
            provider: 'claude',
            backend: 'cli',
            native: {
              sourceEvent: 'assistant',
              toolId: 'tool-1',
            },
          },
        },
        {
          type: 'tool_result',
          toolId: 'tool-1',
          text: 'File contents',
        },
      ]);
    });

    it('preserves text alongside assistant tool_use blocks', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking the file.' },
            {
              type: 'tool_use',
              name: 'read_file',
              id: 'tool-1',
              input: { path: 'README.md' },
            },
          ],
        },
      });

      expect(toEventList(provider.parseStreamLine(line))).toEqual([
        {
          type: 'text',
          text: 'Checking the file.',
        },
        {
          type: 'progress',
          text: 'Running tool: read_file',
          metadata: {
            kind: 'tool',
            status: 'running',
            source: 'provider',
            provider: 'claude',
            backend: 'cli',
            native: {
              sourceEvent: 'assistant',
              toolName: 'read_file',
            },
          },
        },
        {
          type: 'tool_use',
          toolName: 'read_file',
          toolId: 'tool-1',
          toolArgs: { path: 'README.md' },
        },
      ]);
    });

    it('accepts legacy top-level assistant tool_use frames', () => {
      const line = JSON.stringify({
        type: 'assistant',
        tool_use: {
          name: 'read_file',
          id: 'tool-legacy',
        },
      });

      expect(toEventList(provider.parseStreamLine(line))).toEqual([
        {
          type: 'progress',
          text: 'Running tool: read_file',
          metadata: {
            kind: 'tool',
            status: 'running',
            source: 'provider',
            provider: 'claude',
            backend: 'cli',
            native: {
              sourceEvent: 'assistant',
              toolName: 'read_file',
            },
          },
        },
        {
          type: 'tool_use',
          toolName: 'read_file',
          toolId: 'tool-legacy',
          toolArgs: undefined,
        },
      ]);
    });

    it('promotes content_block_start tool_use frames into progress plus tool_use events', () => {
      const line = JSON.stringify({
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          name: 'read_file',
          id: 'tool-stream',
          input: { path: 'README.md' },
        },
      });

      expect(toEventList(provider.parseStreamLine(line))).toEqual([
        {
          type: 'progress',
          text: 'Running tool: read_file',
          metadata: {
            kind: 'tool',
            status: 'running',
            source: 'provider',
            provider: 'claude',
            backend: 'cli',
            native: {
              sourceEvent: 'content_block_start',
              toolName: 'read_file',
            },
          },
        },
        {
          type: 'tool_use',
          toolName: 'read_file',
          toolId: 'tool-stream',
          toolArgs: { path: 'README.md' },
        },
      ]);
    });

    it('promotes content_block_delta thinking updates into reasoning progress', () => {
      const line = JSON.stringify({
        type: 'content_block_delta',
        content_block_delta: {
          type: 'thinking_delta',
          thinking: 'Still checking the repo.',
        },
      });

      expect(provider.parseStreamLine(line)).toEqual({
        type: 'progress',
        text: 'Still checking the repo.',
        metadata: {
          kind: 'reasoning',
          status: 'running',
          source: 'provider',
          provider: 'claude',
          backend: 'cli',
          native: {
            sourceEvent: 'content_block_delta',
          },
        },
      });
    });

    it('parses content_block_delta', () => {
      const line = JSON.stringify({
        type: 'content_block_delta',
        content_block_delta: { type: 'text_delta', text: 'chunk' },
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('chunk');
    });

    it('parses result with usage', () => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'claude-abc',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 5,
        },
      });
      const event = provider.parseStreamLine(line);
      expect(event?.type).toBe('result');
      expect(event?.sessionId).toBe('claude-abc');
      expect(event?.usage?.inputTokens).toBe(115); // 100+10+5
      expect(event?.usage?.outputTokens).toBe(50);
      expect(event?.usage?.promptInputTokens).toBe(100);
      expect(event?.usage?.cacheReadInputTokens).toBe(10);
      expect(event?.usage?.cacheCreationInputTokens).toBe(5);
    });

    it('normalizes rate_limit_event into quota progress and carries it onto result', () => {
      const rateLimitProvider = new ClaudeProvider();
      const fiveHourResetsAt = new Date(1789007400 * 1000).toISOString();
      const sevenDayResetsAt = new Date(1789506000 * 1000).toISOString();
      const progress = toEventList(rateLimitProvider.parseStreamLine(JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          resetsAt: 1789007400,
          rateLimitType: 'five_hour',
          overageStatus: 'rejected',
          overageDisabledReason: 'org_level_disabled',
          isUsingOverage: false,
          unifiedWindows: {
            five_hour: { utilization: 0.07, resetsAt: 1789007400 },
            seven_day: { utilization: 0.01, resetsAt: 1789506000 },
          },
        },
        uuid: 'uuid-1',
        session_id: 'claude-abc',
      })));

      expect(progress).toHaveLength(1);
      expect(progress[0]).toEqual(expect.objectContaining({
        type: 'progress',
        text: `Claude rate limit allowed: five_hour 7% used (resets ${fiveHourResetsAt}), `
          + `seven_day 1% used (resets ${sevenDayResetsAt}).`,
        metadata: expect.objectContaining({
          kind: 'quota',
          status: 'updated',
          source: 'provider',
          provider: 'claude',
          backend: 'cli',
          native: expect.objectContaining({ sourceEvent: 'rate_limit_event' }),
          quota: {
            source: 'claude.rate_limit_event',
            observedAt: expect.any(String),
            status: 'allowed',
            rateLimitType: 'five_hour',
            resetsAt: fiveHourResetsAt,
            isUsingOverage: false,
            overageStatus: 'rejected',
            overageDisabledReason: 'org_level_disabled',
            'five_hour.utilization': 0.07,
            'five_hour.resetsAt': fiveHourResetsAt,
            'seven_day.utilization': 0.01,
            'seven_day.resetsAt': sevenDayResetsAt,
          },
        }),
      }));

      const result = rateLimitProvider.parseStreamLine(JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: 'claude-abc',
        duration_ms: 4323,
        duration_api_ms: 5275,
        num_turns: 1,
        total_cost_usd: 0.15941175,
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 7724,
          cache_read_input_tokens: 15055,
          output_tokens: 4,
        },
        modelUsage: {
          'claude-fable-5-1': {
            inputTokens: 2,
            outputTokens: 4,
            costUSD: 0.15846375,
            contextWindow: 1000000,
          },
        },
      }));

      expect(result).toEqual(expect.objectContaining({
        type: 'result',
        sessionId: 'claude-abc',
        usage: {
          inputTokens: 22781,
          outputTokens: 4,
          promptInputTokens: 2,
          cacheReadInputTokens: 15055,
          cacheCreationInputTokens: 7724,
          estimatedCost: 0.15941175,
          currency: 'USD',
        },
        metadata: {
          runtimeUsage: {
            quota: expect.objectContaining({
              status: 'allowed',
              'five_hour.utilization': 0.07,
            }),
          },
          native: {
            sourceEvent: 'result',
            subtype: 'success',
            isError: false,
            durationMs: 4323,
            durationApiMs: 5275,
            numTurns: 1,
            modelUsage: {
              'claude-fable-5-1': expect.objectContaining({ costUSD: 0.15846375 }),
            },
          },
        },
      }));
    });

    it('maps allowed_warning and rejected rate-limit statuses onto warned and blocked', () => {
      for (const [status, expected] of [
        ['allowed_warning', 'warned'],
        ['rejected', 'blocked'],
      ] as const) {
        const [event] = toEventList(new ClaudeProvider().parseStreamLine(JSON.stringify({
          type: 'rate_limit_event',
          rate_limit_info: {
            status,
            rateLimitType: 'seven_day',
            unifiedWindows: { seven_day: { utilization: 1 } },
          },
        })));

        expect(event?.type).toBe('progress');
        expect(event?.metadata).toEqual(expect.objectContaining({
          kind: 'quota',
          status: expected,
          quota: expect.objectContaining({
            status,
            rateLimitType: 'seven_day',
            'seven_day.utilization': 1,
          }),
        }));
      }
    });

    it('leaves result metadata without quota until a rate_limit_event was observed', () => {
      const result = new ClaudeProvider().parseStreamLine(JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: 'claude-abc',
        usage: { input_tokens: 1, output_tokens: 1 },
      }));

      expect(result?.usage?.estimatedCost).toBeUndefined();
      expect(result?.metadata).toEqual({
        native: { sourceEvent: 'result', subtype: 'success' },
      });
    });

    it('passes rate_limit_event without rate_limit_info through as raw', () => {
      const event = new ClaudeProvider().parseStreamLine(JSON.stringify({
        type: 'rate_limit_event',
        session_id: 'claude-abc',
      }));
      expect(event?.type).toBe('raw');
    });

    it('returns raw for non-JSON lines', () => {
      const event = provider.parseStreamLine('Starting Claude...');
      expect(event?.type).toBe('raw');
      expect(event?.text).toBe('Starting Claude...');
    });

    it('returns null for empty lines', () => {
      expect(provider.parseStreamLine('')).toBeNull();
      expect(provider.parseStreamLine('  ')).toBeNull();
    });
  });
});
