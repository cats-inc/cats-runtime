import type { RuntimeExecutionStrategy } from '../../../../core/runtime/strategies/registry.js';
import { updateRepeatedToolCallState, type RepeatedToolCallState } from './reactGuards.js';
import { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';

export const planExecuteStrategy: RuntimeExecutionStrategy<ApiStrategyExecutionContext> = {
  id: 'plan_execute',
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
      currentPhase: 'plan',
      plannedSteps: 0,
      executedSteps: 0,
      consecutiveDuplicateToolCalls: 0,
    });

    if (context.emitLifecycleEvents) {
      yield context.createStrategyEvent(
        'strategy_started',
        'started',
        'Running runtime-owned plan_execute strategy.',
      );
    }

    try {
      for (let step = 0; step < context.constraints.stepLimit; step += 1) {
        const stepCount = step + 1;

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_plan',
            'updated',
            `Plan-execute step ${stepCount}: planning the next bounded action batch.`,
            {
              step: stepCount,
              stepLimit: context.constraints.stepLimit,
              executedSteps: step,
            },
          );
        }

        const modelStep = await context.completeModelStep(step);
        context.updateStrategy({
          status: 'running',
          stepCount,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls?.consecutiveCount ?? 0,
          lastStepSignature: repeatedToolCalls?.signature,
          lastEvent: 'strategy_plan',
        }, {
          currentPhase: 'plan',
          plannedSteps: stepCount,
          executedSteps: step,
          consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
          lastToolCallSignature: repeatedToolCalls?.signature,
        });

        if (modelStep.initEvent) {
          yield modelStep.initEvent;
        }
        yield* modelStep.progressEvents;
        yield* modelStep.textEvents;

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
            currentPhase: 'completed',
            plannedSteps: stepCount,
            executedSteps: step,
            consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
            lastToolCallSignature: repeatedToolCalls?.signature,
          });

          if (context.emitLifecycleEvents) {
            yield context.createStrategyEvent(
              'strategy_completed',
              'completed',
              'Plan-execute strategy completed successfully.',
              {
                step: stepCount,
                executedSteps: step,
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
            `Plan-execute strategy detected repeated tool calls after ${repeatedToolCalls.consecutiveCount} consecutive plans.`,
            {
              stepCount,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
              lastStepSignature: repeatedToolCalls.signature,
              localState: {
                currentPhase: 'plan',
                plannedSteps: stepCount,
                executedSteps: step,
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
            `Plan-execute is executing ${modelStep.toolCalls.length} planned tool call(s).`,
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
          lastEvent: 'strategy_evaluation',
        }, {
          currentPhase: 'evaluate',
          plannedSteps: stepCount,
          executedSteps: stepCount,
          consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
          lastToolCallSignature: repeatedToolCalls.signature,
          lastToolCallCount: toolBatch.toolResultEvents.length,
        });

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_evaluation',
            'updated',
            `Plan-execute is evaluating the latest execution batch before replanning.`,
            {
              step: stepCount,
              toolCallCount: toolBatch.toolResultEvents.length,
            },
          );
        }

        context.appendRuntimeGuidance(buildPlanExecuteGuidance(context, stepCount));
      }
    } catch (error) {
      if (context.isTimeoutError(error)) {
        yield* context.createFailureEvents(
          'timeout',
          `Plan-execute strategy timed out after ${context.constraints.timeoutMs}ms.`,
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
      `Plan-execute strategy exceeded plan limit of ${context.constraints.stepLimit}.`,
      {
        stepCount: context.constraints.stepLimit,
        localState: {
          currentPhase: 'evaluate',
          plannedSteps: context.constraints.stepLimit,
          executedSteps: context.constraints.stepLimit,
        },
      },
    );
  },
};

function buildPlanExecuteGuidance(
  context: ApiStrategyExecutionContext,
  stepCount: number,
): string {
  const sections = [
    `Runtime plan_execute guidance for step ${stepCount}: summarize what changed after the latest execution batch, then either return the final answer or propose only the next bounded tool batch.`,
    context.request?.acceptanceCriteria
      ? `Acceptance criteria:\n${context.request.acceptanceCriteria}`
      : undefined,
    'Keep the plan short, execute only the next necessary actions, and avoid broad speculative tool use.',
  ].filter((section): section is string => Boolean(section));

  return sections.join('\n\n');
}
