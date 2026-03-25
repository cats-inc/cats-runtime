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

describe('reactStrategy', () => {
  it('fails once the runtime-owned step limit is exhausted', async () => {
    const toolCalls: ApiToolCallPart[] = [{
      type: 'tool_call',
      id: 'call-1',
      name: 'read_file',
      arguments: { path: 'answer.txt' },
    }];
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
});
