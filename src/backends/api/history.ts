import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type {
  ApiConversationMessage,
  ApiConversationPart,
  ApiToolCallPart,
  ApiToolResultPart,
} from './types.js';

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((part): part is { type?: string; text?: string } =>
      Boolean(part) && typeof part === 'object',
    )
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text || '')
    .join('\n');
}

function extractUserText(content: unknown): string {
  return typeof content === 'string' ? content : '';
}

function parseToolCall(entry: Record<string, unknown>): ApiToolCallPart | undefined {
  const toolId = typeof entry.toolId === 'string' ? entry.toolId : undefined;
  const toolName = typeof entry.toolName === 'string' ? entry.toolName : undefined;
  const args = entry.arguments && typeof entry.arguments === 'object'
    ? entry.arguments as Record<string, unknown>
    : {};

  if (!toolId || !toolName) {
    return undefined;
  }

  return {
    type: 'tool_call',
    id: toolId,
    name: toolName,
    arguments: args,
  };
}

function parseToolResult(entry: Record<string, unknown>): ApiToolResultPart | undefined {
  const toolName = typeof entry.toolName === 'string' ? entry.toolName : undefined;
  const toolId = typeof entry.toolId === 'string' ? entry.toolId : undefined;
  const text = typeof entry.text === 'string' ? entry.text : '';

  if (!toolName || !toolId) {
    return undefined;
  }

  return {
    type: 'tool_result',
    toolCallId: toolId,
    name: toolName,
    output: text,
    isError: entry.isError === true,
  };
}

function flushMessage(
  messages: ApiConversationMessage[],
  role: 'assistant' | 'user',
  parts: ApiConversationPart[],
): ApiConversationPart[] {
  if (parts.length > 0) {
    messages.push({
      role,
      parts: [...parts],
    });
  }
  return [];
}

export async function loadTranscriptMessages(
  filePath: string | undefined,
): Promise<ApiConversationMessage[]> {
  if (!filePath || !existsSync(filePath)) {
    return [];
  }

  const messages: ApiConversationMessage[] = [];
  let pendingAssistantParts: ApiConversationPart[] = [];
  let pendingToolResults: ApiConversationPart[] = [];
  const reader = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of reader) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line) as Record<string, unknown>;

        if (entry.type === 'user') {
          pendingAssistantParts = flushMessage(messages, 'assistant', pendingAssistantParts);
          pendingToolResults = flushMessage(messages, 'user', pendingToolResults);

          const content = typeof entry.message === 'object' && entry.message
            ? (entry.message as Record<string, unknown>).content
            : undefined;
          const text = extractUserText(content);
          if (text) {
            messages.push({ role: 'user', parts: [{ type: 'text', text }] });
          }
          continue;
        }

        if (entry.type === 'compaction_summary') {
          pendingAssistantParts = flushMessage(messages, 'assistant', pendingAssistantParts);
          pendingToolResults = flushMessage(messages, 'user', pendingToolResults);
          const text = typeof entry.text === 'string' ? entry.text.trim() : '';
          if (text) {
            messages.push({ role: 'system', parts: [{ type: 'text', text }] });
          }
          continue;
        }

        if (entry.type === 'assistant') {
          pendingToolResults = flushMessage(messages, 'user', pendingToolResults);

          const content = typeof entry.message === 'object' && entry.message
            ? (entry.message as Record<string, unknown>).content
            : undefined;
          const text = extractAssistantText(content);
          if (!text) {
            continue;
          }

          const hasToolCall = pendingAssistantParts.some((part) => part.type === 'tool_call');
          if (hasToolCall) {
            pendingAssistantParts = flushMessage(messages, 'assistant', pendingAssistantParts);
          }

          pendingAssistantParts.push({ type: 'text', text });
          continue;
        }

        if (entry.type === 'tool_use') {
          pendingToolResults = flushMessage(messages, 'user', pendingToolResults);

          const toolCall = parseToolCall(entry);
          if (toolCall) {
            pendingAssistantParts.push(toolCall);
          }
          continue;
        }

        if (entry.type === 'tool_result') {
          pendingAssistantParts = flushMessage(messages, 'assistant', pendingAssistantParts);

          const toolResult = parseToolResult(entry);
          if (toolResult) {
            pendingToolResults.push(toolResult);
          }
        }
      } catch {
        // Ignore malformed transcript lines.
      }
    }
  } finally {
    reader.close();
  }

  flushMessage(messages, 'assistant', pendingAssistantParts);
  flushMessage(messages, 'user', pendingToolResults);
  return messages;
}
