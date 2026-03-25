import type { RuntimeExecutionStrategy } from '../../../../core/runtime/strategies/registry.js';
import { updateRepeatedToolCallState, type RepeatedToolCallState } from './reactGuards.js';
import { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';

export const reflexionStrategy: RuntimeExecutionStrategy<ApiStrategyExecutionContext> = {
  id: 'reflexion',
  async *execute(context: ApiStrategyExecutionContext) {
    let repeatedToolCalls: RepeatedToolCallState | undefined;
    let reflectionCount = 0;

    context.updateStrategy({
      status: 'running',
      stepCount: 0,
      stepLimit: context.constraints.stepLimit,
      timeoutMs: context.constraints.timeoutMs,
      duplicateStepCount: 0,
      stuckDetected: false,
      lastEvent: 'strategy_started',
    }, {
      reflectionCount: 0,
      consecutiveDuplicateToolCalls: 0,
      awaitingReflection: false,
    });

    if (context.emitLifecycleEvents) {
      yield context.createStrategyEvent(
        'strategy_started',
        'started',
        'Running runtime-owned reflexion strategy.',
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
          reflectionCount,
          consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
          lastToolCallSignature: repeatedToolCalls?.signature,
          awaitingReflection: false,
        });

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_step',
            'updated',
            `Reflexion step ${stepCount} of ${context.constraints.stepLimit}.`,
            {
              step: stepCount,
              stepLimit: context.constraints.stepLimit,
              reflectionCount,
            },
          );
        }

        if (modelStep.initEvent) {
          yield modelStep.initEvent;
        }
        yield* modelStep.progressEvents;
        yield* modelStep.textEvents;

        if (modelStep.toolCalls.length === 0) {
          if (reflectionCount === 0) {
            reflectionCount += 1;
            context.updateStrategy({
              status: 'running',
              stepCount,
              stepLimit: context.constraints.stepLimit,
              timeoutMs: context.constraints.timeoutMs,
              duplicateStepCount: repeatedToolCalls?.consecutiveCount ?? 0,
              lastStepSignature: repeatedToolCalls?.signature,
              lastEvent: 'strategy_reflection',
            }, {
              reflectionCount,
              consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
              lastToolCallSignature: repeatedToolCalls?.signature,
              awaitingReflection: true,
            });

            if (context.emitLifecycleEvents) {
              yield context.createStrategyEvent(
                'strategy_reflection',
                'updated',
                'Reflexion is critiquing the latest draft answer before finalizing.',
                {
                  step: stepCount,
                  reflectionCount,
                  source: 'draft_answer',
                },
              );
            }

            context.appendRuntimeGuidance(buildReflexionGuidance(
              context,
              stepCount,
              'draft_answer',
            ));
            continue;
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
            reflectionCount,
            consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
            lastToolCallSignature: repeatedToolCalls?.signature,
            awaitingReflection: false,
          });

          if (context.emitLifecycleEvents) {
            yield context.createStrategyEvent(
              'strategy_completed',
              'completed',
              'Reflexion strategy completed successfully after self-critique.',
              {
                step: stepCount,
                reflectionCount,
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
            `Reflexion strategy detected repeated tool calls after ${repeatedToolCalls.consecutiveCount} consecutive steps.`,
            {
              stepCount,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
              lastStepSignature: repeatedToolCalls.signature,
              localState: {
                reflectionCount,
                consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
                lastToolCallSignature: repeatedToolCalls.signature,
                awaitingReflection: false,
              },
            },
          );
          return;
        }

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_tool_call',
            'updated',
            `Reflexion selected ${modelStep.toolCalls.length} tool call(s) for step ${stepCount}.`,
            {
              step: stepCount,
              toolCallCount: modelStep.toolCalls.length,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
              reflectionCount,
            },
          );
        }

        const toolBatch = await context.executeToolCalls(modelStep.toolCalls);
        yield* toolBatch.toolUseEvents;
        yield* toolBatch.toolResultEvents;

        reflectionCount += 1;
        context.updateStrategy({
          status: 'running',
          stepCount,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls.consecutiveCount,
          lastStepSignature: repeatedToolCalls.signature,
          lastEvent: 'strategy_reflection',
        }, {
          reflectionCount,
          consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
          lastToolCallSignature: repeatedToolCalls.signature,
          lastToolCallCount: toolBatch.toolResultEvents.length,
          awaitingReflection: true,
        });

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_tool_result',
            'updated',
            `Reflexion recorded tool results for step ${stepCount}.`,
            {
              step: stepCount,
              toolCallCount: toolBatch.toolResultEvents.length,
              reflectionCount,
            },
          );
          yield context.createStrategyEvent(
            'strategy_reflection',
            'updated',
            `Reflexion is critiquing the latest tool results after step ${stepCount}.`,
            {
              step: stepCount,
              reflectionCount,
              source: 'tool_results',
            },
          );
        }

        context.appendRuntimeGuidance(buildReflexionGuidance(
          context,
          stepCount,
          'tool_results',
        ));
      }
    } catch (error) {
      if (context.isTimeoutError(error)) {
        yield* context.createFailureEvents(
          'timeout',
          `Reflexion strategy timed out after ${context.constraints.timeoutMs}ms.`,
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
      `Reflexion strategy exceeded step limit of ${context.constraints.stepLimit}.`,
      {
        stepCount: context.constraints.stepLimit,
        localState: {
          reflectionCount,
          awaitingReflection: false,
        },
      },
    );
  },
};

function buildReflexionGuidance(
  context: ApiStrategyExecutionContext,
  stepCount: number,
  source: 'draft_answer' | 'tool_results',
): string {
  const sections = [
    `Runtime reflexion guidance for step ${stepCount}: critique the latest ${
      source === 'tool_results' ? 'tool-backed draft' : 'draft answer'
    } before finalizing.`,
    context.request?.acceptanceCriteria
      ? `Acceptance criteria:\n${context.request.acceptanceCriteria}`
      : undefined,
    'If the answer is insufficient, explain the gap briefly and either revise the response or select the next necessary tool calls.',
    'If the answer already satisfies the acceptance criteria, return the corrected final answer directly without extra preamble.',
  ].filter((section): section is string => Boolean(section));

  return sections.join('\n\n');
}
