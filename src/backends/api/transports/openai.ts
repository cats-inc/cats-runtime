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

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

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

function extractSystemPrompt(messages: ApiConversationMessage[]): string | undefined {
  const text = messages
    .filter((message) => message.role === 'system')
    .flatMap((message) => message.parts)
    .filter((part): part is Extract<ApiConversationPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n');

  return text || undefined;
}

function messageText(message: ApiConversationMessage): string {
  return message.parts
    .filter((part): part is Extract<ApiConversationPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function toOpenAiInputItems(messages: ApiConversationMessage[]): Array<Record<string, unknown>> {
  const mapped: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }

    if (message.role === 'user') {
      const toolResults = message.parts.filter((part): part is Extract<ApiConversationPart, { type: 'tool_result' }> => part.type === 'tool_result');
      const text = messageText(message);
      if (text) {
        mapped.push({ role: 'user', content: text });
      }
      if (toolResults.length > 0) {
        for (const part of toolResults) {
          mapped.push({
            type: 'function_call_output',
            call_id: part.toolCallId,
            output: part.output,
          });
        }
      }
      continue;
    }

    const text = messageText(message);
    if (text) {
      mapped.push({
        role: 'assistant',
        content: text,
      });
    }

    const toolCalls = message.parts
      .filter((part): part is Extract<ApiConversationPart, { type: 'tool_call' }> => part.type === 'tool_call');
    for (const part of toolCalls) {
      mapped.push({
        type: 'function_call',
        call_id: part.id,
        name: part.name,
        arguments: JSON.stringify(part.arguments),
      });
    }
  }

  return mapped;
}

function toIncrementalInput(messages: ApiConversationMessage[]): Array<Record<string, unknown>> | null {
  const lastMessage = [...messages].reverse().find((message) => message.role !== 'system');
  if (!lastMessage) {
    return null;
  }

  const input = toOpenAiInputItems([lastMessage]);
  return input.length > 0 ? input : null;
}

function extractAssistantParts(payload: Record<string, unknown>): ApiConversationPart[] {
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: ApiConversationPart[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const entry = item as Record<string, unknown>;
    if (entry.type === 'message') {
      const content = Array.isArray(entry.content) ? entry.content : [];
      for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== 'object') {
          continue;
        }
        const block = contentItem as Record<string, unknown>;
        if (block.type === 'output_text' && typeof block.text === 'string' && block.text) {
          parts.push({ type: 'text', text: block.text });
        }
      }
      continue;
    }

    if (
      entry.type === 'function_call'
      && typeof entry.call_id === 'string'
      && typeof entry.name === 'string'
    ) {
      let args: Record<string, unknown> = {};
      if (typeof entry.arguments === 'string' && entry.arguments) {
        try {
          const parsed = JSON.parse(entry.arguments);
          if (parsed && typeof parsed === 'object') {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          args = {};
        }
      }
      parts.push({
        type: 'tool_call',
        id: entry.call_id,
        name: entry.name,
        arguments: args,
        raw: entry,
      } satisfies ApiToolCallPart);
    }
  }

  if (parts.length === 0 && typeof payload.output_text === 'string' && payload.output_text) {
    parts.push({ type: 'text', text: payload.output_text });
  }

  return parts;
}

function toOpenAiTools(input: ApiCompletionInput): Array<Record<string, unknown>> {
  return input.tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

function shouldRetryWithoutPreviousResponseId(errorBody: string): boolean {
  const normalized = errorBody.toLowerCase();
  return normalized.includes('previous_response_id')
    || normalized.includes('response not found')
    || normalized.includes('not found')
    || normalized.includes('expired');
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

    const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/responses`;
    const instructions = extractSystemPrompt(input.messages);
    const incrementalInput = input.previousResponseId
      ? toIncrementalInput(input.messages)
      : null;

    const sendRequest = async (usePreviousResponseId: boolean): Promise<ApiCompletionResponse> => {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: input.model,
          instructions,
          input: usePreviousResponseId && incrementalInput
            ? incrementalInput
            : toOpenAiInputItems(input.messages),
          previous_response_id: usePreviousResponseId ? input.previousResponseId : undefined,
          tools: input.tools.length > 0 ? toOpenAiTools(input) : undefined,
          tool_choice: input.tools.length > 0 ? 'auto' : undefined,
          max_output_tokens: input.instance.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        if (usePreviousResponseId && shouldRetryWithoutPreviousResponseId(errorBody)) {
          return sendRequest(false);
        }
        throw new Error(`OpenAI request failed: ${errorBody}`);
      }

      const payload = await response.json() as Record<string, unknown>;
      const usage = payload.usage && typeof payload.usage === 'object'
        ? payload.usage as Record<string, unknown>
        : {};

      return {
        responseId: typeof payload.id === 'string' ? payload.id : undefined,
        assistant: {
          role: 'assistant',
          parts: extractAssistantParts(payload),
        },
        usage: {
          inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
          outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
        },
        raw: payload,
      };
    };

    return sendRequest(Boolean(input.previousResponseId && incrementalInput));
  }
}
