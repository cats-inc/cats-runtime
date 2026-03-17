import type { StreamEvent } from '../../../core/types.js';

/** Raw Goose stream-json event shape. */
export interface GooseStreamEvent {
  type: string;
  total_tokens?: number;
  message?: {
    id?: string | null;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      toolCall?: {
        status?: string;
        value?: {
          name?: string;
          arguments?: unknown;
        };
      };
      toolResult?: {
        status?: string;
        value?: {
          content?: Array<{ type?: string; text?: string }>;
          isError?: boolean;
        };
      };
    }>;
  };
}

/**
 * Parse a single JSONL line from `goose run --output-format stream-json`.
 *
 * Event types:
 *  - {"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
 *  - {"type":"message","message":{"role":"assistant","content":[{"type":"toolRequest",...}]}}
 *  - {"type":"message","message":{"role":"user","content":[{"type":"toolResponse",...}]}}
 *  - {"type":"complete","total_tokens":N}
 */
export function parseGooseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let event: GooseStreamEvent;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return { type: 'raw', text: trimmed };
  }

  if (event.type === 'complete') {
    return {
      type: 'result',
      usage: event.total_tokens != null
        ? { inputTokens: 0, outputTokens: event.total_tokens }
        : undefined,
    };
  }

  if (event.type === 'message' && event.message) {
    const { role, content } = event.message;
    if (!Array.isArray(content) || content.length === 0) return null;

    const block = content[0];

    // Assistant text
    if (role === 'assistant' && block.type === 'text' && block.text != null) {
      return { type: 'text', text: block.text };
    }

    // Tool request
    if (role === 'assistant' && block.type === 'toolRequest') {
      const toolName = block.toolCall?.value?.name ?? 'unknown';
      return { type: 'tool_use', toolName, toolId: block.id };
    }

    // Tool response
    if (role === 'user' && block.type === 'toolResponse') {
      const resultTexts = block.toolResult?.value?.content
        ?.filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!) ?? [];
      return {
        type: 'tool_result',
        toolId: block.id,
        text: resultTexts.join(''),
        isError: block.toolResult?.value?.isError ?? false,
      };
    }

    return null;
  }

  return { type: 'raw', raw: event };
}

/**
 * Parse a Goose model string in `provider/model` format.
 */
export function parseGooseModel(model: string): { provider: string; modelId: string } {
  const trimmed = model.trim();
  const aliased = normalizeGooseModelAlias(trimmed);
  const slashIdx = aliased.indexOf('/');
  if (slashIdx < 1 || slashIdx === aliased.length - 1) {
    throw new Error(
      `Invalid Goose model format '${model}'. Expected 'provider/model' (e.g. 'anthropic/claude-sonnet-4').`,
    );
  }

  const provider = aliased.slice(0, slashIdx).trim();
  const modelId = aliased.slice(slashIdx + 1).trim();
  if (!provider || !modelId) {
    throw new Error(
      `Invalid Goose model format '${model}'. Expected 'provider/model' (e.g. 'anthropic/claude-sonnet-4').`,
    );
  }

  return {
    provider,
    modelId: normalizeGooseProviderModelId(provider, modelId),
  };
}

function normalizeGooseModelAlias(model: string): string {
  const normalized = model
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .trim();

  const aliases: Record<string, string> = {
    'gpt': 'openai/gpt-5',
    'gpt-5': 'openai/gpt-5',
    'gpt-5.1': 'openai/gpt-5',
    'gpt-5.2': 'openai/gpt-5',
    'gpt-5.3': 'openai/gpt-5',
    'gpt-5.4': 'openai/gpt-5',
    'gpt-codex': 'openai/gpt-5-codex',
    'gpt-5-codex': 'openai/gpt-5-codex',
    'gpt-5.1-codex': 'openai/gpt-5-codex',
    'gpt-5.2-codex': 'openai/gpt-5-codex',
    'gpt-5.3-codex': 'openai/gpt-5-codex',
    'gpt-5.4-codex': 'openai/gpt-5-codex',
  };

  return aliases[normalized] ?? model.trim();
}

function normalizeGooseProviderModelId(provider: string, modelId: string): string {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModelId = modelId
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .trim();

  if (normalizedProvider !== 'openai') {
    return modelId;
  }

  const aliases: Record<string, string> = {
    'gpt': 'gpt-5',
    'gpt-5.1': 'gpt-5',
    'gpt-5.2': 'gpt-5',
    'gpt-5.3': 'gpt-5',
    'gpt-5.4': 'gpt-5',
    'gpt-codex': 'gpt-5-codex',
    'gpt-5.1-codex': 'gpt-5-codex',
    'gpt-5.2-codex': 'gpt-5-codex',
    'gpt-5.3-codex': 'gpt-5-codex',
    'gpt-5.4-codex': 'gpt-5-codex',
  };

  return aliases[normalizedModelId] ?? modelId;
}
