import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { DiscoveredSession } from './types.js';

/**
 * Scan Codex CLI sessions stored under ~/.codex/sessions/YYYY/MM/DD/*.jsonl
 *
 * Session file format (NDJSON):
 *   - type: "session_meta"  → payload.{ id, cwd, model_provider }
 *   - type: "event_msg"     → payload.type: "user_message" | "agent_message" | ...
 *   - type: "response_item" → payload.role: "user" | "assistant" | ...
 *
 * Session ID is the UUID from session_meta.payload.id (also embedded in filename).
 */
export class CodexSessionScanner {
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  async scan(): Promise<DiscoveredSession[]> {
    const discovered: DiscoveredSession[] = [];

    // Walk YYYY/MM/DD directory structure
    const yearDirs = await safeReaddir(this.sessionsDir);
    for (const year of yearDirs) {
      const yearPath = join(this.sessionsDir, year);
      if (!(await isDirectory(yearPath))) continue;

      const monthDirs = await safeReaddir(yearPath);
      for (const month of monthDirs) {
        const monthPath = join(yearPath, month);
        if (!(await isDirectory(monthPath))) continue;

        const dayDirs = await safeReaddir(monthPath);
        for (const day of dayDirs) {
          const dayPath = join(monthPath, day);
          if (!(await isDirectory(dayPath))) continue;

          const files = await safeReaddir(dayPath);
          for (const file of files) {
            if (!file.endsWith('.jsonl')) continue;

            const filePath = join(dayPath, file);

            // Skip empty files
            try {
              const fileStat = await stat(filePath);
              if (fileStat.size === 0) continue;
            } catch {
              continue;
            }

            const meta = await this.parseSessionFile(filePath);
            if (!meta.sessionId) continue;

            discovered.push({
              providerSessionId: meta.sessionId,
              projectPath: dayPath,
              sourcePath: filePath,
              cwd: meta.cwd || '',
              summary: meta.summary,
              messageCount: meta.messageCount,
              lastActivity: meta.lastTimestamp,
            });
          }
        }
      }
    }

    return discovered;
  }

  private async parseSessionFile(path: string): Promise<{
    sessionId?: string;
    cwd?: string;
    summary?: string;
    messageCount: number;
    lastTimestamp?: string;
  }> {
    let sessionId: string | undefined;
    let cwd: string | undefined;
    let summary: string | undefined;
    let messageCount = 0;
    let lastTimestamp: string | undefined;
    let hasEventMsgUser = false;

    try {
      const rl = createInterface({
        input: createReadStream(path, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);

          if (obj.timestamp) lastTimestamp = obj.timestamp;

          if (obj.type === 'session_meta') {
            sessionId = obj.payload?.id;
            cwd = obj.payload?.cwd;
            continue;
          }

          if (obj.type === 'event_msg') {
            const payloadType = obj.payload?.type;
            if (payloadType === 'user_message') {
              hasEventMsgUser = true;
              messageCount++;
              if (typeof obj.payload?.message === 'string') {
                summary = obj.payload.message.slice(0, 100);
              }
            } else if (payloadType === 'agent_message') {
              messageCount++;
            }
            continue;
          }

          if (obj.type === 'response_item') {
            const role = obj.payload?.role;
            if (role === 'user') {
              // Count only if no event_msg.user_message was seen (avoids double-counting)
              if (!hasEventMsgUser) messageCount++;
              if (!summary) {
                const content = obj.payload?.content;
                if (Array.isArray(content) && content[0]?.text) {
                  summary = content[0].text.slice(0, 100);
                }
              }
            } else if (role === 'assistant') {
              messageCount++;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      return { messageCount: 0 };
    }

    return { sessionId, cwd, summary, messageCount, lastTimestamp };
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
