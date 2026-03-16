import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const DEFAULT_GOOSE_DB_PATH = join(homedir(), '.local', 'share', 'goose', 'sessions', 'sessions.db');

export interface GooseNativeSessionSummary {
  providerSessionId: string;
  cwd: string;
  summary?: string;
  messageCount: number;
  lastActivity?: string;
  model?: string;
}

export interface GooseHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GooseCommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface GooseNativeSessionServiceOptions {
  command: string;
  runner?: GooseCommandRunner;
}

export class GooseNativeSessionService {
  private readonly command: string;
  private readonly runner: GooseCommandRunner;

  constructor(options: GooseNativeSessionServiceOptions) {
    this.command = options.command;
    this.runner = options.runner || defaultCommandRunner;
  }

  async listAllSessions(): Promise<GooseNativeSessionSummary[]> {
    const result = await this.runner(this.command, ['session', 'list']);
    if (result.code !== 0) return [];

    const lines = result.stdout.split(/\r?\n/).filter((l) => l.trim());
    // Skip header line "Available sessions:"
    const sessionLines = lines.filter((l) => /^\S+\s+-\s+/.test(l));

    const summaries: GooseNativeSessionSummary[] = [];
    for (const line of sessionLines) {
      const parsed = parseSessionListLine(line);
      if (!parsed) continue;

      // Get full details via export
      try {
        const detail = await this.exportSession(parsed.providerSessionId);
        if (detail) {
          summaries.push(detail);
          continue;
        }
      } catch {
        // Fall through to basic info
      }

      summaries.push(parsed);
    }

    return summaries;
  }

  async listSessions(cwd: string): Promise<GooseNativeSessionSummary[]> {
    const all = await this.listAllSessions();
    const normalized = normalizePath(cwd);
    return all.filter((s) => normalizePath(s.cwd) === normalized);
  }

  async getLatestSession(cwd: string): Promise<GooseNativeSessionSummary | null> {
    const sessions = await this.listSessions(cwd);
    return sessions[0] ?? null;
  }

  async canResumeSession(_cwd: string, _providerSessionId: string): Promise<boolean> {
    return true;
  }

  async loadHistory(_cwd: string, providerSessionId: string): Promise<GooseHistoryMessage[]> {
    const detail = await this.exportSession(providerSessionId);
    if (!detail) return [];

    const result = await this.runner(this.command, [
      'session', 'export', '--name', providerSessionId, '--format', 'json',
    ]);
    if (result.code !== 0) return [];

    try {
      const data = JSON.parse(result.stdout);
      const messages: GooseHistoryMessage[] = [];
      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          const role = msg.message?.role;
          if (role !== 'user' && role !== 'assistant') continue;
          const content = msg.message?.content;
          if (!Array.isArray(content)) continue;
          const text = content
            .filter((c: { type?: string; text?: string }) => c.type === 'text' && c.text)
            .map((c: { text: string }) => c.text)
            .join('');
          if (text) {
            messages.push({ role, text, timestamp: msg.message?.created ? new Date(msg.message.created * 1000).toISOString() : undefined });
          }
        }
      }
      return messages;
    } catch {
      return [];
    }
  }

  async deleteSession(_cwd: string, providerSessionId: string): Promise<boolean> {
    // goose session remove requires the desktop app connection and fails headless.
    // Delete directly from SQLite instead, matching the session by name or id.
    const dbPath = DEFAULT_GOOSE_DB_PATH;
    if (!existsSync(dbPath)) return false;

    const result = await this.runner('python3', [
      '-c',
      [
        'import sqlite3, sys, json',
        `db = sqlite3.connect(${JSON.stringify(dbPath)})`,
        'name = sys.argv[1]',
        'c = db.execute("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE name = ? OR id = ?)", (name, name))',
        'c2 = db.execute("DELETE FROM sessions WHERE name = ? OR id = ?", (name, name))',
        'db.commit()',
        'print(json.dumps({"deleted": c2.rowcount > 0}))',
        'db.close()',
      ].join('\n'),
      providerSessionId,
    ]);

    if (result.code !== 0) return false;
    try {
      const data = JSON.parse(result.stdout);
      return Boolean(data.deleted);
    } catch {
      return false;
    }
  }

  private async exportSession(name: string): Promise<GooseNativeSessionSummary | null> {
    const result = await this.runner(this.command, [
      'session', 'export', '--name', name, '--format', 'json',
    ]);
    if (result.code !== 0) return null;

    try {
      const data = JSON.parse(result.stdout);
      let messageCount = 0;
      let summary: string | undefined;
      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          const role = msg.message?.role;
          if (role === 'user' || role === 'assistant') messageCount++;
          if (role === 'user' && !summary) {
            const content = msg.message?.content;
            if (Array.isArray(content)) {
              const textBlock = content.find(
                (c: { type?: string; text?: string }) => c.type === 'text' && c.text,
              );
              if (textBlock?.text) {
                summary = textBlock.text.slice(0, 100);
              }
            }
          }
        }
      }

      return {
        providerSessionId: data.name || data.id || name,
        cwd: data.working_dir || '',
        summary,
        messageCount,
        lastActivity: data.updated_at || data.created_at,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Parse a line from `goose session list` output.
 * Format: "20260316_4 - cats-test - 2026-03-16 21:03:50 UTC - ~/Source/SK2/one-man-digital-company"
 */
function parseSessionListLine(line: string): GooseNativeSessionSummary | null {
  const parts = line.split(/\s+-\s+/);
  if (parts.length < 4) return null;

  const id = parts[0].trim();
  const name = parts[1].trim();
  const dateStr = parts[2].trim();
  const cwd = parts[3].trim();

  return {
    providerSessionId: name || id,
    cwd: cwd.replace(/^~/, process.env.HOME || ''),
    summary: undefined,
    messageCount: 0,
    lastActivity: parseGooseDate(dateStr),
  };
}

function parseGooseDate(dateStr: string): string | undefined {
  try {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch {
    // ignore
  }
  return undefined;
}

function normalizePath(p: string): string {
  return p.replace(/\/+$/, '').replace(/^~/, process.env.HOME || '');
}

async function defaultCommandRunner(command: string, args: string[]): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
      });
    });
  });
}
