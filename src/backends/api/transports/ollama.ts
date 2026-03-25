import type {
  ApiCompletionInput,
  ApiCompletionResponse,
  ApiConversationMessage,
  ApiConversationPart,
  ApiProgressEvent,
  ApiToolCallPart,
  ApiTransportClient,
} from '../types.js';
import { readErrorBody } from '../../../core/streamParsers.js';
import type { RemoteProviderInstanceConfig } from '../../cli/config.js';
import { applyPayloadTemplate, readPayloadTemplateString } from '../payloadTemplate.js';
import { ApiTransportError, readRetryAfterMs } from './error.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

function mergeRuntimePatch<T extends Record<string, unknown>>(
  requestBody: T,
  runtimePatch?: Record<string, unknown>,
): T {
  if (!runtimePatch) {
    return requestBody;
  }

  return applyPayloadTemplate(runtimePatch as T, requestBody);
}

function resolveBaseUrl(instance: RemoteProviderInstanceConfig, env: NodeJS.ProcessEnv): string {
  const fromEnv = instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined;
  return fromEnv || instance.baseUrl || 'http://127.0.0.1:11434';
}

function toOllamaMessages(messages: ApiConversationMessage[]): Array<Record<string, unknown>> {
  const mapped: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      const text = message.parts
        .filter((part): part is Extract<ApiConversationPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      mapped.push({ role: 'system', content: text });
      continue;
    }

    if (message.role === 'user') {
      const toolResults = message.parts.filter((part): part is Extract<ApiConversationPart, { type: 'tool_result' }> => part.type === 'tool_result');
      if (toolResults.length > 0) {
        for (const part of toolResults) {
          mapped.push({
            role: 'tool',
            tool_name: part.name,
            content: part.output,
          });
        }
        continue;
      }

      const text = message.parts
        .filter((part): part is Extract<ApiConversationPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      mapped.push({ role: 'user', content: text });
      continue;
    }

    const text = message.parts
      .filter((part): part is Extract<ApiConversationPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    const toolCalls = message.parts
      .filter((part): part is Extract<ApiConversationPart, { type: 'tool_call' }> => part.type === 'tool_call')
      .map((part) => ({
        function: {
          name: part.name,
          arguments: part.arguments,
        },
      }));

    mapped.push({
      role: 'assistant',
      content: text,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }

  return mapped;
}

function toOllamaTools(input: ApiCompletionInput): Array<Record<string, unknown>> {
  return input.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function extractAssistantParts(payload: Record<string, unknown>): ApiConversationPart[] {
  const message = payload.message && typeof payload.message === 'object'
    ? payload.message as Record<string, unknown>
    : {};
  const parts: ApiConversationPart[] = [];

  if (typeof message.content === 'string' && message.content) {
    parts.push({ type: 'text', text: message.content });
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const item of toolCalls) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const functionCall = (item as Record<string, unknown>).function;
    const fn = functionCall && typeof functionCall === 'object'
      ? functionCall as Record<string, unknown>
      : {};
    if (typeof fn.name !== 'string') {
      continue;
    }
    parts.push({
      type: 'tool_call',
      id: typeof (item as Record<string, unknown>).id === 'string'
        ? (item as Record<string, unknown>).id as string
        : `ollama-${fn.name}-${parts.length + 1}`,
      name: fn.name,
      arguments: fn.arguments && typeof fn.arguments === 'object'
        ? fn.arguments as Record<string, unknown>
        : {},
      raw: item,
    } satisfies ApiToolCallPart);
  }

  return parts;
}

export class OllamaTransport implements ApiTransportClient {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async completeTurn(input: ApiCompletionInput): Promise<ApiCompletionResponse> {
    const baseUrl = resolveBaseUrl(input.instance, this.env);
    const keepAlive = readPayloadTemplateString(
      input.instance.payloadTemplate,
      'keep_alive',
      'keepAlive',
    );
    const progress: ApiProgressEvent[] = [];
    if (keepAlive) {
      progress.push({
        kind: 'model_state',
        status: 'hinted',
        message: 'Applied an Ollama keep_alive hint to keep the model warm.',
        metadata: {
          strategy: 'keep_alive',
          keepAlive,
        },
      });
    }
    const runtimeBody = mergeRuntimePatch({
      model: input.model,
      stream: false,
      messages: toOllamaMessages(input.messages),
      tools: input.tools.length > 0 ? toOllamaTools(input) : undefined,
      options: {
        num_predict: input.instance.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      },
    }, input.requestBodyPatch);
    const requestBody = applyPayloadTemplate(runtimeBody, input.instance.payloadTemplate);
    const response = await this.fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...input.instance.headers,
      },
      body: JSON.stringify(requestBody),
      signal: input.signal,
    });

    if (!response.ok) {
      throw new ApiTransportError('Ollama', {
        statusCode: response.status,
        retryAfterMs: readRetryAfterMs(response.headers),
        responseBody: await readErrorBody(response),
      });
    }

    const payload = await response.json() as Record<string, unknown>;
    return {
      assistant: {
        role: 'assistant',
        parts: extractAssistantParts(payload),
      },
      usage: {
        inputTokens: typeof payload.prompt_eval_count === 'number' ? payload.prompt_eval_count : 0,
        outputTokens: typeof payload.eval_count === 'number' ? payload.eval_count : 0,
      },
      progress: progress.length > 0 ? progress : undefined,
      raw: payload,
    };
  }
}
