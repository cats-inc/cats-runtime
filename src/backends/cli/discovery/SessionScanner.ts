import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import type { DiscoveredSession, SessionsIndex } from './types.js';

export class SessionScanner {
  private projectsDir: string;

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir;
  }

  /**
   * Scan all project directories under ~/.claude/projects/
   * Tries sessions-index.json first, then falls back to .jsonl files.
   */
  async scan(): Promise<DiscoveredSession[]> {
    const discovered: DiscoveredSession[] = [];

    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.projectsDir);
    } catch {
      return discovered;
    }

    for (const dir of projectDirs) {
      const projectPath = join(this.projectsDir, dir);

      // Check if it's a directory
      try {
        const st = await stat(projectPath);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }

      const decodedCwd = this.decodeProjectPath(dir);

      // Strategy 1: sessions-index.json
      const indexPath = join(projectPath, 'sessions-index.json');
      let foundIndex = false;
      try {
        const raw = await readFile(indexPath, 'utf-8');
        const index: SessionsIndex = JSON.parse(raw);
        foundIndex = true;

        for (const [sessionId, entry] of Object.entries(index)) {
          discovered.push({
            providerSessionId: sessionId,
            projectPath,
            sourcePath: join(projectPath, `${sessionId}.jsonl`),
            cwd: entry.cwd || decodedCwd,
            summary: entry.summary,
            messageCount: entry.message_count,
            lastActivity: entry.last_message_at,
          });
        }
      } catch {
        // No index file or corrupt — fall through to strategy 2
      }

      if (foundIndex) continue;

      // Strategy 2: scan .jsonl files (each file = one session)
      let entries: string[];
      try {
        entries = await readdir(projectPath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;

        const sessionId = basename(entry, '.jsonl');
        const jsonlPath = join(projectPath, entry);

        // Skip empty files
        try {
          const fileStat = await stat(jsonlPath);
          if (fileStat.size === 0) continue;
        } catch {
          continue;
        }

        const meta = await this.parseJsonlMetadata(jsonlPath);

        discovered.push({
          providerSessionId: sessionId,
          projectPath,
          sourcePath: jsonlPath,
          cwd: meta.cwd || decodedCwd,
          summary: meta.summary,
          messageCount: meta.messageCount,
          lastActivity: meta.lastTimestamp,
        });
      }
    }

    return discovered;
  }

  /**
   * Parse a .jsonl session file to extract basic metadata.
   * Uses streaming readline to avoid loading large files into memory.
   * Reads only enough lines to get cwd/summary, counts messages throughout.
   */
  private async parseJsonlMetadata(path: string): Promise<{
    cwd?: string;
    summary?: string;
    messageCount: number;
    lastTimestamp?: string;
  }> {
    let cwd: string | undefined;
    let summary: string | undefined;
    let messageCount = 0;
    let lastTimestamp: string | undefined;

    try {
      const rl = createInterface({
        input: createReadStream(path, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);

          if (obj.type === 'user') {
            messageCount++;
            if (!cwd && obj.cwd) cwd = obj.cwd;
            if (typeof obj.message?.content === 'string') {
              summary = obj.message.content.slice(0, 100);
            }
          } else if (obj.type === 'assistant') {
            messageCount++;
          }

          if (obj.timestamp) lastTimestamp = obj.timestamp;
        } catch {
          continue;
        }
      }
    } catch {
      return { messageCount: 0 };
    }

    return { cwd, summary, messageCount, lastTimestamp };
  }

  /**
   * Decode an encoded project path back to the original path.
   * On Windows: "-Users-sammy-Source-project" → "C:/Users/sammy/Source/project"
   * On Linux/Mac: "-Users-sammy-Source-project" → "/Users/sammy/Source/project"
   */
  private decodeProjectPath(encoded: string): string {
    // The encoding replaces path separators and special chars with hyphens.
    // On Windows, paths like "C:\Users\sammy\Source\project" become
    // "C--Users-sammy-Source-project" (drive letter colon → hyphen)
    // This is a best-effort decode; the actual CWD from the index is preferred.
    if (process.platform === 'win32') {
      // Pattern: "C--Users-sammy-..." → "C:/Users/sammy/..."
      const match = encoded.match(/^([A-Z])--(.*)/);
      if (match) {
        return `${match[1]}:/${match[2].replace(/-/g, '/')}`;
      }
    }

    // Unix: "-Users-sammy-..." → "/Users/sammy/..."
    return '/' + encoded.replace(/^-/, '').replace(/-/g, '/');
  }
}
