import { describe, it, expect } from 'vitest';
import { parseJunieSessionEventLine, parseJunieStreamLine } from './parser.js';

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
    expect(Array.isArray(event)).toBe(true);
    expect(event).toEqual([
      { type: 'text', text: '### Summary\n- 4' },
      expect.objectContaining({
        type: 'result',
        sessionId: 'session-260317-070403-d8r2',
        usage: {
          inputTokens: 350,
          outputTokens: 80,
          estimatedCost: 0.03,
        },
        metadata: {
          runtimeUsage: {
            totalTokens: 430,
            estimatedCost: 0.03,
            currency: 'USD',
            sourceConfidence: 'aggregated',
          },
        },
      }),
    ]);
  });

  it('parses result without usage', () => {
    const event = parseJunieStreamLine(JSON.stringify({
      sessionId: 'session-1',
      taskName: 'Test',
      result: 'Done',
    }));
    expect(event).toEqual([
      { type: 'text', text: 'Done' },
      { type: 'result', sessionId: 'session-1', usage: undefined },
    ]);
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

  it('parses Junie status updates into normalized progress events', () => {
    const parsed = parseJunieSessionEventLine(JSON.stringify({
      kind: 'SessionA2uxEvent',
      event: {
        state: 'IN_PROGRESS',
        agentEvent: {
          kind: 'AgentCurrentStatusUpdatedEvent',
          status: 'Sending LLM request',
        },
      },
    }), { sessionId: 'session-3' });

    expect(parsed).toEqual({
      events: [expect.objectContaining({
        type: 'progress',
        sessionId: 'session-3',
        text: 'Sending LLM request',
        raw: {
          kind: 'AgentCurrentStatusUpdatedEvent',
          status: 'Sending LLM request',
        },
        metadata: {
          provider: 'junie',
          backend: 'cli',
          kind: 'status',
          status: 'running',
          source: 'provider',
          native: {
            source: 'junie-progress',
            progressKind: 'status',
            state: 'IN_PROGRESS',
          },
        },
      })],
    });
  });

  it('aggregates usage from Junie LLM metadata events', () => {
    const parsed = parseJunieSessionEventLine(JSON.stringify({
      kind: 'SessionA2uxEvent',
      event: {
        state: 'IN_PROGRESS',
        agentEvent: {
          kind: 'LlmResponseMetadataEvent',
          modelUsage: [
            {
              model: 'gpt-5.2',
              inputTokens: 10,
              cacheInputTokens: 5,
              cacheCreateTokens: 2,
              outputTokens: 3,
            },
          ],
        },
      },
    }));

    expect(parsed).toEqual({
      events: [],
      usageDelta: {
        inputTokens: 17,
        outputTokens: 3,
        estimatedCost: undefined,
      },
    });
  });

  it('parses Junie thought updates into normalized progress events', () => {
    const parsed = parseJunieSessionEventLine(JSON.stringify({
      kind: 'SessionA2uxEvent',
      event: {
        state: 'IN_PROGRESS',
        agentEvent: {
          kind: 'AgentThoughtBlockUpdatedEvent',
          text: 'Delivering the PRD now.',
        },
      },
    }), { sessionId: 'session-thought' });

    expect(parsed).toEqual({
      events: [expect.objectContaining({
        type: 'progress',
        sessionId: 'session-thought',
        text: 'Delivering the PRD now.',
        raw: {
          kind: 'AgentThoughtBlockUpdatedEvent',
          text: 'Delivering the PRD now.',
        },
        metadata: {
          provider: 'junie',
          backend: 'cli',
          kind: 'reasoning',
          status: 'running',
          source: 'provider',
          native: {
            source: 'junie-progress',
            progressKind: 'thought',
            state: 'IN_PROGRESS',
          },
        },
      })],
    });
  });

  it('promotes structured Junie tool start updates into progress plus tool_use', () => {
    const parsed = parseJunieSessionEventLine(JSON.stringify({
      kind: 'SessionA2uxEvent',
      event: {
        state: 'IN_PROGRESS',
        agentEvent: {
          kind: 'ToolBlockUpdatedEvent',
          status: 'IN_PROGRESS',
          toolName: 'read_file',
          toolId: 'tool-1',
          text: 'Running read_file',
        },
      },
    }), { sessionId: 'session-tool' });

    expect(parsed).toEqual({
      events: [
        expect.objectContaining({
          type: 'progress',
          sessionId: 'session-tool',
          text: 'Running read_file',
          metadata: {
            provider: 'junie',
            backend: 'cli',
            kind: 'tool',
            status: 'running',
            source: 'provider',
            native: {
              source: 'junie-progress',
              progressKind: 'tool',
              state: 'IN_PROGRESS',
              toolName: 'read_file',
              toolId: 'tool-1',
            },
          },
        }),
        {
          type: 'tool_use',
          toolName: 'read_file',
          toolId: 'tool-1',
        },
      ],
    });
  });

  it('promotes structured Junie tool completion updates into progress plus tool_result', () => {
    const parsed = parseJunieSessionEventLine(JSON.stringify({
      kind: 'SessionA2uxEvent',
      event: {
        state: 'IN_PROGRESS',
        agentEvent: {
          kind: 'ToolBlockUpdatedEvent',
          status: 'COMPLETED',
          toolName: 'read_file',
          toolId: 'tool-1',
          output: { ok: true },
        },
      },
    }), { sessionId: 'session-tool' });

    expect(parsed).toEqual({
      events: [
        expect.objectContaining({
          type: 'progress',
          sessionId: 'session-tool',
          text: 'Junie completed tool: read_file',
          metadata: {
            provider: 'junie',
            backend: 'cli',
            kind: 'tool',
            status: 'updated',
            source: 'provider',
            native: {
              source: 'junie-progress',
              progressKind: 'tool',
              state: 'IN_PROGRESS',
              toolName: 'read_file',
              toolId: 'tool-1',
            },
          },
        }),
        {
          type: 'tool_result',
          toolName: 'read_file',
          toolId: 'tool-1',
          text: '{"ok":true}',
        },
      ],
    });
  });

  it('parses Junie result block into text and result events', () => {
    const parsed = parseJunieSessionEventLine(JSON.stringify({
      kind: 'SessionA2uxEvent',
      event: {
        state: 'IN_PROGRESS',
        agentEvent: {
          kind: 'ResultBlockUpdatedEvent',
          cancelled: false,
          result: 'Implemented the feature.',
        },
      },
    }), {
      sessionId: 'session-4',
      usage: {
        inputTokens: 12,
        outputTokens: 8,
      },
    });

    expect(parsed).toEqual({
      events: [
        { type: 'text', text: 'Implemented the feature.' },
        {
          type: 'result',
          sessionId: 'session-4',
          usage: {
            inputTokens: 12,
            outputTokens: 8,
          },
          metadata: {
            runtimeUsage: {
              totalTokens: 20,
              sourceConfidence: 'aggregated',
            },
          },
        },
      ],
      terminal: true,
    });
  });
});
