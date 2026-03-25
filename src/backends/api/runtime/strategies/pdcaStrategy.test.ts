import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../../../../core/types.js';
import type { ApiToolCallPart } from '../../types.js';
import type { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';
import { pdcaStrategy } from './pdcaStrategy.js';

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

describe('pdcaStrategy', () => {
  it('fails once the runtime-owned cycle limit is exhausted', async () => {
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

    const events = await collectEvents(pdcaStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(2);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'step_limit',
      'PDCA strategy exceeded cycle limit of 2.',
      {
        stepCount: 2,
        localState: {
          currentPhase: 'act',
          completedCycles: 2,
        },
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'step_limit:PDCA strategy exceeded cycle limit of 2.',
    }]);
  });

  it('fails when repeated tool calls make the pdca loop stuck', async () => {
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

    const events = await collectEvents(pdcaStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(1);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'stuck',
      'PDCA strategy detected repeated tool calls after 2 consecutive cycles.',
      {
        stepCount: 2,
        duplicateStepCount: 2,
        lastStepSignature: 'read_file:{"path":"answer.txt"}',
        localState: {
          currentPhase: 'plan',
          completedCycles: 1,
          consecutiveDuplicateToolCalls: 2,
          lastToolCallSignature: 'read_file:{"path":"answer.txt"}',
        },
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'stuck:PDCA strategy detected repeated tool calls after 2 consecutive cycles.',
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

    const events = await collectEvents(pdcaStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(1);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'timeout',
      'PDCA strategy timed out after 250ms.',
      {
        timeoutMs: 250,
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'timeout:PDCA strategy timed out after 250ms.:250',
    }]);
  });

  it('completes after a bounded pdca cycle and emits phase events', async () => {
    const createStrategyEvent = vi.fn((strategyEvent: string, status: string) => ({
      type: 'progress',
      text: `${strategyEvent}:${status}`,
    }) satisfies StreamEvent);
    const createResultEvent = vi.fn(() => ({
      type: 'result',
      sessionId: 'resp-1',
    }) satisfies StreamEvent);

    const completeModelStep = vi.fn()
      .mockResolvedValueOnce({
        progressEvents: [{
          type: 'progress',
          text: 'provider-progress-1',
        }],
        textEvents: [{
          type: 'text',
          text: 'planning answer',
        }],
        toolCalls: [createToolCall()],
      })
      .mockResolvedValueOnce({
        progressEvents: [{
          type: 'progress',
          text: 'provider-progress-2',
        }],
        textEvents: [{
          type: 'text',
          text: 'final answer',
        }],
        toolCalls: [],
      });

    const context = {
      constraints: {
        stepLimit: 3,
        stuckThreshold: 3,
        timeoutMs: 5000,
      },
      emitLifecycleEvents: true,
      updateStrategy: vi.fn(),
      completeModelStep,
      executeToolCalls: vi.fn(async () => ({
        toolUseEvents: [{ type: 'tool_use', toolName: 'read_file', toolId: 'call-1' }],
        toolResultEvents: [{ type: 'tool_result', toolName: 'read_file', toolId: 'call-1', text: '42' }],
        signatures: ['read_file:{"path":"answer.txt"}'],
      })),
      createFailureEvents: vi.fn(),
      createStrategyEvent,
      createResultEvent,
      isTimeoutError: () => false,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(pdcaStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(1);
    expect(createStrategyEvent).toHaveBeenCalledWith(
      'strategy_started',
      'started',
      'Running runtime-owned pdca strategy.',
    );
    expect(createStrategyEvent).toHaveBeenCalledWith(
      'strategy_completed',
      'completed',
      'PDCA strategy completed successfully.',
      {
        cycle: 2,
      },
    );
    expect(events).toEqual([
      { type: 'progress', text: 'strategy_started:started' },
      { type: 'progress', text: 'strategy_plan:updated' },
      { type: 'progress', text: 'provider-progress-1' },
      { type: 'text', text: 'planning answer' },
      { type: 'progress', text: 'strategy_do:updated' },
      { type: 'tool_use', toolName: 'read_file', toolId: 'call-1' },
      { type: 'tool_result', toolName: 'read_file', toolId: 'call-1', text: '42' },
      { type: 'progress', text: 'strategy_check:updated' },
      { type: 'progress', text: 'strategy_act:updated' },
      { type: 'progress', text: 'strategy_plan:updated' },
      { type: 'progress', text: 'provider-progress-2' },
      { type: 'text', text: 'final answer' },
      { type: 'progress', text: 'strategy_check:updated' },
      { type: 'progress', text: 'strategy_completed:completed' },
      { type: 'result', sessionId: 'resp-1' },
    ]);
  });
});
