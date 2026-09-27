import { describe, expect, it } from 'vitest';
import type { StreamEvent } from './types.js';
import { CursorProvider } from './cursor.js';

/** An assistant line as Cursor's stream-json writer shapes it. */
function assistantLine(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    session_id: 'cursor-123',
    ...extra,
  });
}

/** Feed lines through the provider and return the text it would show. */
function streamedText(provider: CursorProvider, lines: string[]): string {
  return lines
    .flatMap((line) => {
      const parsed = provider.parseStreamLine(line);
      if (parsed === null) return [];
      return Array.isArray(parsed) ? parsed : [parsed];
    })
    .filter((event): event is Extract<StreamEvent, { type: 'text' }> => event.type === 'text')
    .map((event) => event.text)
    .join('');
}

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

  it('shows text before a tool call once, not again when Cursor replays it', () => {
    // Cursor replays the streamed segment, tagged model_call_id, before each
    // tool call; showing it made every such segment appear twice.
    const provider = new CursorProvider();

    expect(streamedText(provider, [
      assistantLine('只有「Instructions:」，', { timestamp_ms: 1 }),
      assistantLine('我先查看工作區。', { timestamp_ms: 2 }),
      assistantLine('只有「Instructions:」，我先查看工作區。', { timestamp_ms: 3, model_call_id: 'm1' }),
      JSON.stringify({ type: 'tool_call', subtype: 'started', call_id: 'c1', model_call_id: 'm1', timestamp_ms: 4 }),
      JSON.stringify({ type: 'tool_call', subtype: 'completed', call_id: 'c1', model_call_id: 'm1', timestamp_ms: 5 }),
      assistantLine('工作區是空的。', { timestamp_ms: 6 }),
      assistantLine('工作區是空的。'),
      JSON.stringify({ type: 'result', subtype: 'success', session_id: 'cursor-123' }),
    ])).toBe('只有「Instructions:」，我先查看工作區。工作區是空的。');
  });

  it('drops the untagged replay Cursor writes before a retry or an interaction query', () => {
    const provider = new CursorProvider();

    expect(streamedText(provider, [
      assistantLine('Searching ', { timestamp_ms: 1 }),
      assistantLine('the web.', { timestamp_ms: 2 }),
      assistantLine('Searching the web.', { timestamp_ms: 3 }),
      JSON.stringify({ type: 'interaction_query', subtype: 'request', timestamp_ms: 4 }),
      assistantLine('Found it.', { timestamp_ms: 5 }),
      assistantLine('Found it.', { timestamp_ms: 6 }),
      JSON.stringify({ type: 'retry', subtype: 'starting', timestamp_ms: 7 }),
      assistantLine('Done.', { timestamp_ms: 8 }),
      assistantLine('Done.'),
    ])).toBe('Searching the web.Found it.Done.');
  });

  it('keeps a delta that repeats everything so far, like 好 then 好', () => {
    const provider = new CursorProvider();

    expect(streamedText(provider, [
      assistantLine('好', { timestamp_ms: 1 }),
      assistantLine('好', { timestamp_ms: 2 }),
      assistantLine('休息。', { timestamp_ms: 3 }),
      assistantLine('好好休息。'),
    ])).toBe('好好休息。');

    // Held until the next line, and released even when that line is the end.
    const another = new CursorProvider();
    expect(streamedText(another, [
      assistantLine('好', { timestamp_ms: 1 }),
      assistantLine('好', { timestamp_ms: 2 }),
      assistantLine('好好'),
    ])).toBe('好好');
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

  it('promotes assistant content tool_use blocks into progress plus tool_use', () => {
    const provider = new CursorProvider();

    expect(provider.parseStreamLine(JSON.stringify({
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
    }))).toEqual([
      expect.objectContaining({
        type: 'progress',
        text: 'Running tool: read_file',
      }),
      {
        type: 'tool_use',
        toolName: 'read_file',
        toolId: 'tool-1',
        toolArgs: { path: 'README.md' },
      },
    ]);
  });

  it('promotes assistant content tool_result blocks into progress plus tool_result', () => {
    const provider = new CursorProvider();

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: { ok: true },
        }],
      },
    }))).toEqual([
      expect.objectContaining({
        type: 'progress',
        text: 'Cursor completed a tool call.',
      }),
      {
        type: 'tool_result',
        toolId: 'tool-1',
        text: '{"ok":true}',
      },
    ]);
  });

  it('promotes assistant reasoning blocks into shared progress updates', () => {
    const provider = new CursorProvider();

    expect(provider.parseStreamLine(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'thinking',
          thinking: 'Checking the repo.',
        }],
      },
    }))).toEqual(expect.objectContaining({
      type: 'progress',
      text: 'Checking the repo.',
      metadata: expect.objectContaining({
        kind: 'reasoning',
        provider: 'cursor',
      }),
    }));
  });

  it('still suppresses duplicate final text after partial chunks while preserving non-text blocks', () => {
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
        content: [
          { type: 'text', text: 'Hello world' },
          { type: 'tool_result', tool_use_id: 'tool-1', content: 'done' },
        ],
      },
    }))).toEqual([
      expect.objectContaining({
        type: 'progress',
      }),
      {
        type: 'tool_result',
        toolId: 'tool-1',
        text: 'done',
      },
    ]);
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

  it('classifies unsupported cursor model errors as provider refusals', () => {
    const provider = new CursorProvider();

    expect(provider.classifyLaunchFailure?.({
      source: 'stderr',
      line: 'Cannot use this model: gpt-5.4. Available models: auto, composer-2-fast, gpt-5.4-medium',
      stderrLines: [
        'Cannot use this model: gpt-5.4. Available models: auto, composer-2-fast, gpt-5.4-medium',
      ],
    })).toEqual({
      category: 'provider_rejected',
      message: 'Cursor cannot use model \'gpt-5.4\'. Available models: auto, composer-2-fast, gpt-5.4-medium',
      retryable: false,
      source: 'stderr',
      evidenceSummary: 'Cannot use this model: gpt-5.4. Available models: auto, composer-2-fast, gpt-5.4-medium | Cannot use this model: gpt-5.4. Available models: auto, composer-2-fast, gpt-5.4-medium',
      metadata: {
        rejectedModel: 'gpt-5.4',
        availableModels: ['auto', 'composer-2-fast', 'gpt-5.4-medium'],
      },
    });
  });
});
