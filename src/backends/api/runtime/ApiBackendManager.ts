import type { ExecutionHandle, StreamEvent } from '../../../core/types.js';
import { LocalToolRuntime } from '../../../core/tools/LocalToolRuntime.js';
import type { SessionRegistry } from '../../cli/pool/SessionRegistry.js';
import type { CliRuntimeConfig, RemoteProviderInstanceConfig } from '../../cli/config.js';
import type { ProviderTargetDescriptor } from '../../../core/providerCatalog.js';
import { loadTranscriptMessages } from '../history.js';
import { AnthropicTransport } from '../transports/anthropic.js';
import { GeminiTransport } from '../transports/gemini.js';
import { OllamaTransport } from '../transports/ollama.js';
import { OpenAiTransport } from '../transports/openai.js';
import { ApiExecutionHandle } from './ApiExecutionHandle.js';
import type {
  ApiBackendOptions,
  ApiBackendStatus,
  ApiConversationMessage,
  ApiConversationPart,
  ApiToolCallPart,
  ApiTransportClient,
} from '../types.js';
import { API_PROVIDER_CAPABILITIES } from '../types.js';

const DEFAULT_MAX_TOOL_STEPS = 20;

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
      return new OllamaTransport(options.fetch);
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

function extractTextParts(message: ApiConversationMessage): string[] {
  return message.parts
    .filter((part): part is Extract<ApiConversationPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter((text) => text.length > 0);
}

function extractToolCalls(message: ApiConversationMessage): ApiToolCallPart[] {
  return message.parts.filter((part): part is ApiToolCallPart => part.type === 'tool_call');
}

function lastUserText(messages: ApiConversationMessage[]): string | undefined {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') {
    return undefined;
  }

  return last.parts
    .filter((part): part is Extract<ApiConversationPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function prependSystemPrompt(
  messages: ApiConversationMessage[],
  systemPrompt: string | undefined,
): ApiConversationMessage[] {
  if (!systemPrompt) {
    return messages;
  }

  if (messages[0]?.role === 'system') {
    return messages;
  }

  return [{
    role: 'system',
    parts: [{ type: 'text', text: systemPrompt }],
  }, ...messages];
}

export class ApiBackendManager {
  private readonly options: Required<ApiBackendOptions>;
  private readonly handles = new Map<string, ApiExecutionHandle>();
  private readonly targets = new Map<string, ProviderTargetDescriptor>();
  private readonly tools = new LocalToolRuntime();

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

    const handle = new ApiExecutionHandle({
      streamMessage: (message, signal) => this.streamTurn(sessionId, target, message, signal),
      onClose: () => {
        this.handles.delete(sessionId);
        this.targets.delete(sessionId);
      },
    });

    this.handles.set(sessionId, handle);
    this.targets.set(sessionId, target);
    return handle;
  }

  kill(sessionId: string): void {
    const handle = this.handles.get(sessionId);
    if (handle) {
      handle.kill();
    }
  }

  killAll(): void {
    for (const sessionId of Array.from(this.handles.keys())) {
      this.kill(sessionId);
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
    message: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const session = this.registry.get(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    const remoteInstance = ensureRemoteTarget(target);
    const model = session.model || remoteInstance.model;
    if (!model) {
      throw new Error(
        `Provider '${target.providerName}' target '${target.backend}/${target.instanceId}' `
        + 'does not define a model and the session did not override one',
      );
    }

    const transcriptPath = session.sourcePath || session.providerSourcePath;
    const conversation = prependSystemPrompt(
      await loadTranscriptMessages(transcriptPath),
      remoteInstance.systemPrompt,
    );
    if (lastUserText(conversation) !== message) {
      conversation.push({
        role: 'user',
        parts: [{ type: 'text', text: message }],
      });
    }

    const transport = buildTransport(remoteInstance, this.options);
    const toolDefinitions = this.tools.listTools(remoteInstance.toolProfile);
    const permissionMode = session.permissionMode || (session.workspaceMode === 'read_only' ? 'default' : 'skip');

    let responseId: string | undefined;
    let initialized = false;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    const maxToolSteps = remoteInstance.maxToolSteps ?? DEFAULT_MAX_TOOL_STEPS;

    for (let step = 0; step < maxToolSteps; step += 1) {
      const completion = await transport.completeTurn({
        sessionId,
        providerName: session.providerName,
        instance: remoteInstance,
        model,
        messages: conversation,
        tools: toolDefinitions,
        signal,
      });

      if (!initialized) {
        initialized = true;
        responseId = completion.responseId || responseId;
        yield {
          type: 'init',
          sessionId: responseId,
          raw: completion.raw,
        };
      } else if (!responseId && completion.responseId) {
        responseId = completion.responseId;
      }

      totalInputTokens += completion.usage?.inputTokens ?? 0;
      totalOutputTokens += completion.usage?.outputTokens ?? 0;
      conversation.push(completion.assistant);

      for (const text of extractTextParts(completion.assistant)) {
        yield {
          type: 'text',
          text,
          raw: completion.raw,
        };
      }

      const toolCalls = extractToolCalls(completion.assistant);
      if (toolCalls.length === 0) {
        yield {
          type: 'result',
          sessionId: responseId,
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          raw: completion.raw,
        };
        return;
      }

      const toolResultMessage: ApiConversationMessage = {
        role: 'user',
        parts: [],
      };

      for (const toolCall of toolCalls) {
        yield {
          type: 'tool_use',
          toolName: toolCall.name,
          toolId: toolCall.id,
          text: JSON.stringify(toolCall.arguments),
          toolArgs: toolCall.arguments,
          raw: toolCall.raw,
        };
      }

      for (const toolCall of toolCalls) {
        const toolResult = await this.tools.execute({
          sessionId,
          cwd: session.cwd,
          workspaceMode: session.workspaceMode,
          permissionMode,
          allowedTools: session.allowedTools,
          toolProfile: remoteInstance.toolProfile,
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

        yield {
          type: 'tool_result',
          toolName: toolResult.name,
          toolId: toolResult.callId,
          text: toolResult.output,
          isError: toolResult.isError,
        };
      }

      conversation.push(toolResultMessage);
    }

    throw new Error(`Exceeded tool loop limit of ${maxToolSteps} steps`);
  }
}
