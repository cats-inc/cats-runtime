import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import os from 'node:os';
import { join } from 'node:path';
import type { DiscoveredSession } from '../discovery/types.js';

const DEFAULT_JUNIE_SESSIONS_DIR = join(os.homedir(), '.junie', 'sessions');

/**
 * Scan Junie CLI sessions stored under ~/.junie/sessions/.
 *
 * Index file: ~/.junie/sessions/index.jsonl
 *   Each line: { sessionId, createdAt, updatedAt, projectDir, taskName }
 *
 * Session data: ~/.junie/sessions/<sessionId>/events.jsonl
 */
export class JunieSessionScanner {
  private sessionsDir: string;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir || DEFAULT_JUNIE_SESSIONS_DIR;
  }

  async scan(): Promise<DiscoveredSession[]> {
    const indexPath = join(this.sessionsDir, 'index.jsonl');
    const discovered: DiscoveredSession[] = [];

    try {
      const indexStat = await stat(indexPath);
      if (!indexStat.isFile() || indexStat.size === 0) return discovered;
    } catch {
      return discovered;
    }

    try {
      const rl = createInterface({
        input: createReadStream(indexPath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (!entry.sessionId || !entry.projectDir) continue;

          const sessionDir = join(this.sessionsDir, entry.sessionId);
          const eventsPath = join(sessionDir, 'events.jsonl');

          // Count messages from events file
          let messageCount = 0;
          try {
            const eventsStat = await stat(eventsPath);
            if (eventsStat.isFile() && eventsStat.size > 0) {
              messageCount = await countEvents(eventsPath);
            }
          } catch {
            // events file may not exist
          }

          discovered.push({
            providerSessionId: entry.sessionId,
            projectPath: sessionDir,
            sourcePath: eventsPath,
            cwd: entry.projectDir,
            summary: entry.taskName,
            messageCount,
            lastActivity: entry.updatedAt
              ? new Date(entry.updatedAt).toISOString()
              : undefined,
          });
        } catch {
          continue;
        }
      }
    } catch {
      return discovered;
    }

    return discovered;
  }
}

async function countEvents(path: string): Promise<number> {
  let count = 0;
  try {
    const rl = createInterface({
      input: createReadStream(path, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (line.trim()) count++;
    }
  } catch {
    // ignore
  }
  return count;
}
