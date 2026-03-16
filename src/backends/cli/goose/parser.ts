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
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx < 1 || slashIdx === trimmed.length - 1) {
    throw new Error(
      `Invalid Goose model format '${model}'. Expected 'provider/model' (e.g. 'anthropic/claude-sonnet-4').`,
    );
  }
  return {
    provider: trimmed.slice(0, slashIdx),
    modelId: trimmed.slice(slashIdx + 1),
  };
}
