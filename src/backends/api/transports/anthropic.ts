import type { RemoteProviderInstanceConfig } from '../../cli/config.js';
import type {
  ApiCompletionInput,
  ApiCompletionResponse,
  ApiConversationMessage,
  ApiConversationPart,
  ApiToolCallPart,
  ApiTransportClient,
} from '../types.js';
import { readErrorBody } from '../../../core/streamParsers.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const PROMPT_CACHE_CONTROL = { type: 'ephemeral' } as const;

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  cache_control?: typeof PROMPT_CACHE_CONTROL;
}

interface AnthropicMessagePayload {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

interface AnthropicToolPayload {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: typeof PROMPT_CACHE_CONTROL;
}

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

function extractSystemBlocks(messages: ApiConversationMessage[]): AnthropicContentBlock[] {
  return messages
    .filter((message) => message.role === 'system')
    .flatMap((message) => message.parts)
    .filter((part): part is Extract<ApiConversationPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .filter(Boolean)
    .map((text) => ({ type: 'text', text }));
}

function toAnthropicMessage(message: ApiConversationMessage): AnthropicMessagePayload | null {
  if (message.role === 'system') {
    return null;
  }

  const content = message.parts.flatMap<AnthropicContentBlock>((part) => {
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

function toAnthropicTools(input: ApiCompletionInput): AnthropicToolPayload[] {
  return input.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function applyPromptCacheBreakpoint(
  system: AnthropicContentBlock[],
  messages: AnthropicMessagePayload[],
  tools: AnthropicToolPayload[],
): void {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const blocks = messages[index]?.content;
    if (blocks && blocks.length > 0) {
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        cache_control: PROMPT_CACHE_CONTROL,
      };
      return;
    }
  }

  if (system.length > 0) {
    system[system.length - 1] = {
      ...system[system.length - 1],
      cache_control: PROMPT_CACHE_CONTROL,
    };
    return;
  }

  if (tools.length > 0) {
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control: PROMPT_CACHE_CONTROL,
    };
  }
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
    const system = extractSystemBlocks(input.messages);
    const messages = input.messages
      .map(toAnthropicMessage)
      .filter((message): message is AnthropicMessagePayload => Boolean(message));
    const tools = input.tools.length > 0 ? toAnthropicTools(input) : [];
    applyPromptCacheBreakpoint(system, messages, tools);

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
        max_tokens: input.instance.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        system: system.length > 0 ? system : undefined,
        messages,
        tools: tools.length > 0 ? tools : undefined,
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
