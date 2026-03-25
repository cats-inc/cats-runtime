import { createRuntimeProgressEvent } from '../../../../core/progress.js';
import {
  buildRuntimeExecutionStrategySessionPatch,
  readRuntimeExecutionStrategyState,
} from '../../../../core/runtime/strategies/state.js';
import type {
  RuntimeExecutionStrategyState,
  RuntimeExecutionStrategySummary,
  RuntimeProgressStatus,
  StreamEvent,
} from '../../../../core/types.js';
import type { SessionProviderState } from '../../../../core/types.js';
import type { ApiConversationMessage, ApiProgressEvent, ApiToolCallPart } from '../../types.js';
import { extractTextParts, extractToolCalls } from '../messageParts.js';
import type { ApiStrategyExecutionContextOptions, ApiCompletedModelStep, ApiExecutedToolBatch } from './types.js';

interface MutableApiStrategyLoopState {
  responseId?: string;
  sessionState?: SessionProviderState;
  totalInputTokens: number;
  totalOutputTokens: number;
  initialized: boolean;
  lastRaw?: unknown;
}

export class ApiStrategyExecutionError extends Error {
  constructor(
    readonly kind: 'timeout' | 'step_limit' | 'stuck',
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiStrategyExecutionError';
  }
}

export class ApiStrategyExecutionContext {
  private readonly state: MutableApiStrategyLoopState;

  private readonly deadlineAt?: number;

  constructor(
    readonly options: ApiStrategyExecutionContextOptions,
  ) {
    this.state = {
      responseId: options.session.providerSessionId,
      sessionState: options.session.providerState,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      initialized: false,
    };
    this.deadlineAt = typeof options.constraints.timeoutMs === 'number' && options.constraints.timeoutMs > 0
      ? Date.now() + options.constraints.timeoutMs
      : undefined;
  }

  get session() {
    return this.options.session;
  }

  get request() {
    return this.options.request;
  }

  get resolution() {
    return this.options.resolution;
  }

  get constraints() {
    return this.options.constraints;
  }

  get emitLifecycleEvents(): boolean {
    return this.options.emitLifecycleEvents;
  }

  get providerSessionId(): string | undefined {
    return this.state.responseId || this.session.providerSessionId;
  }

  get target() {
    return this.options.target;
  }

  async completeModelStep(
    step: number,
  ): Promise<ApiCompletedModelStep> {
    this.assertWithinTimeout('model_turn');

    const completion = await this.options.transport.completeTurn({
      sessionId: this.session.id,
      providerName: this.session.providerName,
      instance: this.options.remoteInstance,
      model: this.options.model,
      requestBodyPatch: this.options.requestBodyPatch,
      messages: this.options.conversation,
      tools: this.options.tools.listTools(this.options.toolProfile),
      previousResponseId: this.state.responseId,
      sessionState: this.state.sessionState,
      turnStep: step,
      signal: this.buildStepSignal(),
    });

    if (completion.responseId) {
      this.state.responseId = completion.responseId;
    }
    if (completion.sessionState !== undefined) {
      this.state.sessionState = completion.sessionState;
      this.options.registry.setProviderState(this.session.id, completion.sessionState);
    }

    this.state.lastRaw = completion.raw;
    this.state.totalInputTokens += completion.usage?.inputTokens ?? 0;
    this.state.totalOutputTokens += completion.usage?.outputTokens ?? 0;
    this.options.conversation.push(completion.assistant);

    const initEvent = !this.state.initialized
      ? {
          type: 'init',
          sessionId: this.state.responseId,
          raw: completion.raw,
        } satisfies StreamEvent
      : undefined;
    this.state.initialized = true;

    return {
      ...(initEvent ? { initEvent } : {}),
      progressEvents: (completion.progress || []).map((progress) =>
        this.toProgressStreamEvent(progress),
      ),
      textEvents: extractTextParts(completion.assistant).map((text) => ({
        type: 'text',
        text,
        raw: completion.raw,
      })),
      toolCalls: extractToolCalls(completion.assistant),
    };
  }

  async executeToolCalls(
    toolCalls: ApiToolCallPart[],
  ): Promise<ApiExecutedToolBatch> {
    const toolResultMessage: ApiConversationMessage = {
      role: 'user',
      parts: [],
    };

    const toolUseEvents: StreamEvent[] = toolCalls.map((toolCall) => ({
      type: 'tool_use',
      toolName: toolCall.name,
      toolId: toolCall.id,
      text: JSON.stringify(toolCall.arguments),
      toolArgs: toolCall.arguments,
      raw: toolCall.raw,
    }));
    const toolResultEvents: StreamEvent[] = [];
    const signatures: string[] = [];

    for (const toolCall of toolCalls) {
      this.assertWithinTimeout('tool_execution');
      const toolResult = await this.options.tools.execute({
        sessionId: this.session.id,
        cwd: this.session.cwd,
        workspaceMode: this.session.workspaceMode,
        permissionMode: this.options.permissionMode,
        allowedTools: this.session.allowedTools,
        toolProfile: this.options.toolProfile,
      }, {
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      });

      toolResultMessage.parts.push({
        type: 'tool_result',
        toolCallId: toolResult.callId,
        name: toolResult.name,
        output: toolResult.output,
        isError: toolResult.isError,
      });
      toolResultEvents.push({
        type: 'tool_result',
        toolName: toolResult.name,
        toolId: toolResult.callId,
        text: toolResult.output,
        isError: toolResult.isError,
      });
      signatures.push(`${toolResult.name}:${JSON.stringify(toolCall.arguments)}`);
    }

    this.options.conversation.push(toolResultMessage);

    return {
      toolUseEvents,
      toolResultEvents,
      signatures,
    };
  }

  createResultEvent(): StreamEvent {
    return {
      type: 'result',
      sessionId: this.state.responseId,
      usage: {
        inputTokens: this.state.totalInputTokens,
        outputTokens: this.state.totalOutputTokens,
      },
      raw: this.state.lastRaw,
    };
  }

  updateStrategy(
    summaryPatch: Omit<RuntimeExecutionStrategySummary, 'updatedAt' | 'resolutionSource'>,
    localState?: Record<string, unknown>,
  ): RuntimeExecutionStrategyState | undefined {
    const existing = this.options.registry.get(this.session.id) ?? this.session;
    const now = new Date().toISOString();
    const existingStrategyState = readRuntimeExecutionStrategyState(existing);
    const summary: RuntimeExecutionStrategySummary = {
      ...(
        existingStrategyState?.summary
        ? structuredClone(existingStrategyState.summary)
        : {
            status: 'running',
            stepCount: 0,
            resolutionSource: this.resolution.source,
          }
      ),
      ...summaryPatch,
      resolutionSource: this.resolution.source,
      updatedAt: now,
    };

    const patch = buildRuntimeExecutionStrategySessionPatch(existing, {
      request: this.request,
      resolution: this.resolution,
      summary,
      localState,
      rememberPreference: Boolean(this.request?.requestedStrategy),
      now,
    });
    this.options.registry.updateSessionMetadata(this.session.id, patch);
    return this.options.registry.get(this.session.id)?.strategy;
  }

  createStrategyEvent(
    eventName: string,
    status: RuntimeProgressStatus,
    text: string,
    details: Record<string, unknown> = {},
  ): StreamEvent {
    const strategyState = this.options.registry.get(this.session.id)?.strategy;

    return createRuntimeProgressEvent({
      text,
      sessionId: this.session.id,
      providerSessionId: this.providerSessionId,
      provider: this.session.providerName,
      backend: this.target.backend,
      instance: this.target.instanceId,
      kind: 'strategy',
      status,
      source: 'runtime',
      details: {
        strategyEvent: eventName,
        requestedStrategy: this.request?.requestedStrategy,
        effectiveStrategy: this.resolution.effectiveStrategy,
        strategyResolutionSource: this.resolution.source,
        ...(this.request?.acceptanceCriteria
          ? { acceptanceCriteria: this.request.acceptanceCriteria }
          : {}),
        ...(this.request?.strategyContext
          ? { strategyContext: structuredClone(this.request.strategyContext) }
          : {}),
        ...(this.request?.correlation
          ? { correlation: structuredClone(this.request.correlation) }
          : {}),
        ...(strategyState?.summary
          ? { strategySummary: structuredClone(strategyState.summary) }
          : {}),
        ...(strategyState?.localState
          ? { strategyLocalState: structuredClone(strategyState.localState) }
          : {}),
        ...details,
      },
    });
  }

  createFailureEvents(
    kind: ApiStrategyExecutionError['kind'],
    message: string,
    details: Record<string, unknown> = {},
    options: {
      emitStrategyEvent?: boolean;
    } = {},
  ): Iterable<StreamEvent> {
    const strategyState = this.updateStrategy({
      status: 'failed',
      stepCount: typeof details.stepCount === 'number'
        ? details.stepCount
        : this.options.registry.get(this.session.id)?.strategy?.summary?.stepCount || 0,
      stepLimit: this.constraints.stepLimit,
      timeoutMs: this.constraints.timeoutMs,
      duplicateStepCount: typeof details.duplicateStepCount === 'number'
        ? details.duplicateStepCount
        : undefined,
      stuckDetected: kind === 'stuck',
      failureReason: message,
      lastStepSignature: typeof details.lastStepSignature === 'string'
        ? details.lastStepSignature
        : undefined,
      lastEvent: kind === 'stuck' ? 'strategy_stuck' : 'strategy_failed',
    }, details.localState as Record<string, unknown> | undefined);

    const events: StreamEvent[] = [];
    if (options.emitStrategyEvent !== false) {
      events.push(this.createStrategyEvent(
        kind === 'stuck' ? 'strategy_stuck' : 'strategy_failed',
        'failed',
        message,
        {
          failureKind: kind,
          ...details,
        },
      ));
    }
    events.push({
      type: 'error',
      providerSessionId: this.providerSessionId,
      text: message,
      metadata: {
        requestedStrategy: this.request?.requestedStrategy,
        effectiveStrategy: this.resolution.effectiveStrategy,
        strategyResolutionSource: this.resolution.source,
        strategyFailure: {
          kind,
          ...details,
        },
        ...(strategyState?.summary
          ? { strategySummary: structuredClone(strategyState.summary) }
          : {}),
      },
    });
    return events;
  }

  isTimeoutError(error: unknown): boolean {
    if (error instanceof ApiStrategyExecutionError) {
      return error.kind === 'timeout';
    }

    return this.hasTimedOut()
      && error instanceof Error
      && /abort|aborted|timeout/i.test(error.message);
  }

  assertWithinTimeout(
    phase: 'model_turn' | 'tool_execution',
  ): void {
    if (!this.hasTimedOut()) {
      return;
    }

    throw new ApiStrategyExecutionError(
      'timeout',
      `Runtime execution strategy timed out after ${this.constraints.timeoutMs}ms.`,
      {
        phase,
        timeoutMs: this.constraints.timeoutMs,
      },
    );
  }

  private hasTimedOut(): boolean {
    return this.deadlineAt !== undefined && Date.now() >= this.deadlineAt;
  }

  private buildStepSignal(): AbortSignal {
    if (this.deadlineAt === undefined) {
      return this.options.signal;
    }

    const remainingMs = this.deadlineAt - Date.now();
    if (remainingMs <= 0) {
      throw new ApiStrategyExecutionError(
        'timeout',
        `Runtime execution strategy timed out after ${this.constraints.timeoutMs}ms.`,
        {
          phase: 'model_turn',
          timeoutMs: this.constraints.timeoutMs,
        },
      );
    }

    return AbortSignal.any([
      this.options.signal,
      AbortSignal.timeout(remainingMs),
    ]);
  }

  private toProgressStreamEvent(
    progress: ApiProgressEvent,
  ): StreamEvent {
    return createRuntimeProgressEvent({
      text: progress.message,
      providerSessionId: this.providerSessionId,
      provider: this.session.providerName,
      backend: this.target.backend,
      instance: this.target.instanceId,
      kind: progress.kind,
      status: progress.status,
      source: 'runtime',
      details: {
        transport: this.options.remoteInstance.transport,
        ...progress.metadata,
      },
    });
  }
}
