import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { DiscoveredSession } from './types.js';

/**
 * Scan Pi CLI sessions stored under ~/.pi/agent/sessions/<cwd-slug>/<timestamp>_<uuid>.jsonl
 *
 * Session file format (NDJSON):
 *   - type: "session"       → { id, cwd, timestamp }
 *   - type: "message"       → { message: { role, content, timestamp } }
 *   - type: "model_change"  → { provider, modelId }
 */
export class PiSessionScanner {
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  async scan(): Promise<DiscoveredSession[]> {
    const discovered: DiscoveredSession[] = [];

    // Walk <cwd-slug> directories
    const cwdDirs = await safeReaddir(this.sessionsDir);
    for (const dir of cwdDirs) {
      const cwdPath = join(this.sessionsDir, dir);
      if (!(await isDirectory(cwdPath))) continue;

      const decodedCwd = decodePiCwdSlug(dir);

      const files = await safeReaddir(cwdPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const filePath = join(cwdPath, file);

        // Skip empty files
        try {
          const fileStat = await stat(filePath);
          if (fileStat.size === 0) continue;
        } catch {
          continue;
        }

        const meta = await this.parseSessionFile(filePath, decodedCwd);
        if (!meta.sessionId) continue;

        discovered.push({
          providerSessionId: meta.sessionId,
          projectPath: cwdPath,
          sourcePath: filePath,
          cwd: meta.cwd || decodedCwd,
          summary: meta.summary,
          messageCount: meta.messageCount,
          lastActivity: meta.lastTimestamp,
          model: meta.model,
        });
      }
    }

    return discovered;
  }

  private async parseSessionFile(path: string, fallbackCwd: string): Promise<{
    sessionId?: string;
    cwd?: string;
    summary?: string;
    messageCount: number;
    lastTimestamp?: string;
    model?: string;
  }> {
    let sessionId: string | undefined;
    let cwd: string | undefined;
    let summary: string | undefined;
    let messageCount = 0;
    let lastTimestamp: string | undefined;
    let model: string | undefined;

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

          if (obj.type === 'session') {
            sessionId = obj.id;
            cwd = obj.cwd;
            continue;
          }

          if (obj.type === 'model_change') {
            const provider = obj.provider || '';
            const modelId = obj.modelId || '';
            if (provider && modelId) {
              model = `${provider}/${modelId}`;
            }
            continue;
          }

          if (obj.type === 'message') {
            const role = obj.message?.role;
            if (role === 'user') {
              messageCount++;
              if (!summary) {
                const content = obj.message?.content;
                if (typeof content === 'string') {
                  summary = content.slice(0, 100);
                } else if (Array.isArray(content)) {
                  const textBlock = content.find(
                    (c: { type?: string; text?: string }) => c.type === 'text' && c.text,
                  );
                  if (textBlock?.text) {
                    summary = textBlock.text.slice(0, 100);
                  }
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

    return { sessionId, cwd, summary, messageCount, lastTimestamp, model };
  }
}

/**
 * Decode a Pi cwd slug back to the original path.
 * Pi encodes paths like "/home/user/project" as "--home-user-project--"
 * (double-dash bookends, single-dash separators).
 */
function decodePiCwdSlug(slug: string): string {
  // Strip leading/trailing "--" bookends
  let decoded = slug.replace(/^--/, '').replace(/--$/, '');
  // Replace remaining single dashes with path separators
  decoded = decoded.replace(/-/g, '/');
  return '/' + decoded;
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
