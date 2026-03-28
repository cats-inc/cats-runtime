import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

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
  sessionDbPath?: string;
  projectsIndexPath?: string;
}

export class GooseNativeSessionService {
  private readonly command: string;
  private readonly runner: GooseCommandRunner;
  private readonly sessionDbPath?: string;
  private readonly projectsIndexPath?: string;

  constructor(options: GooseNativeSessionServiceOptions) {
    this.command = options.command;
    this.runner = options.runner || defaultCommandRunner;
    this.sessionDbPath = options.sessionDbPath || resolveExistingGooseSessionDbPath();
    this.projectsIndexPath = options.projectsIndexPath || resolveExistingGooseProjectsIndexPath();
  }

  async listAllSessions(): Promise<GooseNativeSessionSummary[]> {
    const jsonResult = await this.runner(this.command, ['session', 'list', '--format', 'json']);
    const jsonSummaries = parseSessionListJson(jsonResult.stdout);
    if (jsonResult.code === 0 && jsonSummaries) {
      return this.hydrateSessionSummaries(jsonSummaries);
    }

    const result = await this.runner(this.command, ['session', 'list']);
    if (result.code !== 0) return [];

    const lines = result.stdout.split(/\r?\n/).filter((l) => l.trim());
    const sessionLines = lines.filter((l) => /^\S+\s+-\s+/.test(l));
    const parsedSummaries = sessionLines
      .map((line) => parseSessionListLine(line))
      .filter((session): session is GooseNativeSessionSummary => Boolean(session));

    return this.hydrateSessionSummaries(parsedSummaries);
  }

  private async hydrateSessionSummaries(
    parsedSummaries: GooseNativeSessionSummary[],
  ): Promise<GooseNativeSessionSummary[]> {
    const summaries: GooseNativeSessionSummary[] = [];
    for (const parsed of parsedSummaries) {
      try {
        const detail = await this.exportSession(parsed.providerSessionId);
        if (detail) {
          summaries.push(detail);
        }
      } catch {
        // Skip stale sessions that are still indexed by the Goose CLI list output.
      }
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
    const data = await this.exportSessionJson(providerSessionId);
    if (!data) return [];

    try {
      const messages: GooseHistoryMessage[] = [];
      for (const msg of getGooseConversationEntries(data)) {
        const normalized = normalizeGooseMessage(msg);
        if (!normalized) continue;
        const role = normalized.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const text = extractGooseText(normalized.content);
        if (text) {
          messages.push({
            role,
            text,
            timestamp: normalized.createdAt,
          });
        }
      }
      return messages;
    } catch {
      return [];
    }
  }

  async deleteSession(_cwd: string, providerSessionId: string): Promise<boolean> {
    const dbPath = this.sessionDbPath;
    if (!dbPath || !existsSync(dbPath)) return false;
    const matchingIdentifiers = await this.collectMatchingSessionIdentifiers(providerSessionId);

    const deleteScript = [
      'import sqlite3, sys, json',
      'db = sqlite3.connect(sys.argv[1])',
      'identifier = sys.argv[2]',
      'db.execute("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE name = ? OR id = ?)", (identifier, identifier))',
      'deleted = db.execute("DELETE FROM sessions WHERE name = ? OR id = ?", (identifier, identifier)).rowcount > 0',
      'db.commit()',
      'print(json.dumps({"deleted": deleted}))',
      'db.close()',
    ].join('\n');

    for (const candidate of getPythonCommandCandidates()) {
      const result = await this.runner(candidate.command, [
        ...candidate.prefixArgs,
        '-c',
        deleteScript,
        dbPath,
        providerSessionId,
      ]);
      if (result.code !== 0) {
        continue;
      }

      try {
        const data = JSON.parse(result.stdout);
        if (!data.deleted) {
          return false;
        }

        this.pruneProjectsIndex(matchingIdentifiers);
        for (const identifier of matchingIdentifiers) {
          if (await this.exportSessionJson(identifier)) {
            return false;
          }
        }
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private async exportSession(name: string): Promise<GooseNativeSessionSummary | null> {
    const data = await this.exportSessionJson(name);
    if (!data) return null;

    try {
      let messageCount = 0;
      let summary: string | undefined;
      for (const msg of getGooseConversationEntries(data)) {
        const normalized = normalizeGooseMessage(msg);
        if (!normalized) continue;
        const role = normalized.role;
        if (role === 'user' || role === 'assistant') {
          messageCount += 1;
        }
        if (role === 'user' && !summary) {
          const text = extractGooseText(normalized.content);
          if (text) {
            summary = text.slice(0, 100);
          }
        }
      }

      return {
        providerSessionId: readStringField(data.id) || readStringField(data.name) || name,
        cwd: readStringField(data.working_dir) || '',
        summary,
        messageCount: readNumberField(data.message_count) ?? messageCount,
        lastActivity: readStringField(data.updated_at) || readStringField(data.created_at),
        model: readModelName(data),
      };
    } catch {
      return null;
    }
  }

  private async exportSessionJson(identifier: string): Promise<Record<string, unknown> | null> {
    for (const args of [
      ['session', 'export', '--session-id', identifier, '--format', 'json'],
      ['session', 'export', '--name', identifier, '--format', 'json'],
    ]) {
      const result = await this.runner(this.command, args);
      if (result.code !== 0) {
        continue;
      }

      try {
        const data = JSON.parse(result.stdout);
        if (data && typeof data === 'object') {
          return data as Record<string, unknown>;
        }
      } catch {
        // Try the next export form.
      }
    }

    return null;
  }

  private async collectMatchingSessionIdentifiers(providerSessionId: string): Promise<string[]> {
    const identifiers = new Set([providerSessionId]);
    const result = await this.runner(this.command, ['session', 'list', '--format', 'json']);
    const sessions = result.code === 0 ? parseSessionListJson(result.stdout) : null;
    if (!sessions) {
      return Array.from(identifiers);
    }

    for (const session of sessions) {
      if (session.providerSessionId === providerSessionId || session.summary === providerSessionId) {
        identifiers.add(session.providerSessionId);
        if (session.summary) {
          identifiers.add(session.summary);
        }
      }
    }

    return Array.from(identifiers);
  }

  private pruneProjectsIndex(providerSessionIds: string[]): void {
    if (!this.projectsIndexPath || !existsSync(this.projectsIndexPath)) {
      return;
    }

    try {
      const raw = readFileSync(this.projectsIndexPath, 'utf8');
      const data = JSON.parse(raw) as {
        projects?: Record<string, { last_session_id?: string | null; last_instruction?: string | null }>;
      };
      const projects = data.projects;
      if (!projects || typeof projects !== 'object') {
        return;
      }

      let changed = false;
      for (const entry of Object.values(projects)) {
        if (!entry || !providerSessionIds.includes(entry.last_session_id || '')) {
          continue;
        }
        entry.last_session_id = null;
        if (Object.prototype.hasOwnProperty.call(entry, 'last_instruction')) {
          entry.last_instruction = null;
        }
        changed = true;
      }

      if (changed) {
        writeFileSync(this.projectsIndexPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      }
    } catch {
      // Best effort only. A stale index should not block deletion.
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
    providerSessionId: id || name,
    cwd: cwd.replace(/^~/, process.env.HOME || ''),
    summary: undefined,
    messageCount: 0,
    lastActivity: parseGooseDate(dateStr),
  };
}

function parseSessionListJson(stdout: string): GooseNativeSessionSummary[] | null {
  try {
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const id = readStringField((entry as Record<string, unknown>).id);
        const name = readStringField((entry as Record<string, unknown>).name);
        const cwd = readStringField((entry as Record<string, unknown>).working_dir);
        if (!id || !cwd) {
          return null;
        }

        const summary: GooseNativeSessionSummary = {
          providerSessionId: id,
          cwd,
          summary: name || undefined,
          messageCount: readNumberField((entry as Record<string, unknown>).message_count) ?? 0,
          lastActivity: readStringField((entry as Record<string, unknown>).updated_at)
            || readStringField((entry as Record<string, unknown>).created_at),
          model: readModelName(entry as Record<string, unknown>),
        };
        return summary;
      })
      .filter((entry): entry is GooseNativeSessionSummary => entry !== null);
  } catch {
    return null;
  }
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

function getGooseConversationEntries(data: Record<string, unknown>): unknown[] {
  if (Array.isArray(data.conversation)) {
    return data.conversation;
  }
  if (Array.isArray(data.messages)) {
    return data.messages;
  }
  return [];
}

function normalizeGooseMessage(entry: unknown): {
  role?: string;
  content?: unknown[];
  createdAt?: string;
} | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const message = record.message && typeof record.message === 'object'
    ? record.message as Record<string, unknown>
    : record;
  const content = Array.isArray(message.content)
    ? message.content
    : Array.isArray(record.content)
      ? record.content
      : undefined;
  const created = readNumberField(message.created) ?? readNumberField(record.created);

  return {
    role: readStringField(message.role) || readStringField(record.role),
    content,
    createdAt: created ? new Date(created * 1000).toISOString() : undefined,
  };
}

function extractGooseText(content: unknown[] | undefined): string {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((entry): entry is { type?: string; text?: string } => Boolean(entry && typeof entry === 'object'))
    .filter((entry) => entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text!)
    .join('');
}

function readStringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readModelName(record: Record<string, unknown>): string | undefined {
  const modelConfig = record.model_config;
  if (!modelConfig || typeof modelConfig !== 'object') {
    return undefined;
  }

  return readStringField((modelConfig as Record<string, unknown>).model_name);
}

function resolveExistingGooseSessionDbPath(): string | undefined {
  return buildGoosePathCandidates('sessions', 'sessions.db').find((candidate) => existsSync(candidate));
}

function resolveExistingGooseProjectsIndexPath(): string | undefined {
  return buildGoosePathCandidates('projects.json').find((candidate) => existsSync(candidate));
}

function buildGoosePathCandidates(...tail: string[]): string[] {
  const home = homedir();
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    appData ? join(appData, 'Block', 'goose', 'data', ...tail) : undefined,
    appData ? join(appData, 'Block', 'goose', ...tail) : undefined,
    localAppData ? join(localAppData, 'Block', 'goose', 'data', ...tail) : undefined,
    localAppData ? join(localAppData, 'Block', 'goose', ...tail) : undefined,
    join(home, '.local', 'share', 'goose', 'data', ...tail),
    join(home, '.local', 'share', 'goose', ...tail),
    join(home, 'Library', 'Application Support', 'Block', 'goose', 'data', ...tail),
    join(home, 'Library', 'Application Support', 'Block', 'goose', ...tail),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return Array.from(new Set(candidates));
}

function getPythonCommandCandidates(): Array<{ command: string; prefixArgs: string[] }> {
  return process.platform === 'win32'
    ? [
        { command: 'python', prefixArgs: [] },
        { command: 'py', prefixArgs: ['-3'] },
      ]
    : [
        { command: 'python3', prefixArgs: [] },
        { command: 'python', prefixArgs: [] },
      ];
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
