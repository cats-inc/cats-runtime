import { createHash } from 'node:crypto';
import type { RemoteProviderInstanceConfig } from '../../cli/config.js';
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
import { applyPayloadTemplate, readPayloadTemplateString } from '../payloadTemplate.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_CACHE_TTL = '3600s';

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

function modelResourceName(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`;
}

function extractSystemInstruction(
  messages: ApiConversationMessage[],
): Record<string, unknown> | undefined {
  const text = messages
    .filter((message) => message.role === 'system')
    .flatMap((message) => message.parts)
    .filter((part): part is Extract<ApiConversationPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n');

  return text
    ? {
        parts: [{ text }],
      }
    : undefined;
}

function toGeminiContents(messages: ApiConversationMessage[]): Array<Record<string, unknown>> {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
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
    }))
    .filter((message) => message.parts.length > 0);
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

function approximateTokenCount(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function minimumCacheTokensForModel(model: string): number {
  const normalized = model.toLowerCase();
  if (normalized.includes('pro')) {
    return 4096;
  }
  return 1024;
}

function cacheKeyForPrefix(
  model: string,
  systemInstruction: Record<string, unknown> | undefined,
  tools: Array<Record<string, unknown>>,
  prefixContents: Array<Record<string, unknown>>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      model,
      systemInstruction,
      tools,
      prefixContents,
    }))
    .digest('hex');
}

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= Date.now();
}

function shouldInvalidateCachedContent(errorBody: string): boolean {
  const normalized = errorBody.toLowerCase();
  return normalized.includes('cachedcontent')
    || normalized.includes('cached content')
    || normalized.includes('not found')
    || normalized.includes('expired');
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
    const trimmedBaseUrl = baseUrl.replace(/\/$/, '');
    const endpoint = `${trimmedBaseUrl}/v1beta/models/${
      encodeURIComponent(input.model)
    }:generateContent`;
    const systemInstruction = extractSystemInstruction(input.messages);
    const contents = toGeminiContents(input.messages);
    const tools = toGeminiTools(input);
    let nextSessionState = input.sessionState;
    const progress: ApiProgressEvent[] = [];

    const generationConfig = {
      maxOutputTokens: input.instance.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    };

    const sendGenerate = async (body: Record<string, unknown>): Promise<ApiCompletionResponse> => {
      const requestBody = applyPayloadTemplate(body, input.instance.payloadTemplate);
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
          ...input.instance.headers,
        },
        body: JSON.stringify(requestBody),
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
        sessionState: nextSessionState,
        progress: progress.length > 0 ? [...progress] : undefined,
        raw: payload,
      };
    };

    const canUseExplicitCache = (input.turnStep ?? 0) === 0 && contents.length > 1;
    if (canUseExplicitCache) {
      const prefixContents = contents.slice(0, -1);
      const suffixContents = contents.slice(-1);
      const estimatedTokens = approximateTokenCount({
        systemInstruction,
        tools,
        prefixContents,
      });

      if (estimatedTokens >= minimumCacheTokensForModel(input.model)) {
        const prefixKey = cacheKeyForPrefix(input.model, systemInstruction, tools, prefixContents);
        let cachedContentName: string | undefined;
        const existingCache = input.sessionState?.geminiCachedContent;

        if (
          existingCache
          && existingCache.key === prefixKey
          && existingCache.model === input.model
          && !isExpired(existingCache.expiresAt)
        ) {
          cachedContentName = existingCache.name;
          progress.push({
            kind: 'provider_cache',
            status: 'reused',
            message: 'Reused Gemini cached context.',
            metadata: {
              strategy: 'cached_content',
              cachedContent: cachedContentName,
            },
          });
        } else {
          const cacheTtl = readPayloadTemplateString(
            input.instance.payloadTemplate,
            'cachedContentTtl',
            'cached_content_ttl',
            'contextCacheTtl',
            'context_cache_ttl',
          ) || DEFAULT_CACHE_TTL;
          const cacheResponse = await this.fetchImpl(`${trimmedBaseUrl}/v1beta/cachedContents`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-goog-api-key': apiKey,
              ...input.instance.headers,
            },
            body: JSON.stringify({
              model: modelResourceName(input.model),
              systemInstruction,
              contents: prefixContents,
              tools: tools.length > 0 ? tools : undefined,
              ttl: cacheTtl,
            }),
            signal: input.signal,
          });

          if (cacheResponse.ok) {
            const payload = await cacheResponse.json() as Record<string, unknown>;
            if (typeof payload.name === 'string') {
              cachedContentName = payload.name;
              progress.push({
                kind: 'provider_cache',
                status: 'created',
                message: 'Created Gemini cached context for the reusable prompt prefix.',
                metadata: {
                  strategy: 'cached_content',
                  cachedContent: payload.name,
                  ttl: cacheTtl,
                },
              });
              nextSessionState = {
                geminiCachedContent: {
                  name: payload.name,
                  key: prefixKey,
                  model: input.model,
                  prefixMessageCount: prefixContents.length,
                  expiresAt: typeof payload.expireTime === 'string' ? payload.expireTime : undefined,
                },
              };
            }
          } else {
            nextSessionState = {};
          }
        }

        if (cachedContentName) {
          try {
            return await sendGenerate({
              cachedContent: cachedContentName,
              contents: suffixContents,
              generationConfig,
            });
          } catch (error) {
            if (shouldInvalidateCachedContent(String(error))) {
              progress.push({
                kind: 'provider_cache',
                status: 'fallback',
                message: 'Gemini cached context was rejected; retried with full conversation.',
                metadata: {
                  strategy: 'cached_content',
                  cachedContent: cachedContentName,
                },
              });
              nextSessionState = {};
            } else {
              throw error;
            }
          }
        }
      }
    }

    return sendGenerate({
      systemInstruction,
      contents,
      tools: tools.length > 0 ? tools : undefined,
      generationConfig,
    });
  }
}
