import type { RuntimeExecutionStrategy } from '../../../../core/runtime/strategies/registry.js';
import { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';
import { updateRepeatedToolCallState, type RepeatedToolCallState } from './reactGuards.js';

export const reactStrategy: RuntimeExecutionStrategy<ApiStrategyExecutionContext> = {
  id: 'react',
  async *execute(context: ApiStrategyExecutionContext) {
    let repeatedToolCalls: RepeatedToolCallState | undefined;
    context.updateStrategy({
      status: 'running',
      stepCount: 0,
      stepLimit: context.constraints.stepLimit,
      timeoutMs: context.constraints.timeoutMs,
      duplicateStepCount: 0,
      stuckDetected: false,
      lastEvent: 'strategy_started',
    }, {
      consecutiveDuplicateToolCalls: 0,
    });

    if (context.emitLifecycleEvents) {
      yield context.createStrategyEvent(
        'strategy_started',
        'started',
        'Running runtime-owned react strategy.',
      );
    }

    try {
      for (let step = 0; step < context.constraints.stepLimit; step += 1) {
        const modelStep = await context.completeModelStep(step);
        const stepCount = step + 1;

        context.updateStrategy({
          status: 'running',
          stepCount,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls?.consecutiveCount ?? 0,
          lastStepSignature: repeatedToolCalls?.signature,
          lastEvent: 'strategy_step',
        }, {
          consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
          lastToolCallSignature: repeatedToolCalls?.signature,
        });

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_step',
            'updated',
            `ReAct step ${stepCount} of ${context.constraints.stepLimit}.`,
            {
              step: stepCount,
              stepLimit: context.constraints.stepLimit,
            },
          );
        }

        if (modelStep.initEvent) {
          yield modelStep.initEvent;
        }
        yield* modelStep.progressEvents;
        yield* modelStep.textEvents;

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_evaluation',
            'updated',
            modelStep.toolCalls.length > 0
              ? 'Evaluating tool-call plan for the next ReAct step.'
              : 'Evaluating whether the current answer satisfies the turn.',
            {
              step: stepCount,
              toolCallCount: modelStep.toolCalls.length,
            },
          );
        }

        if (modelStep.toolCalls.length === 0) {
          context.updateStrategy({
            status: 'completed',
            stepCount,
            stepLimit: context.constraints.stepLimit,
            timeoutMs: context.constraints.timeoutMs,
            duplicateStepCount: repeatedToolCalls?.consecutiveCount ?? 0,
            lastStepSignature: repeatedToolCalls?.signature,
            lastEvent: 'strategy_completed',
          }, {
            consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
            lastToolCallSignature: repeatedToolCalls?.signature,
          });
          if (context.emitLifecycleEvents) {
            yield context.createStrategyEvent(
              'strategy_completed',
              'completed',
              'ReAct strategy completed successfully.',
              {
                step: stepCount,
              },
            );
          }
          yield context.createResultEvent();
          return;
        }

        repeatedToolCalls = updateRepeatedToolCallState(
          repeatedToolCalls,
          modelStep.toolCalls,
          context.constraints.stuckThreshold,
        );
        if (repeatedToolCalls.stuck) {
          yield* context.createFailureEvents(
            'stuck',
            `ReAct strategy detected repeated tool calls after ${repeatedToolCalls.consecutiveCount} consecutive steps.`,
            {
              stepCount,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
              lastStepSignature: repeatedToolCalls.signature,
              localState: {
                consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
                lastToolCallSignature: repeatedToolCalls.signature,
              },
            },
          );
          return;
        }

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_tool_call',
            'updated',
            `ReAct selected ${modelStep.toolCalls.length} tool call(s) for step ${stepCount}.`,
            {
              step: stepCount,
              toolCallCount: modelStep.toolCalls.length,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
            },
          );
        }

        const toolBatch = await context.executeToolCalls(modelStep.toolCalls);
        yield* toolBatch.toolUseEvents;
        yield* toolBatch.toolResultEvents;

        context.updateStrategy({
          status: 'running',
          stepCount,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls.consecutiveCount,
          lastStepSignature: repeatedToolCalls.signature,
          lastEvent: 'strategy_tool_result',
        }, {
          consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
          lastToolCallSignature: repeatedToolCalls.signature,
        });

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_tool_result',
            'updated',
            `ReAct recorded tool results for step ${stepCount}.`,
            {
              step: stepCount,
              toolCallCount: toolBatch.toolResultEvents.length,
            },
          );
          yield context.createStrategyEvent(
            'strategy_replan',
            'updated',
            `ReAct is replanning after tool results from step ${stepCount}.`,
            {
              step: stepCount,
            },
          );
        }
      }
    } catch (error) {
      if (context.isTimeoutError(error)) {
        yield* context.createFailureEvents(
          'timeout',
          `ReAct strategy timed out after ${context.constraints.timeoutMs}ms.`,
          {
            timeoutMs: context.constraints.timeoutMs,
          },
        );
        return;
      }
      throw error;
    }

    yield* context.createFailureEvents(
      'step_limit',
      `ReAct strategy exceeded step limit of ${context.constraints.stepLimit}.`,
      {
        stepCount: context.constraints.stepLimit,
      },
    );
  },
};
