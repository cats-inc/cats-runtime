import type { RemoteProviderInstanceConfig } from '../../cli/config.js';
import type {
  ApiCompletionInput,
  ApiCompletionResponse,
  ApiConversationMessage,
  ApiConversationPart,
  ApiToolCallPart,
  ApiTransportClient,
} from '../types.js';
import { readErrorBody } from './streaming.js';

function requireApiKey(instance: RemoteProviderInstanceConfig, env: NodeJS.ProcessEnv): string {
  const apiKeyEnv = instance.apiKeyEnv;
  if (!apiKeyEnv) {
    throw new Error(`Anthropic instance '${instance.providerName}/${instance.id}' is missing api_key_env`);
  }

  const apiKey = env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Anthropic API key env '${apiKeyEnv}' is not set`);
  }

  return apiKey;
}

function resolveBaseUrl(instance: RemoteProviderInstanceConfig, env: NodeJS.ProcessEnv): string {
  const fromEnv = instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined;
  return fromEnv || instance.baseUrl || 'https://api.anthropic.com';
}

function toAnthropicMessage(message: ApiConversationMessage): Record<string, unknown> | null {
  if (message.role === 'system') {
    return null;
  }

  const content = message.parts.flatMap<Record<string, unknown>>((part) => {
    if (part.type === 'text') {
      return [{ type: 'text', text: part.text }];
    }
    if (part.type === 'tool_call' && message.role === 'assistant') {
      return [{
        type: 'tool_use',
        id: part.id,
        name: part.name,
        input: part.arguments,
      }];
    }
    if (part.type === 'tool_result' && message.role === 'user') {
      return [{
        type: 'tool_result',
        tool_use_id: part.toolCallId,
        content: part.output,
        is_error: part.isError === true,
      }];
    }
    return [];
  });

  return {
    role: message.role,
    content,
  };
}

function toAnthropicTools(input: ApiCompletionInput): Array<Record<string, unknown>> {
  return input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function extractAssistantParts(content: unknown): ApiConversationPart[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: ApiConversationPart[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const block = item as Record<string, unknown>;
    if (block.type === 'text' && typeof block.text === 'string' && block.text) {
      parts.push({ type: 'text', text: block.text });
      continue;
    }
    if (
      block.type === 'tool_use'
      && typeof block.id === 'string'
      && typeof block.name === 'string'
    ) {
      parts.push({
        type: 'tool_call',
        id: block.id,
        name: block.name,
        arguments: block.input && typeof block.input === 'object'
          ? block.input as Record<string, unknown>
          : {},
        raw: block,
      } satisfies ApiToolCallPart);
    }
  }
  return parts;
}

export class AnthropicTransport implements ApiTransportClient {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async completeTurn(input: ApiCompletionInput): Promise<ApiCompletionResponse> {
    const apiKey = requireApiKey(input.instance, this.env);
    const baseUrl = resolveBaseUrl(input.instance, this.env);
    const response = await this.fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...input.instance.headers,
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 4096,
        messages: input.messages
          .map(toAnthropicMessage)
          .filter((message): message is Record<string, unknown> => Boolean(message)),
        tools: input.tools.length > 0 ? toAnthropicTools(input) : undefined,
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${await readErrorBody(response)}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    const usage = payload.usage && typeof payload.usage === 'object'
      ? payload.usage as Record<string, unknown>
      : {};

    return {
      responseId: typeof payload.id === 'string' ? payload.id : undefined,
      assistant: {
        role: 'assistant',
        parts: extractAssistantParts(payload.content),
      },
      usage: {
        inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
        outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
      },
      raw: payload,
    };
  }
}
