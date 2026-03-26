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
