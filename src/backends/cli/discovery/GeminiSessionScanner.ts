import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { DiscoveredSession } from './types.js';

/**
 * Extract text from Gemini content which can be a string or a part-list array.
 * Part-list format: [{ text: "..." }, { functionCall: ... }, ...]
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: Record<string, unknown>) => {
        if (typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  return '';
}

/**
 * Scan Gemini CLI sessions stored under ~/.gemini/tmp/<id>/chats/session-*.json
 *
 * Session file format (single JSON):
 *   - sessionId: string
 *   - summary?: string
 *   - kind?: string ('subagent' etc.)
 *   - messages: Array<{ type, role?, content?, model?, timestamp? }>
 *
 * Project directory identification:
 *   - Modern Gemini CLI uses slug names (e.g. "one-man-digital-company")
 *   - Legacy Gemini CLI uses SHA256 hashes of the project path
 *   - Both are resolved via ~/.gemini/history/<name>/.project_root
 */
export class GeminiSessionScanner {
  private sessionsDir: string;
  // Maps both slug names and legacy SHA256 hashes to project paths
  private dirToPath = new Map<string, string>();

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  async scan(): Promise<DiscoveredSession[]> {
    await this.buildDirMap();

    const discovered: DiscoveredSession[] = [];
    const projectDirs = await safeReaddir(this.sessionsDir);

    for (const projDir of projectDirs) {
      const projPath = join(this.sessionsDir, projDir);
      if (!(await isDirectory(projPath))) continue;

      const chatsDir = join(projPath, 'chats');
      if (!(await isDirectory(chatsDir))) continue;

      const files = await safeReaddir(chatsDir);
      for (const file of files) {
        if (!file.startsWith('session-') || !file.endsWith('.json')) continue;

        const filePath = join(chatsDir, file);

        try {
          const fileStat = await stat(filePath);
          if (fileStat.size === 0) continue;
        } catch {
          continue;
        }

        const meta = await this.parseSessionFile(filePath, projDir);
        if (!meta.sessionId) continue;
        if (meta.kind === 'subagent') continue;
        if (meta.messageCount === 0) continue;

        discovered.push({
          providerSessionId: meta.sessionId,
          projectPath: chatsDir,
          sourcePath: filePath,
          cwd: meta.cwd || '',
          summary: meta.summary,
          messageCount: meta.messageCount,
          lastActivity: meta.lastActivity,
          model: meta.model,
        });
      }
    }

    return discovered;
  }

  private async buildDirMap(): Promise<void> {
    // ~/.gemini/history/<name>/.project_root contains the project path
    // <name> can be a slug (modern) or anything — we map both the name
    // itself and the SHA256 hash of the project path for backward compat.
    const historyDir = join(dirname(this.sessionsDir), 'history');
    const names = await safeReaddir(historyDir);

    for (const name of names) {
      const projectRootFile = join(historyDir, name, '.project_root');
      try {
        const projectPath = (await readFile(projectRootFile, 'utf-8')).trim();
        // Modern: directory name is the slug used under tmp/
        this.dirToPath.set(name, projectPath);
        // Legacy: directory name under tmp/ is SHA256 of project path
        const hash = createHash('sha256').update(projectPath).digest('hex');
        this.dirToPath.set(hash, projectPath);
      } catch {
        continue;
      }
    }
  }

  private async parseSessionFile(path: string, projDir: string): Promise<{
    sessionId?: string;
    cwd?: string;
    summary?: string;
    kind?: string;
    model?: string;
    messageCount: number;
    lastActivity?: string;
  }> {
    try {
      const raw = await readFile(path, 'utf-8');
      const data = JSON.parse(raw);

      const sessionId = data.sessionId as string | undefined;
      const kind = data.kind as string | undefined;
      const messages: Array<Record<string, unknown>> = data.messages || [];

      // Count user messages
      let messageCount = 0;
      let lastActivity: string | undefined;
      let model: string | undefined;
      let lastUserMessage: string | undefined;

      for (const msg of messages) {
        if (msg.type === 'user') {
          messageCount++;
          const text = extractText(msg.content);
          if (text) lastUserMessage = text;
        }
        if (msg.timestamp) {
          lastActivity = msg.timestamp as string;
        }
        if (msg.type === 'gemini' && msg.model && !model) {
          model = msg.model as string;
        }
      }

      // Summary: prefer session.summary, fallback to last user message
      let summary = data.summary as string | undefined;
      if (!summary && lastUserMessage) {
        summary = lastUserMessage.slice(0, 100);
      }

      // Resolve project path: try slug name first, then legacy hash
      const cwd = this.dirToPath.get(projDir) || '';

      return { sessionId, cwd, summary, kind, model, messageCount, lastActivity };
    } catch {
      return { messageCount: 0 };
    }
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
