import type { StreamEvent } from '../../../core/types.js';

/** Parsed fields from a single Pi JSONL line. */
export interface PiStreamEvent {
  type: string;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cost?: { total?: number };
    };
  };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  messages?: Array<{
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  }>;
  toolResults?: Array<{
    toolCallId?: string;
    content?: unknown;
    isError?: boolean;
  }>;
}

function extractTextContent(
  content: string | Array<{ type: string; text?: string }> | undefined,
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join('');
}

/**
 * Parse a single JSONL line from Pi's RPC stdout into a cats-runtime StreamEvent.
 *
 * Pi event types:
 *  - agent_start / agent_end — lifecycle
 *  - turn_start / turn_end   — turn boundaries (turn_end carries usage)
 *  - message_update           — streaming text deltas
 *  - tool_execution_start/end — tool calls
 *  - response, extension_*    — internal RPC; skip
 */
export function parsePiStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let event: PiStreamEvent;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return { type: 'raw', text: trimmed };
  }

  const eventType = event.type ?? '';

  // Skip internal RPC protocol messages
  if (
    eventType === 'response'
    || eventType === 'extension_ui_request'
    || eventType === 'extension_ui_response'
    || eventType === 'extension_error'
  ) {
    return null;
  }

  // Agent lifecycle — agent_end may carry final messages
  if (eventType === 'agent_start') return null;

  if (eventType === 'agent_end') {
    const messages = event.messages;
    if (messages && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        const text = extractTextContent(last.content);
        if (text) return { type: 'text', text };
      }
    }
    return null;
  }

  // Turn lifecycle
  if (eventType === 'turn_start') return null;

  if (eventType === 'turn_end') {
    const msg = event.message;
    if (!msg) return { type: 'result' };

    const usage = msg.usage;
    return {
      type: 'result',
      usage: usage ? {
        inputTokens: (usage.input ?? 0) + (usage.cacheRead ?? 0),
        outputTokens: usage.output ?? 0,
      } : undefined,
    };
  }

  // Streaming text deltas
  if (eventType === 'message_update') {
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent?.type === 'text_delta' && assistantEvent.delta) {
      return { type: 'text', text: assistantEvent.delta };
    }
    return null;
  }

  // Tool execution
  if (eventType === 'tool_execution_start') {
    return {
      type: 'tool_use',
      toolName: event.toolName ?? 'unknown',
      toolId: event.toolCallId,
    };
  }

  if (eventType === 'tool_execution_end') {
    const resultText = typeof event.result === 'string'
      ? event.result
      : JSON.stringify(event.result ?? '');
    return {
      type: 'tool_result',
      toolId: event.toolCallId,
      text: resultText,
      isError: event.isError ?? false,
    };
  }

  // Unknown — pass through as raw
  return { type: 'raw', raw: event };
}

/**
 * Parse a Pi model string in `provider/model` format.
 * Returns [provider, modelId] or throws if format is invalid.
 */
export function parsePiModel(model: string): { provider: string; modelId: string } {
  const trimmed = model.trim();
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx < 1 || slashIdx === trimmed.length - 1) {
    throw new Error(
      `Invalid Pi model format '${model}'. Expected 'provider/model' (e.g. 'xai/grok-4').`,
    );
  }
  return {
    provider: trimmed.slice(0, slashIdx),
    modelId: trimmed.slice(slashIdx + 1),
  };
}
