import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiscoveredSession } from './types.js';

/**
 * Scan Grok CLI sessions stored under ~/.grok/sessions/<encoded-cwd>/<session-id>/
 *
 * Grok groups sessions by working directory, URL-encoding the path to name the
 * group. When the encoded name would exceed 255 bytes it falls back to a slug
 * plus hash and records the real path in a `.cwd` file inside the group.
 *
 * Each session directory carries `summary.json` as its index entry: session id,
 * cwd, generated title, timestamps, message counts, and model. The heavier
 * `chat_history.jsonl` / `events.jsonl` logs beside it are not read, because
 * everything a listing surface needs is already in the summary.
 */
export class GrokSessionScanner {
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  async scan(): Promise<DiscoveredSession[]> {
    const discovered: DiscoveredSession[] = [];

    for (const groupName of await safeReaddir(this.sessionsDir)) {
      const groupPath = join(this.sessionsDir, groupName);
      // The group listing also holds session_search.sqlite.
      if (!(await isDirectory(groupPath))) {
        continue;
      }

      let groupCwd: string | undefined;
      for (const entry of await safeReaddir(groupPath)) {
        const sessionDir = join(groupPath, entry);
        if (!(await isDirectory(sessionDir))) {
          continue;
        }

        const summary = await readJsonFile(join(sessionDir, 'summary.json'));
        const info = asRecord(summary?.info);
        const providerSessionId = readString(info?.id);
        if (!providerSessionId) {
          continue;
        }

        if (groupCwd === undefined) {
          groupCwd = await resolveGroupCwd(groupPath, groupName);
        }

        discovered.push({
          providerSessionId,
          projectPath: groupPath,
          sourcePath: join(sessionDir, 'summary.json'),
          cwd: readString(info?.cwd) || groupCwd || '',
          summary: readString(summary?.generated_title)
            || readString(summary?.session_summary),
          messageCount: readCount(summary?.num_messages)
            ?? readCount(summary?.num_chat_messages),
          lastActivity: readString(summary?.last_active_at)
            || readString(summary?.updated_at),
          model: readString(summary?.current_model_id),
        });
      }
    }

    return discovered;
  }
}

async function resolveGroupCwd(
  groupPath: string,
  groupName: string,
): Promise<string | undefined> {
  // The slug+hash form records the real path; the encoded form decodes back to it.
  const recorded = await readTextFile(join(groupPath, '.cwd'));
  if (recorded) {
    return recorded;
  }

  try {
    return decodeURIComponent(groupName);
  } catch {
    return undefined;
  }
}

async function readTextFile(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(JSON.parse(await readFile(path, 'utf8')) as unknown);
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

function readCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
