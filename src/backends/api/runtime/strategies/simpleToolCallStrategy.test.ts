import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../../../../core/types.js';
import type { ApiToolCallPart } from '../../types.js';
import type { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';
import { simpleToolCallStrategy } from './simpleToolCallStrategy.js';

async function collectEvents(
  stream: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function createToolCall(): ApiToolCallPart {
  return {
    type: 'tool_call',
    id: 'call-1',
    name: 'read_file',
    arguments: { path: 'answer.txt' },
  };
}

describe('simpleToolCallStrategy', () => {
  it('returns the model result when no tool calls remain', async () => {
    const createResultEvent = vi.fn(() => ({
      type: 'result',
      sessionId: 'resp-1',
    }) satisfies StreamEvent);

    const context = {
      constraints: {
        stepLimit: 2,
        timeoutMs: 5000,
      },
      updateStrategy: vi.fn(),
      completeModelStep: vi.fn(async () => ({
        progressEvents: [{
          type: 'progress',
          text: 'provider-progress',
        }],
        textEvents: [{
          type: 'text',
          text: 'final answer',
        }],
        toolCalls: [],
      })),
      executeToolCalls: vi.fn(),
      createResultEvent,
      createFailureEvents: vi.fn(),
      isTimeoutError: () => false,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(simpleToolCallStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(1);
    expect(context.executeToolCalls).not.toHaveBeenCalled();
    expect(context.createFailureEvents).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'progress', text: 'provider-progress' },
      { type: 'text', text: 'final answer' },
      { type: 'result', sessionId: 'resp-1' },
    ]);
  });

  it('emits failure events instead of throwing when the loop limit is exhausted', async () => {
    const toolCalls = [createToolCall()];
    const createFailureEvents = vi.fn((kind: string, message: string) => ([{
      type: 'error',
      text: `${kind}:${message}`,
    }] satisfies StreamEvent[]));

    const context = {
      constraints: {
        stepLimit: 1,
        timeoutMs: 5000,
      },
      updateStrategy: vi.fn(),
      completeModelStep: vi.fn(async () => ({
        progressEvents: [],
        textEvents: [],
        toolCalls,
      })),
      executeToolCalls: vi.fn(async () => ({
        toolUseEvents: [],
        toolResultEvents: [],
        signatures: ['read_file:{"path":"answer.txt"}'],
      })),
      createResultEvent: vi.fn(),
      createFailureEvents,
      isTimeoutError: () => false,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(simpleToolCallStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(1);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(1);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'step_limit',
      'Exceeded tool loop limit of 1 steps',
      {
        stepCount: 1,
      },
      {
        emitStrategyEvent: false,
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'step_limit:Exceeded tool loop limit of 1 steps',
    }]);
  });

  it('emits timeout failure events without throwing', async () => {
    const createFailureEvents = vi.fn((kind: string, message: string, details?: Record<string, unknown>, options?: Record<string, unknown>) => ([{
      type: 'error',
      text: `${kind}:${message}:${details?.timeoutMs}:${String(options?.emitStrategyEvent)}`,
    }] satisfies StreamEvent[]));

    const context = {
      constraints: {
        stepLimit: 1,
        timeoutMs: 250,
      },
      updateStrategy: vi.fn(),
      completeModelStep: vi.fn(async () => {
        throw new Error('request aborted');
      }),
      executeToolCalls: vi.fn(),
      createResultEvent: vi.fn(),
      createFailureEvents,
      isTimeoutError: () => true,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(simpleToolCallStrategy.execute(context));

    expect(createFailureEvents).toHaveBeenCalledWith(
      'timeout',
      'Runtime execution strategy timed out after 250ms.',
      {
        timeoutMs: 250,
      },
      {
        emitStrategyEvent: false,
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'timeout:Runtime execution strategy timed out after 250ms.:250:false',
    }]);
  });
});
