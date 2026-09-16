import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { DiscoveredSession } from './types.js';
import type { NativeFileHistoryMessage } from './NativeFileHistory.js';

interface MuseTranscript {
  providerSessionId?: string;
  cwd: string;
  model?: string;
  summary?: string;
  lastActivity?: string;
  messageCount: number;
  messages: NativeFileHistoryMessage[];
}

/** Muse's durable log differs from its exec stdout: runs are nested events. */
export async function readMuseTranscript(
  filePath: string,
  includeHistory = false,
): Promise<MuseTranscript> {
  const result: MuseTranscript = { cwd: '', messageCount: 0, messages: [] };
  const seen = new Set<string>();
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      for (const record of parseRecords(line)) {
        const stream = asRecord(record.stream);
        const sessionId = readString(stream?.id);
        if (stream?.kind !== 'session' || !sessionId) continue;
        if (result.providerSessionId && result.providerSessionId !== sessionId) continue;
        result.providerSessionId = sessionId;
        const id = readString(record.id);
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        const timestamp = readTimestamp(record.recorded_at);
        if (timestamp && (!result.lastActivity || timestamp > result.lastActivity)) {
          result.lastActivity = timestamp;
        }

        const payload = asRecord(record.payload);
        const metadata = asRecord(payload?.record);
        if (record.payload_type === 'runtime.session.metadata') {
          result.cwd = readString(metadata?.workspace_root) || result.cwd;
          result.model = readString(metadata?.model_id) || result.model;
        } else if (record.payload_type === 'runtime.session.route_facts') {
          result.cwd = readString(metadata?.cwd) || result.cwd;
        } else if (record.payload_type === 'run.model.configured') {
          result.model = readString(metadata?.model_id) || result.model;
        }

        if (record.payload_type !== 'runtime.session' || payload?.kind !== 'run') continue;
        const event = asRecord(payload.event);
        const role = event?.kind === 'started' ? 'user'
          : event?.kind === 'assistant_message_committed' ? 'assistant' : undefined;
        const text = readString(role === 'user' ? event?.prompt : event?.text);
        if (!role || !text) continue;
        result.messageCount += 1;
        if (role === 'user' && !result.summary) result.summary = text.slice(0, 160);
        if (includeHistory) {
          result.messages.push({ role, text, ...(timestamp ? { timestamp } : {}) });
        }
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return result;
}

/** Scan only the provider-owned yyyy/mm/dd/session-id/session.jsonl layout. */
export class MuseSessionScanner {
  constructor(private readonly sessionsDir: string) {}

  async scan(): Promise<DiscoveredSession[]> {
    const discovered: DiscoveredSession[] = [];
    for (const year of await directories(this.sessionsDir, /^\d{4}$/)) {
      for (const month of await directories(year, /^\d{2}$/)) {
        for (const day of await directories(month, /^\d{2}$/)) {
          for (const sessionDir of await directories(day, /^[a-zA-Z0-9-]+$/)) {
            const sourcePath = join(sessionDir, 'session.jsonl');
            try {
              const transcript = await readMuseTranscript(sourcePath);
              if (!transcript.providerSessionId) continue;
              discovered.push({
                providerSessionId: transcript.providerSessionId,
                projectPath: sessionDir,
                sourcePath,
                cwd: transcript.cwd,
                model: transcript.model,
                summary: transcript.summary,
                messageCount: transcript.messageCount,
                lastActivity: transcript.lastActivity,
              });
            } catch (error) {
              if (!isMissingPathError(error)) throw error;
            }
          }
        }
      }
    }
    return discovered;
  }
}

function parseRecords(line: string): Record<string, unknown>[] {
  let record: Record<string, unknown> | undefined;
  try {
    record = asRecord(JSON.parse(line) as unknown);
  } catch {
    // The CLI can still be writing the last line during a background scan.
    return [];
  }
  if (!record) return [];
  if (!Array.isArray(record.children)) return [record];
  return record.children.flatMap((child) => {
    const raw = asRecord(child)?.record_json;
    if (typeof raw !== 'string') return [];
    try {
      const value = asRecord(JSON.parse(raw) as unknown);
      return value ? [value] : [];
    } catch {
      return [];
    }
  });
}

async function directories(parent: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await readdir(parent, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => join(parent, entry.name));
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readTimestamp(value: unknown): string | undefined {
  // Muse's durable recorded_at is Unix time in microseconds.
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const date = new Date(value / 1000);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}
