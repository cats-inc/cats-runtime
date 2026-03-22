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

  it('does not end the stream on turn_end for tool-use turns', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'turn_end',
      message: {
        role: 'assistant',
        stopReason: 'toolUse',
        usage: {
          input: 100,
          output: 50,
        },
      },
      toolResults: [
        {
          role: 'toolResult',
          toolCallId: 'tc_1',
        },
      ],
    }));
    expect(event).toBeNull();
  });

  it('parses turn_end without message as result', () => {
    const event = parsePiStreamLine(JSON.stringify({ type: 'turn_end' }));
    expect(event?.type).toBe('result');
  });

  it('skips message_start and message_end RPC events', () => {
    expect(parsePiStreamLine(JSON.stringify({
      type: 'message_start',
      message: { role: 'assistant', content: [] },
    }))).toBeNull();
    expect(parsePiStreamLine(JSON.stringify({
      type: 'message_end',
      message: { role: 'assistant', content: [] },
    }))).toBeNull();
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

  it('parses message_update thinking as reasoning progress', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'thinking',
        delta: 'hmm...',
      },
    }));
    expect(event).toEqual(expect.objectContaining({
      type: 'progress',
      text: 'hmm...',
      metadata: expect.objectContaining({
        provider: 'pi',
        backend: 'cli',
        kind: 'reasoning',
        status: 'running',
      }),
    }));
  });

  it('parses tool_execution_start', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'tool_execution_start',
      toolCallId: 'tc_1',
      toolName: 'bash',
      args: { command: 'ls' },
    }));
    expect(event).toEqual([
      expect.objectContaining({
        type: 'progress',
        text: 'Running tool: bash',
        metadata: expect.objectContaining({
          provider: 'pi',
          backend: 'cli',
          kind: 'tool',
          status: 'running',
        }),
      }),
      {
        type: 'tool_use',
        toolName: 'bash',
        toolId: 'tc_1',
      },
    ]);
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

  it('skips tool_execution_update', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'tool_execution_update',
      toolCallId: 'tc_1',
      toolName: 'read',
      partialResult: { content: [{ type: 'text', text: 'partial' }] },
    }));
    expect(event).toBeNull();
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

describe('parsePiStreamLine current message schema', () => {
  it('parses assistant tool-call messages emitted by current Pi sessions', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'message',
      stopReason: 'toolUse',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'checking...' },
          {
            type: 'toolCall',
            id: 'call_123',
            name: 'bash',
            arguments: { command: 'pwd' },
          },
        ],
        usage: {
          input: 10,
          output: 5,
        },
      },
    }));

    expect(event).toEqual([
      expect.objectContaining({
        type: 'progress',
        text: 'checking...',
        metadata: expect.objectContaining({
          provider: 'pi',
          backend: 'cli',
          kind: 'reasoning',
          status: 'running',
        }),
      }),
      {
        type: 'tool_use',
        toolId: 'call_123',
        toolName: 'bash',
        toolArgs: { command: 'pwd' },
      },
    ]);
  });

  it('parses final assistant messages into text and result events', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'message',
      stopReason: 'stop',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'done thinking' },
          { type: 'text', text: 'NEXT: Agent-2' },
        ],
        usage: {
          input: 162,
          output: 255,
          cacheRead: 1792,
        },
      },
    }));

    expect(event).toEqual([
      expect.objectContaining({
        type: 'progress',
        text: 'done thinking',
        metadata: expect.objectContaining({
          provider: 'pi',
          backend: 'cli',
          kind: 'reasoning',
          status: 'running',
        }),
      }),
      { type: 'text', text: 'NEXT: Agent-2' },
      {
        type: 'result',
        usage: {
          inputTokens: 1954,
          outputTokens: 255,
        },
        metadata: {
          runtimeUsage: {
            totalTokens: 2209,
            sourceConfidence: 'reported',
          },
        },
      },
    ]);
  });

  it('parses tool result messages emitted by current Pi sessions', () => {
    const event = parsePiStreamLine(JSON.stringify({
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: 'call_123',
        toolName: 'bash',
        content: [{ type: 'text', text: 'MISSING\n' }],
        isError: false,
      },
    }));

    expect(event).toEqual({
      type: 'tool_result',
      toolId: 'call_123',
      toolName: 'bash',
      text: 'MISSING\n',
      isError: false,
    });
  });

  it('does not emit result during the intermediate tool-use turn in RPC flow', () => {
    const lines = [
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'read',
        args: { path: 'alpha.txt' },
      }),
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 'call_1',
        toolName: 'read',
        result: { content: [{ type: 'text', text: 'ALPHA_CONTENT\n' }] },
        isError: false,
      }),
      JSON.stringify({
        type: 'turn_end',
        message: {
          role: 'assistant',
          stopReason: 'toolUse',
          usage: {
            input: 900,
            output: 33,
          },
        },
      }),
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: 'ALPHA_CONTENT',
        },
      }),
      JSON.stringify({
        type: 'turn_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          usage: {
            input: 947,
            output: 7,
          },
        },
      }),
    ];

    const events = lines
      .map((line) => parsePiStreamLine(line))
      .flatMap((event) => (event ? (Array.isArray(event) ? event : [event]) : []));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'progress',
        text: 'Running tool: read',
        metadata: expect.objectContaining({
          provider: 'pi',
          backend: 'cli',
          kind: 'tool',
          status: 'running',
        }),
      }),
      {
        type: 'tool_use',
        toolId: 'call_1',
        toolName: 'read',
      },
      {
        type: 'tool_result',
        toolId: 'call_1',
        text: JSON.stringify({ content: [{ type: 'text', text: 'ALPHA_CONTENT\n' }] }),
        isError: false,
      },
      {
        type: 'text',
        text: 'ALPHA_CONTENT',
      },
      {
        type: 'result',
        usage: {
          inputTokens: 947,
          outputTokens: 7,
        },
        metadata: {
          runtimeUsage: {
            totalTokens: 954,
            sourceConfidence: 'reported',
          },
        },
      },
    ]);
  });
});
