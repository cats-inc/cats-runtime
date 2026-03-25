import type {
  ExecutionHandle,
  RuntimeExecutionStrategyId,
  RuntimeExecutionStrategyRequest,
  RuntimeExecutionStrategyState,
  StreamEvent,
  TurnInput,
} from '../../../core/types.js';
import { mergeRuntimeInstructionLayers } from '../../../core/skills/catalog.js';
import { LocalToolRuntime } from '../../../core/tools/LocalToolRuntime.js';
import { buildProviderExecutionRequestPatch } from '../../../core/models/providerSelectionResolution.js';
import { resolveRuntimeExecutionStrategy } from '../../../core/runtime/strategies/resolution.js';
import {
  mergeRuntimeExecutionStrategyRequests,
  normalizeRuntimeExecutionStrategyRequest,
  readRuntimeExecutionStrategyRequest,
  readRuntimeExecutionStrategyState,
} from '../../../core/runtime/strategies/state.js';
import type { SessionRegistry } from '../../cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig, RemoteProviderInstanceConfig } from '../../cli/config.js';
import type { ProviderTargetDescriptor } from '../../../core/providerCatalog.js';
import { loadTranscriptMessages } from '../history.js';
import { AnthropicTransport } from '../transports/anthropic.js';
import { GeminiTransport } from '../transports/gemini.js';
import { OllamaTransport } from '../transports/ollama.js';
import { OpenAiTransport } from '../transports/openai.js';
import {
  ManagedExecutionHandle,
  type ManagedExecutionLifecycleReason,
} from '../../../core/runtime/ManagedExecutionHandle.js';
import type {
  ApiBackendOptions,
  ApiBackendStatus,
  ApiConversationMessage,
  ApiTransportClient,
} from '../types.js';
import { API_PROVIDER_CAPABILITIES } from '../types.js';
import { ApiTransportError } from '../transports/error.js';
import { extractTextParts } from './messageParts.js';
import {
  API_RUNTIME_COMPATIBILITY_STRATEGY,
  createApiRuntimeExecutionStrategyRegistry,
} from './strategies/registry.js';
import { ApiStrategyExecutionContext } from './strategies/ApiStrategyExecutionContext.js';

const DEFAULT_MAX_TOOL_STEPS = 20;
const DEFAULT_REACT_STUCK_THRESHOLD = 2;
const MAX_STRATEGY_CONTEXT_PROMPT_ENTRIES = 8;
const MAX_STRATEGY_CONTEXT_PROMPT_VALUE_LENGTH = 240;

function defaultFetch(): typeof fetch {
  return fetch;
}

function buildTransport(
  instance: RemoteProviderInstanceConfig,
  options: Required<ApiBackendOptions>,
): ApiTransportClient {
  switch (instance.transport) {
    case 'anthropic':
      return new AnthropicTransport(options.fetch, options.env);
    case 'openai':
      return new OpenAiTransport(options.fetch, options.env);
    case 'google':
    case 'gemini':
      return new GeminiTransport(options.fetch, options.env);
    case 'ollama':
      return new OllamaTransport(options.fetch, options.env);
    default:
      throw new Error(
        `Unsupported remote transport '${instance.transport || 'unknown'}' `
        + `for ${instance.providerName}/${instance.id}`,
      );
  }
}

function ensureRemoteTarget(target: ProviderTargetDescriptor): RemoteProviderInstanceConfig {
  if (!target.remoteInstance) {
    throw new Error(
      `Provider '${target.providerName}' target '${target.backend}/${target.instanceId}' `
      + 'does not resolve to a remote instance',
    );
  }

  return target.remoteInstance;
}

function lastUserText(messages: ApiConversationMessage[]): string | undefined {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') {
    return undefined;
  }

  return extractTextParts(last).join('\n');
}

function prependSystemPrompt(
  messages: ApiConversationMessage[],
  ...systemPrompts: Array<string | undefined>
): ApiConversationMessage[] {
  const combinedPrompt = systemPrompts
    .map((prompt) => prompt?.trim())
    .filter((prompt): prompt is string => Boolean(prompt))
    .join('\n\n');

  if (!combinedPrompt) {
    return messages;
  }

  if (messages[0]?.role === 'system') {
    const [first, ...rest] = messages;
    return [{
      role: 'system',
      parts: [{
        type: 'text',
        text: [combinedPrompt, ...extractTextParts(first)].filter(Boolean).join('\n\n'),
      }],
    }, ...rest];
  }

  return [{
    role: 'system',
    parts: [{ type: 'text', text: combinedPrompt }],
  }, ...messages];
}

function toErrorStreamEvent(
  error: unknown,
  target: ProviderTargetDescriptor,
  providerSessionId?: string,
): StreamEvent {
  if (error instanceof ApiTransportError) {
    return {
      type: 'error',
      providerSessionId,
      text: error.message,
      metadata: {
        provider: target.providerName,
        backend: target.backend,
        instance: target.instanceId,
        incidentHint: {
          statusCode: error.statusCode,
          retryAfterMs: error.retryAfterMs,
          body: error.responseBody,
        },
      },
    };
  }

  return {
    type: 'error',
    providerSessionId,
    text: error instanceof Error ? error.message : String(error),
    metadata: {
      provider: target.providerName,
      backend: target.backend,
      instance: target.instanceId,
    },
  };
}

function buildStrategyInstructionOverlay(
  strategyId: RuntimeExecutionStrategyId,
  request: RuntimeExecutionStrategyRequest | undefined,
): string | undefined {
  if (strategyId !== 'react') {
    return undefined;
  }

  const sections = [
    'Execution strategy: react. Work in short reason-act-observe loops, avoid repeating the same tool calls, and stop once the user request is satisfied.',
    request?.acceptanceCriteria
      ? `Acceptance criteria:\n${request.acceptanceCriteria}`
      : undefined,
    request?.strategyContext
      ? formatStrategyContextForInstruction(request.strategyContext)
      : undefined,
  ].filter((section): section is string => Boolean(section));

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function resolveStrategyConstraints(
  instance: RemoteProviderInstanceConfig,
  request: RuntimeExecutionStrategyRequest | undefined,
  strategyId: RuntimeExecutionStrategyId,
): {
  stepLimit: number;
  timeoutMs?: number;
  stuckThreshold: number;
} {
  const strategyContext = request?.strategyContext;
  const stepLimit = readStrategyPositiveInteger(
    strategyContext,
    'maxSteps',
  ) || instance.maxToolSteps || DEFAULT_MAX_TOOL_STEPS;
  const timeoutMs = strategyId === 'react'
    ? readStrategyPositiveInteger(strategyContext, 'timeoutMs') || instance.timeoutMs
    : undefined;
  const stuckThreshold = strategyId === 'react'
    ? readStrategyPositiveInteger(strategyContext, 'stuckThreshold') || DEFAULT_REACT_STUCK_THRESHOLD
    : 0;

  return {
    stepLimit,
    ...(timeoutMs ? { timeoutMs } : {}),
    stuckThreshold,
  };
}

function resolveRegisteredStrategyHint(
  strategyId: RuntimeExecutionStrategyId | undefined,
  registry: ReturnType<typeof createApiRuntimeExecutionStrategyRegistry>,
): RuntimeExecutionStrategyId | undefined {
  return strategyId && registry.has(strategyId) ? strategyId : undefined;
}

function readUnsupportedRequestedStrategy(
  currentRequest: RuntimeExecutionStrategyRequest | undefined,
  effectiveRequest: RuntimeExecutionStrategyRequest | undefined,
  existingStrategyState: RuntimeExecutionStrategyState | undefined,
  resolvedStrategy: RuntimeExecutionStrategyId | undefined,
): string | undefined {
  const explicitRequestedStrategy = currentRequest?.requestedStrategy?.trim();
  if (explicitRequestedStrategy) {
    return resolvedStrategy ? undefined : explicitRequestedStrategy;
  }

  const requestedStrategy = effectiveRequest?.requestedStrategy?.trim();
  if (!requestedStrategy || resolvedStrategy) {
    return undefined;
  }

  const alreadyRecordedFallback = Boolean(
    existingStrategyState?.effectiveStrategy
    || existingStrategyState?.resolutionSource
    || existingStrategyState?.summary,
  );
  if (alreadyRecordedFallback) {
    return undefined;
  }

  return requestedStrategy;
}

function readStrategyPositiveInteger(
  record: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  if (!record || typeof record[key] !== 'number') {
    return undefined;
  }

  const value = record[key] as number;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function formatStrategyContextForInstruction(
  strategyContext: Record<string, unknown>,
): string | undefined {
  const entries = Object.entries(strategyContext).slice(0, MAX_STRATEGY_CONTEXT_PROMPT_ENTRIES);
  if (entries.length === 0) {
    return undefined;
  }
  const lines = entries.map(([key, value]) => `${key}: ${summarizeStrategyContextValue(value)}`);
  const remainingEntries = Object.keys(strategyContext).length - entries.length;

  if (remainingEntries > 0) {
    lines.push(`... ${remainingEntries} more entr${remainingEntries === 1 ? 'y' : 'ies'} omitted by runtime.`);
  }

  return [
    'Strategy context (condensed runtime summary):',
    ...lines,
  ].join('\n');
}

function summarizeStrategyContextValue(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(truncateStrategyContextValue(value));
  }

  if (
    typeof value === 'number'
    || typeof value === 'boolean'
    || value === null
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[array(${value.length})]`;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `[object keys: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', ...' : ''}]`;
  }

  return JSON.stringify(value);
}

function truncateStrategyContextValue(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_STRATEGY_CONTEXT_PROMPT_VALUE_LENGTH
    ? `${trimmed.slice(0, MAX_STRATEGY_CONTEXT_PROMPT_VALUE_LENGTH)}...`
    : trimmed;
}

export class ApiBackendManager {
  private readonly options: Required<ApiBackendOptions>;
  private readonly handles = new Map<string, ManagedExecutionHandle>();
  private readonly targets = new Map<string, ProviderTargetDescriptor>();
  private readonly tools = new LocalToolRuntime();
  private readonly strategyRegistry = createApiRuntimeExecutionStrategyRegistry();

  constructor(
    private readonly config: Pick<CliRuntimeConfig, 'sessionBaseDir'>,
    private readonly registry: SessionRegistry,
    options: ApiBackendOptions = {},
  ) {
    this.options = {
      fetch: options.fetch || defaultFetch(),
      env: options.env || process.env,
    };
  }

  get(sessionId: string): ExecutionHandle | undefined {
    return this.handles.get(sessionId);
  }

  isAttached(sessionId: string): boolean {
    return this.handles.get(sessionId)?.active === true;
  }

  getCapabilities() {
    return API_PROVIDER_CAPABILITIES;
  }

  spawn(
    sessionId: string,
    target: ProviderTargetDescriptor,
  ): ExecutionHandle {
    const existing = this.handles.get(sessionId);
    if (existing?.active) {
      return existing;
    }

    const handle = new ManagedExecutionHandle({
      streamMessage: (message, signal) => this.streamTurn(sessionId, target, message, signal),
      onClose: async () => {
        this.handles.delete(sessionId);
        this.targets.delete(sessionId);
      },
    });

    this.handles.set(sessionId, handle);
    this.targets.set(sessionId, target);
    return handle;
  }

  kill(sessionId: string): void {
    void this.close(sessionId, 'close');
  }

  async cancel(
    sessionId: string,
    reason: ManagedExecutionLifecycleReason = 'cancel',
  ): Promise<void> {
    const handle = this.handles.get(sessionId);
    if (!handle) {
      return;
    }

    await handle.cancel(reason);
  }

  async close(
    sessionId: string,
    reason: ManagedExecutionLifecycleReason = 'close',
  ): Promise<void> {
    const handle = this.handles.get(sessionId);
    if (!handle) {
      return;
    }

    try {
      await handle.close(reason);
    } catch (error) {
      // API transport cleanup can fail after the local handle has already detached.
      if (!this.handles.has(sessionId)) {
        return;
      }
      throw error;
    }
  }

  killAll(): void {
    for (const sessionId of Array.from(this.handles.keys())) {
      void this.close(sessionId, 'shutdown').catch(() => {});
    }
  }

  status(): ApiBackendStatus {
    const providers: Record<string, number> = {};
    let active = 0;
    let busy = 0;
    let idle = 0;

    for (const [sessionId, handle] of this.handles.entries()) {
      if (!handle.active) {
        continue;
      }

      active += 1;
      if (handle.busy) {
        busy += 1;
      } else {
        idle += 1;
      }

      const session = this.registry.get(sessionId);
      if (session) {
        providers[session.providerName] = (providers[session.providerName] ?? 0) + 1;
      }
    }

    return {
      active,
      busy,
      idle,
      providers,
    };
  }

  private async *streamTurn(
    sessionId: string,
    target: ProviderTargetDescriptor,
    turn: TurnInput,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const initialSession = this.registry.get(sessionId);
    if (!initialSession) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const remoteInstance = ensureRemoteTarget(target);
    const model = initialSession.modelResolution?.model || initialSession.model || remoteInstance.model;
    if (!model) {
      throw new Error(
        `Provider '${target.providerName}' target '${target.backend}/${target.instanceId}' `
        + 'does not define a model and the session did not override one',
      );
    }

    const currentRequest = normalizeRuntimeExecutionStrategyRequest({
      requestedStrategy: turn.requestedStrategy,
      acceptanceCriteria: turn.acceptanceCriteria,
      strategyContext: turn.strategyContext,
      correlation: turn.correlation,
    });
    const persistedRequest = readRuntimeExecutionStrategyRequest(initialSession);
    const effectiveRequest = mergeRuntimeExecutionStrategyRequests(
      persistedRequest,
      currentRequest,
    );
    const existingStrategyState = readRuntimeExecutionStrategyState(initialSession);
    const requestedStrategy = resolveRegisteredStrategyHint(
      effectiveRequest?.requestedStrategy,
      this.strategyRegistry,
    );
    const preferredStrategy = resolveRegisteredStrategyHint(
      existingStrategyState?.preferredStrategy,
      this.strategyRegistry,
    );
    const resolution = resolveRuntimeExecutionStrategy({
      requestedStrategy,
      preferredStrategy,
      fallbackStrategy: API_RUNTIME_COMPATIBILITY_STRATEGY,
    });
    const unsupportedRequestedStrategy = readUnsupportedRequestedStrategy(
      currentRequest,
      effectiveRequest,
      existingStrategyState,
      requestedStrategy,
    );

    const transcriptPath = initialSession.sourcePath || initialSession.providerSourcePath;
    const strategyInstructions = buildStrategyInstructionOverlay(
      resolution.effectiveStrategy,
      effectiveRequest,
    );
    const composedInstructions = mergeRuntimeInstructionLayers(
      turn.skills ?? initialSession.skills,
      turn.sessionInstructions ?? initialSession.instructions,
      turn.instructions,
      strategyInstructions,
    );
    const conversation = prependSystemPrompt(
      await loadTranscriptMessages(transcriptPath),
      remoteInstance.systemPrompt,
      composedInstructions,
    );
    if (lastUserText(conversation) !== turn.message) {
      conversation.push({
        role: 'user',
        parts: [{ type: 'text', text: turn.message }],
      });
    }

    const transport = buildTransport(remoteInstance, this.options);
    const permissionMode = initialSession.permissionMode
      || (initialSession.workspaceMode === 'read_only' ? 'default' : 'skip');
    const requestBodyPatch = buildProviderExecutionRequestPatch(
      target,
      initialSession.modelResolution?.controls,
    );
    const strategy = this.strategyRegistry.resolve(resolution.effectiveStrategy);
    const constraints = resolveStrategyConstraints(
      remoteInstance,
      effectiveRequest,
      resolution.effectiveStrategy,
    );
    const emitLifecycleEvents = resolution.effectiveStrategy !== API_RUNTIME_COMPATIBILITY_STRATEGY
      || resolution.source !== 'compatibility_fallback';
    const context = new ApiStrategyExecutionContext({
      session: initialSession,
      registry: this.registry,
      target,
      remoteInstance,
      transport,
      tools: this.tools,
      toolProfile: remoteInstance.toolProfile,
      permissionMode,
      request: effectiveRequest,
      resolution,
      requestBodyPatch,
      model,
      conversation,
      signal,
      constraints,
      emitLifecycleEvents,
      // Only strategies resolved through the runtime registry may become a
      // session-level preference. Unsupported hints remain request metadata
      // only and continue to degrade through compatibility fallback.
      rememberRequestedStrategyPreference: Boolean(requestedStrategy),
    });

    try {
      if (unsupportedRequestedStrategy) {
        yield context.createStrategyEvent(
          'strategy_degraded',
          'fallback',
          `Requested strategy '${unsupportedRequestedStrategy}' is not supported by this runtime; falling back to '${resolution.effectiveStrategy}'.`,
          {
            degradedStrategy: unsupportedRequestedStrategy,
            fallbackStrategy: resolution.effectiveStrategy,
          },
        );
      }
      for await (const event of strategy.execute(context)) {
        yield event;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      context.updateStrategy({
        status: 'failed',
        stepCount: context.session.strategy?.summary?.stepCount || 0,
        stepLimit: constraints.stepLimit,
        timeoutMs: constraints.timeoutMs,
        failureReason: message,
        lastEvent: 'strategy_failed',
      });
      if (emitLifecycleEvents) {
        yield context.createStrategyEvent(
          'strategy_failed',
          'failed',
          message,
        );
      }
      yield toErrorStreamEvent(error, target, context.providerSessionId);
    }
  }
}
