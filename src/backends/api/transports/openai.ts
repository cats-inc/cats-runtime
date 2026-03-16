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
    throw new Error(`OpenAI instance '${instance.providerName}/${instance.id}' is missing api_key_env`);
  }

  const apiKey = env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`OpenAI API key env '${apiKeyEnv}' is not set`);
  }

  return apiKey;
}

function resolveBaseUrl(instance: RemoteProviderInstanceConfig, env: NodeJS.ProcessEnv): string {
  const fromEnv = instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined;
  return fromEnv || instance.baseUrl || 'https://api.openai.com';
}

function toOpenAiMessages(messages: ApiConversationMessage[]): Array<Record<string, unknown>> {
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
            tool_call_id: part.toolCallId,
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
        id: part.id,
        type: 'function',
        function: {
          name: part.name,
          arguments: JSON.stringify(part.arguments),
        },
      }));

    mapped.push({
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }

  return mapped;
}

function extractAssistantParts(message: unknown): ApiConversationPart[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const payload = message as Record<string, unknown>;
  const parts: ApiConversationPart[] = [];
  if (typeof payload.content === 'string' && payload.content) {
    parts.push({ type: 'text', text: payload.content });
  }

  const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls : [];
  for (const item of toolCalls) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const toolCall = item as Record<string, unknown>;
    const fn = toolCall.function && typeof toolCall.function === 'object'
      ? toolCall.function as Record<string, unknown>
      : {};
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === 'string' && fn.arguments) {
      try {
        const parsed = JSON.parse(fn.arguments);
        if (parsed && typeof parsed === 'object') {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        args = {};
      }
    }
    if (typeof toolCall.id === 'string' && typeof fn.name === 'string') {
      parts.push({
        type: 'tool_call',
        id: toolCall.id,
        name: fn.name,
        arguments: args,
        raw: toolCall,
      } satisfies ApiToolCallPart);
    }
  }

  return parts;
}

function toOpenAiTools(input: ApiCompletionInput): Array<Record<string, unknown>> {
  return input.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

export class OpenAiTransport implements ApiTransportClient {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async completeTurn(input: ApiCompletionInput): Promise<ApiCompletionResponse> {
    const apiKey = requireApiKey(input.instance, this.env);
    const baseUrl = resolveBaseUrl(input.instance, this.env);
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...input.instance.headers,
    };
    if (input.instance.organizationEnv && this.env[input.instance.organizationEnv]) {
      headers['OpenAI-Organization'] = this.env[input.instance.organizationEnv]!;
    }
    if (input.instance.projectEnv && this.env[input.instance.projectEnv]) {
      headers['OpenAI-Project'] = this.env[input.instance.projectEnv]!;
    }

    const response = await this.fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: input.model,
        messages: toOpenAiMessages(input.messages),
        tools: input.tools.length > 0 ? toOpenAiTools(input) : undefined,
        tool_choice: input.tools.length > 0 ? 'auto' : undefined,
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${await readErrorBody(response)}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const choice = choices[0] && typeof choices[0] === 'object'
      ? choices[0] as Record<string, unknown>
      : {};
    const message = choice.message;
    const usage = payload.usage && typeof payload.usage === 'object'
      ? payload.usage as Record<string, unknown>
      : {};

    return {
      responseId: typeof payload.id === 'string' ? payload.id : undefined,
      assistant: {
        role: 'assistant',
        parts: extractAssistantParts(message),
      },
      usage: {
        inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
        outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
      },
      raw: payload,
    };
  }
}
