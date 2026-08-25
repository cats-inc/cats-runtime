import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiscoveredSession } from './types.js';

/**
 * Scan Cline CLI sessions stored under ~/.cline/data/sessions/<id>/
 *
 * Each session directory holds two files named after the session id:
 *   - <id>.json           → run metadata (cwd, model, status, timestamps, title)
 *   - <id>.messages.json  → { messages: [...] }
 *
 * Cline cannot resume a session through the CLI — `--id` alongside `--json`
 * fails and the stream never emits a resumable id — so these records are the
 * only way a host learns that a Cline run happened at all.
 */
export class ClineSessionScanner {
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  async scan(): Promise<DiscoveredSession[]> {
    const discovered: DiscoveredSession[] = [];

    for (const entry of await safeReaddir(this.sessionsDir)) {
      const sessionDir = join(this.sessionsDir, entry);
      if (!(await isDirectory(sessionDir))) {
        continue;
      }

      const metaPath = join(sessionDir, `${entry}.json`);
      const meta = await readJsonFile(metaPath);
      if (!meta) {
        continue;
      }

      // The directory name is the session id, but the file is authoritative:
      // a half-written directory should not register a session that has none.
      const providerSessionId = readString(meta.session_id);
      if (!providerSessionId) {
        continue;
      }

      const metadata = asRecord(meta.metadata);
      const cwd = readString(meta.cwd) || readString(meta.workspace_root) || '';
      const messagesPath = join(sessionDir, `${entry}.messages.json`);
      const messages = await readJsonFile(messagesPath);
      discovered.push({
        providerSessionId,
        projectPath: sessionDir,
        sourcePath: messages ? messagesPath : metaPath,
        cwd,
        summary: readString(metadata?.title) || readString(meta.prompt),
        messageCount: Array.isArray(messages?.messages) ? messages.messages.length : undefined,
        lastActivity: readString(meta.ended_at) || readString(meta.started_at),
        model: readString(meta.model),
      });
    }

    return discovered;
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return asRecord(parsed);
  } catch {
    // A session being written right now is normal during a watch, not an error.
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
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
