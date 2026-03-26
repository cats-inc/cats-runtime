import { describe, expect, it } from 'vitest';
import { CursorProvider } from './cursor.js';

describe('CursorProvider', () => {
  it('builds ephemeral spawn args with prompt and resume support', () => {
    const provider = new CursorProvider();
    provider.prepareEphemeralTurn({ message: 'Say hi' });

    const args = provider.buildSpawnArgs({
      cwd: '/tmp/repo',
      model: 'gpt-5',
      resumeSessionId: 'cursor-session-1',
    });

    expect(args).toEqual([
      '-p',
      '--trust',
      '--output-format', 'stream-json',
      '--stream-partial-output',
      '--model', 'gpt-5',
      '--resume', 'cursor-session-1',
      'Say hi',
    ]);
  });

  it('parses init and result events with usage', () => {
    const provider = new CursorProvider();

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'cursor-123',
    }))).toEqual({
      type: 'init',
      sessionId: 'cursor-123',
    });

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'result',
      session_id: 'cursor-123',
      usage: {
        inputTokens: 12,
        outputTokens: 34,
      },
    }))).toEqual({
      type: 'result',
      sessionId: 'cursor-123',
      usage: {
        inputTokens: 12,
        outputTokens: 34,
      },
    });
  });

  it('emits assistant deltas and suppresses the duplicated final aggregate', () => {
    const provider = new CursorProvider();

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'assistant',
      timestamp_ms: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
      },
    }))).toEqual({
      type: 'text',
      text: 'Hello',
    });

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }],
      },
    }))).toBeNull();
  });

  it('falls back to the full assistant message when no partial chunks were seen', () => {
    const provider = new CursorProvider();

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }],
      },
    }))).toEqual({
      type: 'text',
      text: 'Hello world',
    });
  });

  it('promotes thinking events into shared progress updates', () => {
    const provider = new CursorProvider();

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'thinking',
      text: 'Inspecting the repository before editing.',
      timestamp_ms: 123,
    }))).toEqual({
      type: 'progress',
      text: 'Inspecting the repository before editing.',
      metadata: {
        kind: 'reasoning',
        status: 'running',
        source: 'provider',
        provider: 'cursor',
        backend: 'cli',
        native: {
          sourceEvent: 'thinking',
          timestampMs: 123,
        },
      },
    });
  });

  it('uses a bounded fallback message for empty thinking updates', () => {
    const provider = new CursorProvider();

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'thinking',
      text: '   ',
    }))).toEqual({
      type: 'progress',
      text: 'Cursor updated reasoning.',
      metadata: {
        kind: 'reasoning',
        status: 'running',
        source: 'provider',
        provider: 'cursor',
        backend: 'cli',
        native: {
          sourceEvent: 'thinking',
        },
      },
    });
  });
});
