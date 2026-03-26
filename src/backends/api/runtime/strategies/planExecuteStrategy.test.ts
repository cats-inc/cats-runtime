import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../../../../core/types.js';
import type { ApiToolCallPart } from '../../types.js';
import { planExecuteStrategy } from './planExecuteStrategy.js';
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

describe('planExecuteStrategy', () => {
  it('completes after a bounded plan and execution cycle', async () => {
    const createStrategyEvent = vi.fn((strategyEvent: string, status: string) => ({
      type: 'progress',
      text: `${strategyEvent}:${status}`,
    }) satisfies StreamEvent);
    const createResultEvent = vi.fn(() => ({
      type: 'result',
      sessionId: 'resp-1',
    }) satisfies StreamEvent);
    const appendRuntimeGuidance = vi.fn();

    const context = {
      constraints: {
        stepLimit: 3,
        stuckThreshold: 2,
        timeoutMs: 5000,
      },
      emitLifecycleEvents: true,
      request: {
        acceptanceCriteria: 'Return only the verified file value.',
      },
      updateStrategy: vi.fn(),
      completeModelStep: vi
        .fn()
        .mockResolvedValueOnce({
          progressEvents: [{ type: 'progress', text: 'provider-progress' }],
          textEvents: [{ type: 'text', text: 'Plan: inspect answer.txt.' }],
          toolCalls: [createToolCall()],
        })
        .mockResolvedValueOnce({
          progressEvents: [],
          textEvents: [{ type: 'text', text: '42' }],
          toolCalls: [],
        }),
      executeToolCalls: vi.fn(async () => ({
        toolUseEvents: [{ type: 'tool_use', toolName: 'read_file', toolId: 'call-1' }],
        toolResultEvents: [{ type: 'tool_result', toolName: 'read_file', toolId: 'call-1', text: '42' }],
        signatures: ['read_file:{"path":"answer.txt"}'],
      })),
      appendRuntimeGuidance,
      createFailureEvents: vi.fn(),
      createStrategyEvent,
      createResultEvent,
      isTimeoutError: () => false,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(planExecuteStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(1);
    expect(createStrategyEvent).toHaveBeenCalledWith(
      'strategy_started',
      'started',
      'Running runtime-owned plan_execute strategy.',
    );
    expect(createStrategyEvent).toHaveBeenCalledWith(
      'strategy_completed',
      'completed',
      'Plan-execute strategy completed successfully.',
      {
        step: 2,
        executedSteps: 1,
      },
    );
    expect(appendRuntimeGuidance).toHaveBeenCalledWith(expect.stringContaining(
      'Runtime plan_execute guidance for step 1',
    ));
    expect(events).toEqual(expect.arrayContaining([
      { type: 'progress', text: 'strategy_started:started' },
      { type: 'progress', text: 'strategy_plan:updated' },
      { type: 'progress', text: 'provider-progress' },
      { type: 'text', text: 'Plan: inspect answer.txt.' },
      { type: 'progress', text: 'strategy_tool_call:updated' },
      { type: 'tool_use', toolName: 'read_file', toolId: 'call-1' },
      { type: 'tool_result', toolName: 'read_file', toolId: 'call-1', text: '42' },
      { type: 'progress', text: 'strategy_evaluation:updated' },
      { type: 'progress', text: 'strategy_completed:completed' },
      { type: 'result', sessionId: 'resp-1' },
    ]));
  });

  it('fails when repeated tool calls make the plan loop stuck', async () => {
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
      appendRuntimeGuidance: vi.fn(),
      createFailureEvents,
      isTimeoutError: () => false,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(planExecuteStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(1);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'stuck',
      'Plan-execute strategy detected repeated tool calls after 2 consecutive plans.',
      {
        stepCount: 2,
        duplicateStepCount: 2,
        lastStepSignature: 'read_file:{"path":"answer.txt"}',
        localState: {
          currentPhase: 'plan',
          plannedSteps: 2,
          executedSteps: 1,
          consecutiveDuplicateToolCalls: 2,
          lastToolCallSignature: 'read_file:{"path":"answer.txt"}',
        },
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'stuck:Plan-execute strategy detected repeated tool calls after 2 consecutive plans.',
    }]);
  });
});
