import type { StreamEvent } from '../../../core/types.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';

/** Parsed fields from a single Pi JSONL line. */
export interface PiMessagePart {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface PiStreamEvent {
  type: string;
  id?: string;
  stopReason?: string;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
  message?: {
    role?: string;
    content?: string | PiMessagePart[];
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cost?: { total?: number };
    };
    stopReason?: string;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  messages?: Array<{
    role?: string;
    content?: string | PiMessagePart[];
  }>;
  toolResults?: Array<{
    toolCallId?: string;
    content?: unknown;
    isError?: boolean;
  }>;
}

function extractTextContent(
  content: string | PiMessagePart[] | undefined,
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join('');
}

function extractThinkingContent(
  content: string | PiMessagePart[] | undefined,
): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((part) => part.type === 'thinking' && typeof part.thinking === 'string')
    .map((part) => part.thinking!.trim())
    .filter(Boolean);
}

function extractUsage(message: PiStreamEvent['message']): StreamEvent['usage'] | undefined {
  const usage = message?.usage;
  if (!usage) return undefined;
  return {
    inputTokens: (usage.input ?? 0) + (usage.cacheRead ?? 0),
    outputTokens: usage.output ?? 0,
  };
}

function buildPiUsageMetadata(
  message: PiStreamEvent['message'],
): Record<string, unknown> | undefined {
  const usage = message?.usage;
  if (!usage) {
    return undefined;
  }

  const totalTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.output ?? 0);
  const estimatedCost = usage.cost?.total;
  if (totalTokens <= 0 && (estimatedCost ?? 0) <= 0) {
    return undefined;
  }

  return {
    runtimeUsage: {
      totalTokens,
      ...(estimatedCost !== undefined ? { estimatedCost } : {}),
      ...(estimatedCost !== undefined ? { currency: 'USD' } : {}),
      sourceConfidence: 'reported',
    },
  };
}

function parseCurrentMessageEvent(event: PiStreamEvent): StreamEvent | StreamEvent[] | null {
  const message = event.message;
  if (!message) return null;

  if (message.role === 'user') {
    return null;
  }

  if (message.role === 'toolResult') {
    const text = extractTextContent(message.content);
    return {
      type: 'tool_result',
      toolId: message.toolCallId,
      toolName: message.toolName,
      text,
      isError: message.isError ?? false,
    };
  }

  if (message.role !== 'assistant') {
    return null;
  }

  const events: StreamEvent[] = [];
  const parts = Array.isArray(message.content) ? message.content : [];
  for (const thought of extractThinkingContent(message.content)) {
    events.push(createRuntimeProgressEvent({
      text: thought,
      provider: 'pi',
      backend: 'cli',
      kind: 'reasoning',
      status: 'running',
      source: 'provider',
      native: {
        sourceEvent: event.type,
      },
    }));
  }
  let hasToolCall = false;
  for (const part of parts) {
    if (part.type === 'toolCall') {
      hasToolCall = true;
      events.push({
        type: 'tool_use',
        toolId: part.id,
        toolName: part.name ?? 'unknown',
        toolArgs: part.arguments,
      });
    }
  }

  const text = extractTextContent(message.content);
  if (text) {
    events.push({ type: 'text', text });
  }

  const usage = extractUsage(message);
  if (usage && event.stopReason !== 'toolUse' && (text || !hasToolCall)) {
    events.push({
      type: 'result',
      usage,
      metadata: buildPiUsageMetadata(message),
    });
  }

  if (events.length === 0) {
    return null;
  }
  return events.length === 1 ? events[0] : events;
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
export function parsePiStreamLine(line: string): StreamEvent | StreamEvent[] | null {
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

  // Current Pi session/message log format
  if (eventType === 'message') {
    return parseCurrentMessageEvent(event);
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
    if (msg.stopReason === 'toolUse') return null;

    const usage = msg.usage;
    return {
      type: 'result',
      usage: usage ? extractUsage(msg) : undefined,
      metadata: buildPiUsageMetadata(msg),
    };
  }

  if (eventType === 'message_start' || eventType === 'message_end') {
    return null;
  }

  // Streaming text deltas
  if (eventType === 'message_update') {
    const assistantEvent = event.assistantMessageEvent;
    if (assistantEvent?.type === 'text_delta' && assistantEvent.delta) {
      return { type: 'text', text: assistantEvent.delta };
    }
    if (assistantEvent?.type === 'thinking' && assistantEvent.delta) {
      return createRuntimeProgressEvent({
        text: assistantEvent.delta,
        provider: 'pi',
        backend: 'cli',
        kind: 'reasoning',
        status: 'running',
        source: 'provider',
        native: {
          sourceEvent: eventType,
        },
      });
    }
    return null;
  }

  // Tool execution
  if (eventType === 'tool_execution_start') {
    return [
      createRuntimeProgressEvent({
        text: `Running tool: ${event.toolName ?? 'unknown'}`,
        provider: 'pi',
        backend: 'cli',
        kind: 'tool',
        status: 'running',
        source: 'provider',
        native: {
          sourceEvent: eventType,
          toolName: event.toolName,
        },
      }),
      {
        type: 'tool_use',
        toolName: event.toolName ?? 'unknown',
        toolId: event.toolCallId,
      },
    ];
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

  if (eventType === 'tool_execution_update') {
    return null;
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
