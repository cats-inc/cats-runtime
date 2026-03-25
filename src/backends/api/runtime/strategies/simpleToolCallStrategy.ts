import type { RuntimeExecutionStrategy } from '../../../../core/runtime/strategies/registry.js';
import { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';

export const simpleToolCallStrategy: RuntimeExecutionStrategy<ApiStrategyExecutionContext> = {
  id: 'simple_tool_call',
  async *execute(context: ApiStrategyExecutionContext) {
    context.updateStrategy({
      status: 'running',
      stepCount: 0,
      stepLimit: context.constraints.stepLimit,
      timeoutMs: context.constraints.timeoutMs,
      lastEvent: 'strategy_started',
    });

    try {
      for (let step = 0; step < context.constraints.stepLimit; step += 1) {
        const modelStep = await context.completeModelStep(step);
        context.updateStrategy({
          status: 'running',
          stepCount: step + 1,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          lastEvent: 'strategy_step',
        });

        if (modelStep.initEvent) {
          yield modelStep.initEvent;
        }
        yield* modelStep.progressEvents;
        yield* modelStep.textEvents;

        if (modelStep.toolCalls.length === 0) {
          context.updateStrategy({
            status: 'completed',
            stepCount: step + 1,
            stepLimit: context.constraints.stepLimit,
            timeoutMs: context.constraints.timeoutMs,
            lastEvent: 'strategy_completed',
          });
          yield context.createResultEvent();
          return;
        }

        const toolBatch = await context.executeToolCalls(modelStep.toolCalls);
        yield* toolBatch.toolUseEvents;
        yield* toolBatch.toolResultEvents;
      }
    } catch (error) {
      if (context.isTimeoutError(error)) {
        yield* context.createFailureEvents(
          'timeout',
          `Runtime execution strategy timed out after ${context.constraints.timeoutMs}ms.`,
          {
            timeoutMs: context.constraints.timeoutMs,
          },
          {
            emitStrategyEvent: false,
          },
        );
        return;
      }

      throw error;
    }

    yield* context.createFailureEvents(
      'step_limit',
      `Exceeded tool loop limit of ${context.constraints.stepLimit} steps`,
      {
        stepCount: context.constraints.stepLimit,
      },
      {
        emitStrategyEvent: false,
      },
    );
  },
};
