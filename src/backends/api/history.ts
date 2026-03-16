import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { ApiConversationMessage } from './types.js';

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

function formatToolResult(entry: Record<string, unknown>): string {
  const toolName = typeof entry.toolName === 'string' ? entry.toolName : 'tool';
  const text = typeof entry.text === 'string' ? entry.text : '';
  return `[tool_result:${toolName}]\n${text}`.trim();
}

export async function loadTranscriptMessages(
  filePath: string | undefined,
): Promise<ApiConversationMessage[]> {
  if (!filePath || !existsSync(filePath)) {
    return [];
  }

  const messages: ApiConversationMessage[] = [];
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
          const content = typeof entry.message === 'object' && entry.message
            ? (entry.message as Record<string, unknown>).content
            : undefined;
          const text = extractUserText(content);
          if (text) {
            messages.push({ role: 'user', parts: [{ type: 'text', text }] });
          }
          continue;
        }

        if (entry.type === 'assistant') {
          const content = typeof entry.message === 'object' && entry.message
            ? (entry.message as Record<string, unknown>).content
            : undefined;
          const text = extractAssistantText(content);
          if (text) {
            messages.push({ role: 'assistant', parts: [{ type: 'text', text }] });
          }
          continue;
        }

        if (entry.type === 'tool_result') {
          const text = formatToolResult(entry);
          if (text) {
            messages.push({ role: 'user', parts: [{ type: 'text', text }] });
          }
        }
      } catch {
        // Ignore malformed transcript lines.
      }
    }
  } finally {
    reader.close();
  }

  return messages;
}
