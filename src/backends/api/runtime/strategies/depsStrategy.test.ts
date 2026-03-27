import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../../../../core/types.js';
import type { ApiToolCallPart } from '../../types.js';
import { depsStrategy } from './depsStrategy.js';
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

describe('depsStrategy', () => {
  it('completes after a bounded describe-explain-plan-select cycle', async () => {
    const createStrategyEvent = vi.fn((strategyEvent: string, status: string) => ({
      type: 'progress',
      text: `${strategyEvent}:${status}`,
    }) satisfies StreamEvent);
    const createResultEvent = vi.fn(() => ({
      type: 'result',
      sessionId: 'resp-deps-1',
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
          textEvents: [{ type: 'text', text: 'Describe: inspect answer.txt.' }],
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

    const events = await collectEvents(depsStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(1);
    expect(createStrategyEvent).toHaveBeenCalledWith(
      'strategy_started',
      'started',
      'Running runtime-owned deps strategy.',
    );
    expect(createStrategyEvent).toHaveBeenCalledWith(
      'strategy_completed',
      'completed',
      'DEPS strategy completed successfully.',
      {
        step: 2,
      },
    );
    expect(appendRuntimeGuidance).toHaveBeenCalledWith(expect.stringContaining(
      'Runtime deps guidance for step 1',
    ));
    expect(events).toEqual(expect.arrayContaining([
      { type: 'progress', text: 'strategy_started:started' },
      { type: 'progress', text: 'strategy_describe:updated' },
      { type: 'progress', text: 'strategy_explain:updated' },
      { type: 'progress', text: 'strategy_plan:updated' },
      { type: 'progress', text: 'provider-progress' },
      { type: 'text', text: 'Describe: inspect answer.txt.' },
      { type: 'progress', text: 'strategy_select:updated' },
      { type: 'progress', text: 'strategy_tool_call:updated' },
      { type: 'tool_use', toolName: 'read_file', toolId: 'call-1' },
      { type: 'tool_result', toolName: 'read_file', toolId: 'call-1', text: '42' },
      { type: 'progress', text: 'strategy_replan:updated' },
      { type: 'progress', text: 'strategy_completed:completed' },
      { type: 'result', sessionId: 'resp-deps-1' },
    ]));
  });

  it('fails when repeated tool calls make the deps loop stuck', async () => {
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

    const events = await collectEvents(depsStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(1);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'stuck',
      'DEPS strategy detected repeated tool calls after 2 consecutive selections.',
      {
        stepCount: 2,
        duplicateStepCount: 2,
        lastStepSignature: 'read_file:{"path":"answer.txt"}',
        localState: {
          currentPhase: 'select',
          describedSteps: 2,
          explainedSteps: 2,
          plannedSteps: 2,
          selectedSteps: 1,
          consecutiveDuplicateToolCalls: 2,
          lastToolCallSignature: 'read_file:{"path":"answer.txt"}',
        },
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'stuck:DEPS strategy detected repeated tool calls after 2 consecutive selections.',
    }]);
  });
});
