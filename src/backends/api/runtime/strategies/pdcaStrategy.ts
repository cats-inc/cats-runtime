import type { RuntimeExecutionStrategy } from '../../../../core/runtime/strategies/registry.js';
import { updateRepeatedToolCallState, type RepeatedToolCallState } from './reactGuards.js';
import { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';

export const pdcaStrategy: RuntimeExecutionStrategy<ApiStrategyExecutionContext> = {
  id: 'pdca',
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
      completedCycles: 0,
      consecutiveDuplicateToolCalls: 0,
    });

    if (context.emitLifecycleEvents) {
      yield context.createStrategyEvent(
        'strategy_started',
        'started',
        'Running runtime-owned pdca strategy.',
      );
    }

    try {
      for (let cycle = 0; cycle < context.constraints.stepLimit; cycle += 1) {
        const cycleCount = cycle + 1;
        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_plan',
            'updated',
            `PDCA cycle ${cycleCount}: planning the next bounded action set.`,
            {
              cycle: cycleCount,
              cycleLimit: context.constraints.stepLimit,
            },
          );
        }

        const modelStep = await context.completeModelStep(cycle);
        context.updateStrategy({
          status: 'running',
          stepCount: cycleCount,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls?.consecutiveCount ?? 0,
          lastStepSignature: repeatedToolCalls?.signature,
          lastEvent: 'strategy_plan',
        }, {
          currentPhase: 'plan',
          completedCycles: cycle,
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
              'strategy_check',
              'updated',
              `PDCA cycle ${cycleCount}: checking whether the current answer satisfies the acceptance criteria.`,
              {
                cycle: cycleCount,
                toolCallCount: 0,
              },
            );
          }

          context.updateStrategy({
            status: 'completed',
            stepCount: cycleCount,
            stepLimit: context.constraints.stepLimit,
            timeoutMs: context.constraints.timeoutMs,
            duplicateStepCount: repeatedToolCalls?.consecutiveCount ?? 0,
            lastStepSignature: repeatedToolCalls?.signature,
            lastEvent: 'strategy_completed',
          }, {
            currentPhase: 'completed',
            completedCycles: cycleCount,
            consecutiveDuplicateToolCalls: repeatedToolCalls?.consecutiveCount ?? 0,
            lastToolCallSignature: repeatedToolCalls?.signature,
          });

          if (context.emitLifecycleEvents) {
            yield context.createStrategyEvent(
              'strategy_completed',
              'completed',
              'PDCA strategy completed successfully.',
              {
                cycle: cycleCount,
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
            `PDCA strategy detected repeated tool calls after ${repeatedToolCalls.consecutiveCount} consecutive cycles.`,
            {
              stepCount: cycleCount,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
              lastStepSignature: repeatedToolCalls.signature,
              localState: {
                currentPhase: 'plan',
                completedCycles: cycle,
                consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
                lastToolCallSignature: repeatedToolCalls.signature,
              },
            },
          );
          return;
        }

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_do',
            'updated',
            `PDCA cycle ${cycleCount}: executing ${modelStep.toolCalls.length} planned tool call(s).`,
            {
              cycle: cycleCount,
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
          stepCount: cycleCount,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls.consecutiveCount,
          lastStepSignature: repeatedToolCalls.signature,
          lastEvent: 'strategy_check',
        }, {
          currentPhase: 'check',
          completedCycles: cycle,
          consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
          lastToolCallSignature: repeatedToolCalls.signature,
          lastToolCallCount: toolBatch.toolResultEvents.length,
        });

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_check',
            'updated',
            `PDCA cycle ${cycleCount}: checking the latest tool results against the acceptance criteria.`,
            {
              cycle: cycleCount,
              toolCallCount: toolBatch.toolResultEvents.length,
            },
          );
          yield context.createStrategyEvent(
            'strategy_act',
            'updated',
            `PDCA cycle ${cycleCount}: acting on the latest findings before the next cycle.`,
            {
              cycle: cycleCount,
            },
          );
        }

        context.updateStrategy({
          status: 'running',
          stepCount: cycleCount,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls.consecutiveCount,
          lastStepSignature: repeatedToolCalls.signature,
          lastEvent: 'strategy_act',
        }, {
          currentPhase: 'act',
          completedCycles: cycleCount,
          consecutiveDuplicateToolCalls: repeatedToolCalls.consecutiveCount,
          lastToolCallSignature: repeatedToolCalls.signature,
          lastToolCallCount: toolBatch.toolResultEvents.length,
        });
      }
    } catch (error) {
      if (context.isTimeoutError(error)) {
        yield* context.createFailureEvents(
          'timeout',
          `PDCA strategy timed out after ${context.constraints.timeoutMs}ms.`,
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
      `PDCA strategy exceeded cycle limit of ${context.constraints.stepLimit}.`,
      {
        stepCount: context.constraints.stepLimit,
        localState: {
          currentPhase: 'act',
          completedCycles: context.constraints.stepLimit,
        },
      },
    );
  },
};
