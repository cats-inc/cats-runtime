import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiscoveredSession } from './types.js';

interface WorkspaceYaml {
  id?: string;
  cwd?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
}

interface SessionStartEvent {
  type: 'session.start';
  data?: {
    sessionId?: string;
    startTime?: string;
    context?: { cwd?: string };
  };
}

/**
 * Scan ~/.copilot/session-state/ for Copilot CLI sessions.
 *
 * Two storage formats exist:
 * - Directory-based: <uuid>/workspace.yaml + events.jsonl
 * - Flat JSONL: <uuid>.jsonl with session.start as first line
 */
export class CopilotSessionScanner {
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  async scan(): Promise<DiscoveredSession[]> {
    const discovered: DiscoveredSession[] = [];
    const entries = await safeReaddir(this.sessionsDir);

    for (const entry of entries) {
      const fullPath = join(this.sessionsDir, entry);

      try {
        const entryStat = await stat(fullPath);

        if (entryStat.isDirectory()) {
          const session = await this.parseDirectorySession(fullPath, entry);
          if (session) discovered.push(session);
        } else if (entry.endsWith('.jsonl')) {
          const session = await this.parseJsonlSession(fullPath, entry);
          if (session) discovered.push(session);
        }
      } catch {
        continue;
      }
    }

    return discovered;
  }

  private async parseDirectorySession(
    dirPath: string,
    dirName: string,
  ): Promise<DiscoveredSession | null> {
    const workspacePath = join(dirPath, 'workspace.yaml');

    try {
      const raw = await readFile(workspacePath, 'utf-8');
      const meta = parseSimpleYaml(raw);

      const sessionId = meta.id || dirName;
      if (!sessionId) return null;

      // Try to get message count and model from events.jsonl
      const eventsPath = join(dirPath, 'events.jsonl');
      const { messageCount, model } = await this.parseEventsFile(eventsPath);

      return {
        providerSessionId: sessionId,
        projectPath: dirPath,
        sourcePath: workspacePath,
        cwd: meta.cwd || '',
        summary: meta.summary,
        messageCount,
        lastActivity: meta.updated_at || meta.created_at,
        model,
      };
    } catch {
      return null;
    }
  }

  private async parseJsonlSession(
    filePath: string,
    fileName: string,
  ): Promise<DiscoveredSession | null> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim());
      if (lines.length === 0) return null;

      // First line should be session.start
      let firstEvent: SessionStartEvent;
      try {
        firstEvent = JSON.parse(lines[0]);
      } catch {
        return null;
      }

      if (firstEvent.type !== 'session.start') return null;

      const sessionId = firstEvent.data?.sessionId || fileName.replace('.jsonl', '');
      const cwd = firstEvent.data?.context?.cwd || '';

      // Count user messages and find model
      let messageCount = 0;
      let model: string | undefined;
      let lastActivity: string | undefined;

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === 'user.message') {
            messageCount++;
          }
          if (event.type === 'session.model_change') {
            const data = event.data as Record<string, unknown> | undefined;
            if (data?.model) model = data.model as string;
          }
          // Track timestamp from any event that has one
          const data = event.data as Record<string, unknown> | undefined;
          if (data?.timestamp) lastActivity = data.timestamp as string;
        } catch {
          continue;
        }
      }

      if (messageCount === 0) return null;

      return {
        providerSessionId: sessionId,
        projectPath: this.sessionsDir,
        sourcePath: filePath,
        cwd,
        messageCount,
        lastActivity: lastActivity || firstEvent.data?.startTime,
        model,
      };
    } catch {
      return null;
    }
  }

  private async parseEventsFile(
    filePath: string,
  ): Promise<{ messageCount: number; model?: string }> {
    let messageCount = 0;
    let model: string | undefined;

    try {
      const raw = await readFile(filePath, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === 'user.message') {
            messageCount++;
          }
          if (event.type === 'session.model_change') {
            const data = event.data as Record<string, unknown> | undefined;
            if (data?.model) model = data.model as string;
          }
        } catch {
          continue;
        }
      }
    } catch {
      // events file may not exist
    }

    return { messageCount, model };
  }
}

/**
 * Minimal YAML parser for workspace.yaml — only handles simple key: value pairs.
 */
function parseSimpleYaml(raw: string): WorkspaceYaml {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }
  return result as unknown as WorkspaceYaml;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
