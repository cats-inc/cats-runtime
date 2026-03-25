import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '../../../../core/types.js';
import type { ApiToolCallPart } from '../../types.js';
import type { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';
import { reflexionStrategy } from './reflexionStrategy.js';

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

describe('reflexionStrategy', () => {
  it('adds a reflection pass before completing a direct answer', async () => {
    const createStrategyEvent = vi.fn((strategyEvent: string, status: string) => ({
      type: 'progress',
      text: `${strategyEvent}:${status}`,
    }) satisfies StreamEvent);
    const createResultEvent = vi.fn(() => ({
      type: 'result',
      sessionId: 'resp-1',
    }) satisfies StreamEvent);
    const appendRuntimeGuidance = vi.fn();

    const completeModelStep = vi.fn()
      .mockResolvedValueOnce({
        progressEvents: [{ type: 'progress', text: 'provider-progress-1' }],
        textEvents: [{ type: 'text', text: 'draft answer' }],
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        progressEvents: [{ type: 'progress', text: 'provider-progress-2' }],
        textEvents: [{ type: 'text', text: 'revised answer' }],
        toolCalls: [],
      });

    const context = {
      request: {
        acceptanceCriteria: 'Return only the verified answer.',
      },
      constraints: {
        stepLimit: 3,
        stuckThreshold: 3,
        timeoutMs: 5000,
      },
      emitLifecycleEvents: true,
      updateStrategy: vi.fn(),
      completeModelStep,
      executeToolCalls: vi.fn(),
      appendRuntimeGuidance,
      createFailureEvents: vi.fn(),
      createStrategyEvent,
      createResultEvent,
      isTimeoutError: () => false,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(reflexionStrategy.execute(context));

    expect(completeModelStep).toHaveBeenCalledTimes(2);
    expect(appendRuntimeGuidance).toHaveBeenCalledTimes(1);
    expect(String(appendRuntimeGuidance.mock.calls[0]?.[0])).toContain('Acceptance criteria');
    expect(events).toEqual([
      { type: 'progress', text: 'strategy_started:started' },
      { type: 'progress', text: 'strategy_step:updated' },
      { type: 'progress', text: 'provider-progress-1' },
      { type: 'text', text: 'draft answer' },
      { type: 'progress', text: 'strategy_reflection:updated' },
      { type: 'progress', text: 'strategy_step:updated' },
      { type: 'progress', text: 'provider-progress-2' },
      { type: 'text', text: 'revised answer' },
      { type: 'progress', text: 'strategy_completed:completed' },
      { type: 'result', sessionId: 'resp-1' },
    ]);
  });

  it('fails when repeated tool calls make the reflexion loop stuck', async () => {
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

    const events = await collectEvents(reflexionStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(2);
    expect(context.executeToolCalls).toHaveBeenCalledTimes(1);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'stuck',
      'Reflexion strategy detected repeated tool calls after 2 consecutive steps.',
      expect.objectContaining({
        stepCount: 2,
        duplicateStepCount: 2,
        lastStepSignature: 'read_file:{"path":"answer.txt"}',
        localState: expect.objectContaining({
          reflectionCount: 1,
          consecutiveDuplicateToolCalls: 2,
        }),
      }),
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'stuck:Reflexion strategy detected repeated tool calls after 2 consecutive steps.',
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
      appendRuntimeGuidance: vi.fn(),
      createFailureEvents,
      isTimeoutError: () => true,
    } as unknown as ApiStrategyExecutionContext;

    const events = await collectEvents(reflexionStrategy.execute(context));

    expect(context.completeModelStep).toHaveBeenCalledTimes(1);
    expect(createFailureEvents).toHaveBeenCalledWith(
      'timeout',
      'Reflexion strategy timed out after 250ms.',
      {
        timeoutMs: 250,
      },
    );
    expect(events).toEqual([{
      type: 'error',
      text: 'timeout:Reflexion strategy timed out after 250ms.:250',
    }]);
  });
});
