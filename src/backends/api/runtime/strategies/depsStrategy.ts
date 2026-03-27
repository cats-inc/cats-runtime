import type { RuntimeExecutionStrategy } from '../../../../core/runtime/strategies/registry.js';
import { updateRepeatedToolCallState, type RepeatedToolCallState } from './reactGuards.js';
import { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';

export const depsStrategy: RuntimeExecutionStrategy<ApiStrategyExecutionContext> = {
  id: 'deps',
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
      currentPhase: 'describe',
      describedSteps: 0,
      explainedSteps: 0,
      plannedSteps: 0,
      selectedSteps: 0,
      consecutiveDuplicateToolCalls: 0,
    });

    if (context.emitLifecycleEvents) {
      yield context.createStrategyEvent(
        'strategy_started',
        'started',
        'Running runtime-owned deps strategy.',
      );
    }

    try {
      for (let step = 0; step < context.constraints.stepLimit; step += 1) {
        const stepCount = step + 1;

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_describe',
            'updated',
            `DEPS step ${stepCount}: describing the current goal and known state.`,
            {
              step: stepCount,
              stepLimit: context.constraints.stepLimit,
            },
          );
          yield context.createStrategyEvent(
            'strategy_explain',
            'updated',
            `DEPS step ${stepCount}: explaining the active constraints and risks.`,
            {
              step: stepCount,
              stepLimit: context.constraints.stepLimit,
            },
          );
          yield context.createStrategyEvent(
            'strategy_plan',
            'updated',
            `DEPS step ${stepCount}: planning the next bounded action batch.`,
            {
              step: stepCount,
              stepLimit: context.constraints.stepLimit,
            },
          );
        }

        context.appendRuntimeGuidance(buildDepsGuidance(context, stepCount));
        const modelStep = await context.completeModelStep(step);

        context.updateStrategy({
          status: 'running',
          stepCount,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls?.consecutiveCount ?? 0,
          lastStepSignature: repeatedToolCalls?.signature,
          lastEvent: 'strategy_select',
        }, {
          currentPhase: 'select',
          describedSteps: stepCount,
          explainedSteps: stepCount,
          plannedSteps: stepCount,
          selectedSteps: step,
          consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
          lastToolCallSignature: repeatedToolCalls?.signature,
        });

        if (modelStep.initEvent) {
          yield modelStep.initEvent;
        }
        yield* modelStep.progressEvents;
        yield* modelStep.textEvents;

        if (modelStep.toolCalls.length === 0) {
          if (context.emitLifecycleEvents) {
            yield context.createStrategyEvent(
              'strategy_select',
              'updated',
              `DEPS step ${stepCount}: selected a final response without more tool calls.`,
              {
                step: stepCount,
                toolCallCount: 0,
              },
            );
          }

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
            describedSteps: stepCount,
            explainedSteps: stepCount,
            plannedSteps: stepCount,
            selectedSteps: stepCount,
            consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
            lastToolCallSignature: repeatedToolCalls?.signature,
          });

          if (context.emitLifecycleEvents) {
            yield context.createStrategyEvent(
              'strategy_completed',
              'completed',
              'DEPS strategy completed successfully.',
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
            `DEPS strategy detected repeated tool calls after ${repeatedToolCalls.consecutiveCount} consecutive selections.`,
            {
              stepCount,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
              lastStepSignature: repeatedToolCalls.signature,
              localState: {
                currentPhase: 'select',
                describedSteps: stepCount,
                explainedSteps: stepCount,
                plannedSteps: stepCount,
                selectedSteps: step,
                consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
                lastToolCallSignature: repeatedToolCalls.signature,
              },
            },
          );
          return;
        }

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_select',
            'updated',
            `DEPS step ${stepCount}: selected ${modelStep.toolCalls.length} tool call(s) after structured reasoning.`,
            {
              step: stepCount,
              toolCallCount: modelStep.toolCalls.length,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
            },
          );
          yield context.createStrategyEvent(
            'strategy_tool_call',
            'updated',
            `DEPS is executing ${modelStep.toolCalls.length} selected tool call(s).`,
            {
              step: stepCount,
              toolCallCount: modelStep.toolCalls.length,
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
          lastEvent: 'strategy_replan',
        }, {
          currentPhase: 'replan',
          describedSteps: stepCount,
          explainedSteps: stepCount,
          plannedSteps: stepCount,
          selectedSteps: stepCount,
          consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
          lastToolCallSignature: repeatedToolCalls.signature,
          lastToolCallCount: toolBatch.toolResultEvents.length,
        });

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_tool_result',
            'updated',
            `DEPS recorded tool results for step ${stepCount}.`,
            {
              step: stepCount,
              toolCallCount: toolBatch.toolResultEvents.length,
            },
          );
          yield context.createStrategyEvent(
            'strategy_replan',
            'updated',
            `DEPS is revisiting the description, constraints, and plan after step ${stepCount}.`,
            {
              step: stepCount,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
            },
          );
        }
      }
    } catch (error) {
      if (context.isTimeoutError(error)) {
        yield* context.createFailureEvents(
          'timeout',
          `DEPS strategy timed out after ${context.constraints.timeoutMs}ms.`,
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
      `DEPS strategy exceeded step limit of ${context.constraints.stepLimit}.`,
      {
        stepCount: context.constraints.stepLimit,
        localState: {
          currentPhase: 'replan',
          describedSteps: context.constraints.stepLimit,
          explainedSteps: context.constraints.stepLimit,
          plannedSteps: context.constraints.stepLimit,
          selectedSteps: context.constraints.stepLimit,
        },
      },
    );
  },
};

function buildDepsGuidance(
  context: ApiStrategyExecutionContext,
  stepCount: number,
): string {
  const sections = [
    `Runtime deps guidance for step ${stepCount}: work in Describe, Explain, Plan, Select order.`,
    context.request?.acceptanceCriteria
      ? `Acceptance criteria:\n${context.request.acceptanceCriteria}`
      : undefined,
    'Describe the current goal and any new evidence briefly.',
    'Explain the key constraints, risks, or unknowns that should shape the next move.',
    'Plan only the next bounded action batch.',
    'Select either the final answer or the minimum necessary tool calls; avoid speculative broad tool use.',
  ].filter((section): section is string => Boolean(section));

  return sections.join('\n\n');
}
