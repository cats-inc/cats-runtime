import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../../../../core/types.js';
import type { ApiToolCallPart } from '../../types.js';
import { reactStrategy } from './reactStrategy.js';
import type { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';

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

describe('reactStrategy', () => {
  it('fails once the runtime-owned step limit is exhausted', async () => {
    const toolCalls = [createToolCall()];
    const createFailureEvents = vi.fn((kind: string, message: string) => ([{
      type: 'error',
      text: `${kind}:${message}`,
    }] satisfies StreamEvent[]));

    const context = {
      constraints: {
        stepLimit: 2,
        stuckThreshold: 3,
        timeoutMs: 5000,
      },
      emitLifecycleEvents: false,
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
      createFailureEvents,
      isTimeoutError: () => false,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(reactStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(2);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'step_limit',
      'ReAct strategy exceeded step limit of 2.',
      {
        stepCount: 2,
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'step_limit:ReAct strategy exceeded step limit of 2.',
    }]);
  });

  it('fails when repeated tool calls make the loop stuck', async () => {
    const toolCalls = [createToolCall()];
    const createFailureEvents = vi.fn((kind: string, message: string) => ([{
      type: 'error',
      text: `${kind}:${message}`,
    }] satisfies StreamEvent[]));

    const context = {
      constraints: {
        stepLimit: 4,
        stuckThreshold: 2,
        timeoutMs: 5000,
      },
      emitLifecycleEvents: false,
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
      createFailureEvents,
      isTimeoutError: () => false,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(reactStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(1);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'stuck',
      'ReAct strategy detected repeated tool calls after 2 consecutive steps.',
      {
        stepCount: 2,
        duplicateStepCount: 2,
        lastStepSignature: 'read_file:{"path":"answer.txt"}',
        localState: {
          consecutiveDuplicateToolCalls: 2,
          lastToolCallSignature: 'read_file:{"path":"answer.txt"}',
        },
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'stuck:ReAct strategy detected repeated tool calls after 2 consecutive steps.',
    }]);
  });

  it('maps timeout errors into failure events', async () => {
    const createFailureEvents = vi.fn((kind: string, message: string, details?: Record<string, unknown>) => ([{
      type: 'error',
      text: `${kind}:${message}:${details?.timeoutMs}`,
    }] satisfies StreamEvent[]));

    const context = {
      constraints: {
        stepLimit: 2,
        stuckThreshold: 3,
        timeoutMs: 250,
      },
      emitLifecycleEvents: false,
      updateStrategy: vi.fn(),
      completeModelStep: vi.fn(async () => {
        throw new Error('request aborted');
      }),
      executeToolCalls: vi.fn(),
      createFailureEvents,
      isTimeoutError: () => true,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(reactStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(1);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'timeout',
      'ReAct strategy timed out after 250ms.',
      {
        timeoutMs: 250,
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'timeout:ReAct strategy timed out after 250ms.:250',
    }]);
  });

  it('completes immediately when no tool calls remain and emits lifecycle events', async () => {
    const createStrategyEvent = vi.fn((strategyEvent: string, status: string) => ({
      type: 'progress',
      text: `${strategyEvent}:${status}`,
    }) satisfies StreamEvent);
    const createResultEvent = vi.fn(() => ({
      type: 'result',
      sessionId: 'resp-1',
    }) satisfies StreamEvent);

    const context = {
      constraints: {
        stepLimit: 2,
        stuckThreshold: 3,
        timeoutMs: 5000,
      },
      emitLifecycleEvents: true,
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
      createFailureEvents: vi.fn(),
      createStrategyEvent,
      createResultEvent,
      isTimeoutError: () => false,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(reactStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(1);
    expect(context.executeToolCalls).not.toHaveBeenCalled();
    expect(createStrategyEvent).toHaveBeenCalledWith(
      'strategy_started',
      'started',
      'Running runtime-owned react strategy.',
    );
    expect(createStrategyEvent).toHaveBeenCalledWith(
      'strategy_completed',
      'completed',
      'ReAct strategy completed successfully.',
      {
        step: 1,
      },
    );
    expect(events).toEqual([
      { type: 'progress', text: 'strategy_started:started' },
      { type: 'progress', text: 'strategy_step:updated' },
      { type: 'progress', text: 'provider-progress' },
      { type: 'text', text: 'final answer' },
      { type: 'progress', text: 'strategy_evaluation:updated' },
      { type: 'progress', text: 'strategy_completed:completed' },
      { type: 'result', sessionId: 'resp-1' },
    ]);
  });
});
