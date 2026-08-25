import { readFile } from 'node:fs/promises';

export interface NativeFileHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

export async function loadClineSessionHistory(
  filePath: string,
): Promise<NativeFileHistoryMessage[]> {
  const root = asRecord(JSON.parse(await readFile(filePath, 'utf8')) as unknown);
  if (!root || !Array.isArray(root.messages)) {
    return [];
  }

  const messages: NativeFileHistoryMessage[] = [];
  for (const value of root.messages) {
    const message = asRecord(value);
    const role = readHistoryRole(message?.role);
    const text = readMessageText(message?.content);
    if (!role || !text) {
      continue;
    }

    const timestamp = normalizeTimestamp(message?.ts);
    messages.push({
      role,
      text,
      ...(timestamp ? { timestamp } : {}),
    });
  }

  return messages;
}

export async function loadGrokSessionHistory(
  filePath: string,
): Promise<NativeFileHistoryMessage[]> {
  const messages: NativeFileHistoryMessage[] = [];
  const raw = await readFile(filePath, 'utf8');

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const message = asRecord(JSON.parse(line) as unknown);
      const role = readHistoryRole(message?.type);
      const text = readMessageText(message?.content);
      if (role && text) {
        messages.push({ role, text });
      }
    } catch {
      // Ignore a partially written final line while Grok is still updating it.
    }
  }

  return messages;
}

function readHistoryRole(value: unknown): NativeFileHistoryMessage['role'] | undefined {
  return value === 'user' || value === 'assistant' ? value : undefined;
}

function readMessageText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const text = value
    .map((part) => asRecord(part))
    .filter((part): part is Record<string, unknown> => part?.type === 'text')
    .map((part) => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  return text || undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
  const timestamp = new Date(milliseconds);
  return Number.isNaN(timestamp.valueOf()) ? undefined : timestamp.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
