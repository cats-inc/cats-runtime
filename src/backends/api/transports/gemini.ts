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
    throw new Error(`Gemini instance '${instance.providerName}/${instance.id}' is missing api_key_env`);
  }

  const apiKey = env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Gemini API key env '${apiKeyEnv}' is not set`);
  }

  return apiKey;
}

function resolveBaseUrl(instance: RemoteProviderInstanceConfig, env: NodeJS.ProcessEnv): string {
  const fromEnv = instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined;
  return fromEnv || instance.baseUrl || 'https://generativelanguage.googleapis.com';
}

function toGeminiContents(messages: ApiConversationMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : message.role,
    parts: message.parts.flatMap<Record<string, unknown>>((part) => {
      if (part.type === 'text') {
        return [{ text: part.text }];
      }
      if (part.type === 'tool_call' && message.role === 'assistant') {
        const raw = part.raw && typeof part.raw === 'object'
          ? part.raw as Record<string, unknown>
          : {};
        return [{
          functionCall: {
            ...raw,
            name: part.name,
            args: part.arguments,
          },
        }];
      }
      if (part.type === 'tool_result' && message.role === 'user') {
        return [{
          functionResponse: {
            name: part.name,
            response: {
              output: part.output,
              is_error: part.isError === true,
            },
          },
        }];
      }
      return [];
    }),
  }));
}

function toGeminiTools(input: ApiCompletionInput): Array<Record<string, unknown>> {
  if (input.tools.length === 0) {
    return [];
  }

  return [{
    functionDeclarations: input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
  }];
}

function extractAssistantParts(payload: Record<string, unknown>): ApiConversationPart[] {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidate = candidates[0] && typeof candidates[0] === 'object'
    ? candidates[0] as Record<string, unknown>
    : {};
  const content = candidate.content && typeof candidate.content === 'object'
    ? candidate.content as Record<string, unknown>
    : {};
  const parts = Array.isArray(content.parts) ? content.parts : [];

  const extracted: ApiConversationPart[] = [];
  for (const item of parts) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const part = item as Record<string, unknown>;
    if (typeof part.text === 'string' && part.text) {
      extracted.push({ type: 'text', text: part.text });
      continue;
    }

    const functionCall = part.functionCall && typeof part.functionCall === 'object'
      ? part.functionCall as Record<string, unknown>
      : {};
    if (typeof functionCall.name === 'string') {
      extracted.push({
        type: 'tool_call',
        id: typeof functionCall.id === 'string'
          ? functionCall.id
          : `gemini-${functionCall.name}-${extracted.length + 1}`,
        name: functionCall.name,
        arguments: functionCall.args && typeof functionCall.args === 'object'
          ? functionCall.args as Record<string, unknown>
          : {},
        raw: functionCall,
      } satisfies ApiToolCallPart);
    }
  }

  return extracted;
}

export class GeminiTransport implements ApiTransportClient {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  async completeTurn(input: ApiCompletionInput): Promise<ApiCompletionResponse> {
    const apiKey = requireApiKey(input.instance, this.env);
    const baseUrl = resolveBaseUrl(input.instance, this.env);
    const endpoint = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${
      encodeURIComponent(input.model)
    }:generateContent`;

    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
        ...input.instance.headers,
      },
      body: JSON.stringify({
        contents: toGeminiContents(input.messages),
        tools: toGeminiTools(input),
        generationConfig: {
          maxOutputTokens: input.instance.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        },
      }),
      signal: input.signal,
    });

    if (!response.ok) {
      throw new Error(`Gemini request failed: ${await readErrorBody(response)}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    const usage = payload.usageMetadata && typeof payload.usageMetadata === 'object'
      ? payload.usageMetadata as Record<string, unknown>
      : {};

    return {
      assistant: {
        role: 'assistant',
        parts: extractAssistantParts(payload),
      },
      usage: {
        inputTokens: typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : 0,
        outputTokens: typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : 0,
      },
      raw: payload,
    };
  }
}
