import type { RuntimeExecutionStrategy } from '../../../../core/runtime/strategies/registry.js';
import type { ApiToolCallPart } from '../../types.js';
import { ApiStrategyExecutionContext } from './ApiStrategyExecutionContext.js';
import {
  createToolCallBatchSignature,
  updateRepeatedToolCallState,
  type RepeatedToolCallState,
} from './reactGuards.js';

const DEFAULT_BRANCH_COUNT = 2;
const MAX_BRANCH_COUNT = 4;

interface ThoughtCandidate {
  branchId: string;
  toolCallCount: number;
  hasText: boolean;
  signature?: string;
  score: number;
  selectionReason: string;
}

export const treeOfThoughtsStrategy: RuntimeExecutionStrategy<ApiStrategyExecutionContext> = {
  id: 'tree_of_thoughts',
  async *execute(context: ApiStrategyExecutionContext) {
    const branchCount = resolveBranchCount(context);
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
      currentPhase: 'branch',
      completedDepths: 0,
      branchCount,
      exploredBranchCount: 0,
      prunedBranchCount: 0,
    });

    if (context.emitLifecycleEvents) {
      yield context.createStrategyEvent(
        'strategy_started',
        'started',
        'Running runtime-owned tree_of_thoughts strategy.',
        {
          branchCount,
        },
      );
    }

    try {
      for (let depth = 0; depth < context.constraints.stepLimit; depth += 1) {
        const depthCount = depth + 1;
        const candidates: ThoughtCandidate[] = [];

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_branch',
            'updated',
            `Tree-of-thoughts depth ${depthCount}: exploring ${branchCount} candidate branch(es).`,
            {
              depth: depthCount,
              depthLimit: context.constraints.stepLimit,
              branchCount,
            },
          );
        }

        for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
          const branchNumber = branchIndex + 1;
          const branchId = `depth_${depthCount}_branch_${branchNumber}`;
          const sampled = await context.sampleModelCandidate(
            depth,
            buildBranchExplorationGuidance(context, depthCount, branchNumber, branchCount),
          );
          const candidate = scoreThoughtCandidate(branchId, sampled, repeatedToolCalls?.signature);
          candidates.push(candidate);

          if (context.emitLifecycleEvents) {
            yield context.createStrategyEvent(
              'strategy_branch',
              'updated',
              `Evaluated ${branchId} at depth ${depthCount}.`,
              {
                depth: depthCount,
                branchId,
                branchIndex: branchNumber,
                branchCount,
                toolCallCount: candidate.toolCallCount,
                hasText: candidate.hasText,
                branchScore: candidate.score,
                selectionReason: candidate.selectionReason,
                branchSignature: candidate.signature,
              },
            );
          }
        }

        const selected = selectBestThoughtCandidate(candidates);
        const prunedBranchIds = candidates
          .filter((candidate) => candidate.branchId !== selected.branchId)
          .map((candidate) => candidate.branchId);

        context.updateStrategy({
          status: 'running',
          stepCount: depth,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls?.consecutiveCount ?? 0,
          lastStepSignature: repeatedToolCalls?.signature,
          lastEvent: 'strategy_select',
        }, {
          currentPhase: 'select',
          completedDepths: depth,
          branchCount,
          exploredBranchCount: candidates.length,
          prunedBranchCount: prunedBranchIds.length,
          lastSelectedBranchId: selected.branchId,
          lastSelectedBranchSignature: selected.signature,
          lastSelectionReason: selected.selectionReason,
        });

        if (context.emitLifecycleEvents) {
          if (prunedBranchIds.length > 0) {
            yield context.createStrategyEvent(
              'strategy_prune',
              'updated',
              `Pruned ${prunedBranchIds.length} weaker branch(es) at depth ${depthCount}.`,
              {
                depth: depthCount,
                prunedBranchIds,
                selectedBranchId: selected.branchId,
              },
            );
          }
          yield context.createStrategyEvent(
            'strategy_select',
            'updated',
            `Selected ${selected.branchId} as the best branch at depth ${depthCount}.`,
            {
              depth: depthCount,
              branchId: selected.branchId,
              branchCount,
              toolCallCount: selected.toolCallCount,
              hasText: selected.hasText,
              branchSignature: selected.signature,
              selectionReason: selected.selectionReason,
            },
          );
        }

        context.appendRuntimeGuidance(buildSelectionCommitGuidance(
          context,
          depthCount,
          branchCount,
          selected,
        ));

        const modelStep = await context.completeModelStep(depth);
        const stepCount = depthCount;

        context.updateStrategy({
          status: 'running',
          stepCount,
          stepLimit: context.constraints.stepLimit,
          timeoutMs: context.constraints.timeoutMs,
          duplicateStepCount: repeatedToolCalls?.consecutiveCount ?? 0,
          lastStepSignature: repeatedToolCalls?.signature,
          lastEvent: 'strategy_step',
        }, {
          currentPhase: 'evaluate',
          completedDepths: depth,
          branchCount,
          exploredBranchCount: candidates.length,
          prunedBranchCount: prunedBranchIds.length,
          lastSelectedBranchId: selected.branchId,
          lastSelectedBranchSignature: selected.signature,
          lastSelectionReason: selected.selectionReason,
        });

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
              ? `Selected branch ${selected.branchId} produced ${modelStep.toolCalls.length} tool call(s).`
              : `Selected branch ${selected.branchId} appears to satisfy the turn without tool calls.`,
            {
              depth: depthCount,
              branchId: selected.branchId,
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
            currentPhase: 'completed',
            completedDepths: stepCount,
            branchCount,
            exploredBranchCount: candidates.length,
            prunedBranchCount: prunedBranchIds.length,
            lastSelectedBranchId: selected.branchId,
            lastSelectedBranchSignature: selected.signature,
            lastSelectionReason: selected.selectionReason,
          });

          if (context.emitLifecycleEvents) {
            yield context.createStrategyEvent(
              'strategy_completed',
              'completed',
              'Tree-of-thoughts strategy completed successfully.',
              {
                depth: depthCount,
                branchId: selected.branchId,
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
            `Tree-of-thoughts strategy detected repeated tool calls after ${repeatedToolCalls.consecutiveCount} consecutive depths.`,
            {
              stepCount,
              duplicateStepCount: repeatedToolCalls.consecutiveCount,
              lastStepSignature: repeatedToolCalls.signature,
              localState: {
                currentPhase: 'evaluate',
                completedDepths: depth,
                branchCount,
                exploredBranchCount: candidates.length,
                prunedBranchCount: prunedBranchIds.length,
                lastSelectedBranchId: selected.branchId,
                lastSelectedBranchSignature: selected.signature,
                lastSelectionReason: selected.selectionReason,
              },
            },
          );
          return;
        }

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_tool_call',
            'updated',
            `Tree-of-thoughts selected ${modelStep.toolCalls.length} tool call(s) from ${selected.branchId}.`,
            {
              depth: depthCount,
              branchId: selected.branchId,
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
          currentPhase: 'rebranch',
          completedDepths: stepCount,
          branchCount,
          exploredBranchCount: candidates.length,
          prunedBranchCount: prunedBranchIds.length,
          lastSelectedBranchId: selected.branchId,
          lastSelectedBranchSignature: repeatedToolCalls.signature,
          lastSelectionReason: selected.selectionReason,
          lastToolCallCount: toolBatch.toolResultEvents.length,
        });

        if (context.emitLifecycleEvents) {
          yield context.createStrategyEvent(
            'strategy_tool_result',
            'updated',
            `Tree-of-thoughts recorded tool results for ${selected.branchId}.`,
            {
              depth: depthCount,
              branchId: selected.branchId,
              toolCallCount: toolBatch.toolResultEvents.length,
            },
          );
          yield context.createStrategyEvent(
            'strategy_replan',
            'updated',
            `Tree-of-thoughts is re-branching after tool results from depth ${depthCount}.`,
            {
              depth: depthCount,
              branchCount,
            },
          );
        }
      }
    } catch (error) {
      if (context.isTimeoutError(error)) {
        yield* context.createFailureEvents(
          'timeout',
          `Tree-of-thoughts strategy timed out after ${context.constraints.timeoutMs}ms.`,
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
      `Tree-of-thoughts strategy exceeded depth limit of ${context.constraints.stepLimit}.`,
      {
        stepCount: context.constraints.stepLimit,
        localState: {
          currentPhase: 'rebranch',
          completedDepths: context.constraints.stepLimit,
          branchCount,
        },
      },
    );
  },
};

function resolveBranchCount(
  context: ApiStrategyExecutionContext,
): number {
  const rawValue = context.request?.strategyContext?.branchCount;
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue <= 0) {
    return DEFAULT_BRANCH_COUNT;
  }

  return Math.min(rawValue, MAX_BRANCH_COUNT);
}

function scoreThoughtCandidate(
  branchId: string,
  sampled: {
    toolCalls: ApiToolCallPart[];
    textParts: string[];
  },
  previousSignature?: string,
): ThoughtCandidate {
  const signature = createToolCallBatchSignature(sampled.toolCalls);
  const hasText = sampled.textParts.some((text) => text.trim().length > 0);

  if (sampled.toolCalls.length === 0 && hasText) {
    return {
      branchId,
      toolCallCount: 0,
      hasText: true,
      score: 100,
      selectionReason: 'final_answer_candidate',
    };
  }

  if (sampled.toolCalls.length > 0) {
    const repeatedPenalty = signature && previousSignature === signature ? 20 : 0;
    return {
      branchId,
      toolCallCount: sampled.toolCalls.length,
      hasText,
      signature,
      score: 80 - (sampled.toolCalls.length * 5) - repeatedPenalty,
      selectionReason: repeatedPenalty > 0 ? 'novel_tool_path_preferred' : 'bounded_tool_path',
    };
  }

  return {
    branchId,
    toolCallCount: 0,
    hasText,
    score: hasText ? 40 : 0,
    selectionReason: hasText ? 'text_only_candidate' : 'empty_candidate',
  };
}

function selectBestThoughtCandidate(
  candidates: ThoughtCandidate[],
): ThoughtCandidate {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.toolCallCount !== right.toolCallCount) {
      return left.toolCallCount - right.toolCallCount;
    }
    return left.branchId.localeCompare(right.branchId);
  })[0];
}

function buildBranchExplorationGuidance(
  context: ApiStrategyExecutionContext,
  depth: number,
  branchNumber: number,
  branchCount: number,
): string {
  const sections = [
    `Runtime tree-of-thoughts branch exploration for depth ${depth}, candidate ${branchNumber} of ${branchCount}.`,
    context.request?.acceptanceCriteria
      ? `Acceptance criteria:\n${context.request.acceptanceCriteria}`
      : undefined,
    'Propose one distinct next path only. Either commit to one bounded tool-backed path or produce a final answer if no further action is needed.',
    'Do not enumerate multiple alternatives in this reply; this runtime call is sampling a single branch candidate.',
  ].filter((section): section is string => Boolean(section));

  return sections.join('\n\n');
}

function buildSelectionCommitGuidance(
  context: ApiStrategyExecutionContext,
  depth: number,
  branchCount: number,
  selected: ThoughtCandidate,
): string {
  const sections = [
    `Runtime tree-of-thoughts guidance for depth ${depth}: commit to ${selected.branchId} from ${branchCount} explored branch(es).`,
    context.request?.acceptanceCriteria
      ? `Acceptance criteria:\n${context.request.acceptanceCriteria}`
      : undefined,
    selected.toolCallCount > 0
      ? `Follow the selected bounded tool path and issue only the tool calls required by ${selected.branchId}.`
      : `The selected branch is a direct answer candidate; finalize the response if it satisfies the acceptance criteria.`,
    `Selection rationale: ${selected.selectionReason}.`,
    'Do not revisit pruned branches unless new evidence from the selected path forces a different approach.',
  ].filter((section): section is string => Boolean(section));

  return sections.join('\n\n');
}
