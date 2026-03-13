import { spawn } from 'node:child_process';
import { isWslDistroRunning, type WslDistroInspector } from '../discovery/wslDiscovery.js';
import type { RuntimeAdapter } from '../runtime/runtime.js';
import {
  createRuntimeAdapter,
  quoteForBash,
} from '../runtime/runtime.js';

export interface KiroNativeSessionSummary {
  providerSessionId: string;
  cwd: string;
  summary?: string;
  messageCount: number;
  lastActivity?: string;
  model?: string;
}

export interface KiroHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type KiroCommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
export interface KiroSessionListOptions {
  startIfNeeded?: boolean;
}

export interface KiroNativeSessionServiceOptions {
  command: string;
  dbPath: string;
  runtime: RuntimeAdapter;
  runner?: KiroCommandRunner;
  wslInspector?: WslDistroInspector;
}

interface RawKiroSession {
  sessionId?: string;
  workspacePath?: string;
  summary?: string;
  messageCount?: number;
  lastActivity?: string;
  model?: string;
}

interface RawKiroHistoryMessage {
  role?: string;
  text?: string;
  timestamp?: string;
}

export class KiroNativeSessionService {
  private readonly command: string;
  private readonly dbPath: string;
  private readonly runtime: RuntimeAdapter;
  private readonly runner: KiroCommandRunner;
  private readonly wslInspector: WslDistroInspector;

  constructor(options: KiroNativeSessionServiceOptions) {
    this.command = options.command;
    this.dbPath = options.dbPath;
    this.runtime = options.runtime;
    this.runner = options.runner || defaultCommandRunner;
    this.wslInspector = options.wslInspector || isWslDistroRunning;
  }

  normalizeWorkspace(cwd: string): string {
    if (!cwd.trim()) {
      throw new Error('cwd is required');
    }
    return this.runtime.toRuntimePath(cwd);
  }

  async listSessions(
    cwd: string,
    options: KiroSessionListOptions = {},
  ): Promise<KiroNativeSessionSummary[]> {
    const workspace = this.normalizeWorkspace(cwd);
    return (await this.listAllSessions(options)).filter(
      (session) => this.normalizeWorkspace(session.cwd) === workspace,
    );
  }

  async listAllSessions(
    options: KiroSessionListOptions = {},
  ): Promise<KiroNativeSessionSummary[]> {
    if (!(await this.shouldStartDiscovery(options))) {
      return [];
    }

    const result = await this.runJsonScript<RawKiroSession[]>(LIST_ALL_KIRO_SESSIONS_PY, [
      this.dbPath,
    ]);

    return result
      .filter((item) =>
        typeof item?.sessionId === 'string'
        && item.sessionId.length > 0
        && typeof item.workspacePath === 'string'
        && item.workspacePath.length > 0
      )
      .map((item) => ({
        providerSessionId: item.sessionId!,
        cwd: this.runtime.toHostPath(item.workspacePath!),
        summary: item.summary,
        messageCount: item.messageCount ?? 0,
        lastActivity: item.lastActivity,
        model: item.model,
      }));
  }

  async getLatestSession(cwd: string): Promise<KiroNativeSessionSummary | null> {
    const sessions = await this.listSessions(cwd);
    return sessions[0] ?? null;
  }

  async canResumeSession(cwd: string, providerSessionId: string): Promise<boolean> {
    const latest = await this.getLatestSession(cwd);
    return Boolean(latest && latest.providerSessionId === providerSessionId);
  }

  async loadHistory(cwd: string, providerSessionId: string): Promise<KiroHistoryMessage[]> {
    const workspace = this.normalizeWorkspace(cwd);
    const result = await this.runJsonScript<RawKiroHistoryMessage[]>(LOAD_KIRO_HISTORY_PY, [
      this.dbPath,
      workspace,
      providerSessionId,
    ]);

    return result
      .filter((item) => item?.role === 'user' || item?.role === 'assistant')
      .map((item) => ({
        role: item.role as 'user' | 'assistant',
        text: item.text || '',
        timestamp: item.timestamp,
      }))
      .filter((item) => item.text.trim().length > 0);
  }

  async deleteSession(cwd: string, providerSessionId: string): Promise<boolean> {
    const workspace = this.normalizeWorkspace(cwd);
    const result = await this.runJsonScript<{ deleted?: boolean }>(DELETE_KIRO_SESSION_PY, [
      this.dbPath,
      workspace,
      providerSessionId,
    ]);
    return Boolean(result.deleted);
  }

  async getLatestSessionId(cwd: string): Promise<string | null> {
    const latest = await this.getLatestSession(cwd);
    return latest?.providerSessionId ?? null;
  }

  private async shouldStartDiscovery(
    options: KiroSessionListOptions,
  ): Promise<boolean> {
    if (options.startIfNeeded !== false || this.runtime.mode !== 'wsl') {
      return true;
    }

    return this.wslInspector(this.runtime.distro || 'Ubuntu');
  }

  private async runJsonScript<T>(script: string, args: string[]): Promise<T> {
    const stdout = await this.runShell(buildPythonCommand(script, args));
    try {
      return JSON.parse(stdout) as T;
    } catch (error) {
      throw new Error(`Failed to parse Kiro session JSON: ${String(error)}. Output: ${stdout}`);
    }
  }

  private async runShell(script: string): Promise<string> {
    const { command, args } = this.runtime.buildShellInvocation(script);
    const result = await this.runner(command, args);

    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      throw new Error(stderr || stdout || `Kiro native command failed with code ${result.code}`);
    }

    return result.stdout;
  }
}

export function normalizeKiroWorkspacePath(cwd: string): string {
  return new KiroNativeSessionService({
    command: 'kiro-cli',
    dbPath: '~/.local/share/kiro-cli/data.sqlite3',
    runtime: createRuntimeAdapter({
      mode: process.platform === 'win32' ? 'wsl' : 'native',
      distro: 'Ubuntu',
    }),
    runner: async () => ({ code: 0, stdout: '', stderr: '' }),
  }).normalizeWorkspace(cwd);
}

function buildPythonCommand(script: string, args: string[]): string {
  const encoded = Buffer.from(script, 'utf-8').toString('base64');
  const python = `import base64; exec(base64.b64decode("${encoded}"))`;
  const quotedArgs = args.map(quoteForBash).join(' ');
  return `python3 -c ${quoteForBash(python)}${quotedArgs ? ` ${quotedArgs}` : ''}`;
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

const KIRO_PY_SHARED = String.raw`
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone


def to_iso(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        if numeric < 1e12:
            numeric *= 1000
        return datetime.fromtimestamp(numeric / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        numeric = float(text)
        if numeric < 1e12:
            numeric *= 1000
        return datetime.fromtimestamp(numeric / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat().replace("+00:00", "Z")
    except Exception:
        return text


def safe_json(value, fallback):
    try:
        return json.loads(value)
    except Exception:
        return fallback


def extract_user_prompt(entry):
    user = entry.get("user") if isinstance(entry, dict) else None
    if not isinstance(user, dict):
        return None
    content = user.get("content")
    if not isinstance(content, dict):
        return None
    prompt = content.get("Prompt")
    if not isinstance(prompt, dict):
        return None
    text = prompt.get("prompt")
    if not isinstance(text, str):
        return None
    return text.strip() or None


def extract_user_timestamp(entry):
    user = entry.get("user") if isinstance(entry, dict) else None
    if not isinstance(user, dict):
        return None
    return to_iso(user.get("timestamp"))


def extract_assistant_text(entry):
    assistant = entry.get("assistant") if isinstance(entry, dict) else None
    if not isinstance(assistant, dict):
        return None

    response = assistant.get("Response")
    if isinstance(response, dict) and isinstance(response.get("content"), str):
        text = response.get("content").strip()
        if text:
            return text

    tool_use = assistant.get("ToolUse")
    if isinstance(tool_use, dict) and isinstance(tool_use.get("content"), str):
        text = tool_use.get("content").strip()
        if text:
            return text

    return None


def extract_assistant_timestamp(entry):
    metadata = entry.get("request_metadata") if isinstance(entry, dict) else None
    if not isinstance(metadata, dict):
        return None
    return to_iso(metadata.get("stream_end_timestamp_ms") or metadata.get("request_start_timestamp_ms"))


def extract_model(entry):
    metadata = entry.get("request_metadata") if isinstance(entry, dict) else None
    if not isinstance(metadata, dict):
        return None
    model = metadata.get("model_id")
    if isinstance(model, str) and model.strip():
        return model.strip()
    return None


def summarize_prompt(text):
    if not text:
        return None
    return " ".join(text.split())[:100] or None


def parse_session_row(row):
    key, conversation_id, value, created_at, updated_at = row
    payload = safe_json(value, {})
    history = payload.get("history")
    if not isinstance(history, list):
        history = []

    summary = None
    model = None
    prompt_count = 0
    for entry in history:
        prompt = extract_user_prompt(entry)
        if prompt:
            prompt_count += 1
            summary = summarize_prompt(prompt) or summary
        model = extract_model(entry) or model

    return {
        "sessionId": conversation_id,
        "workspacePath": key,
        "summary": summary or "Untitled Session",
        "messageCount": prompt_count,
        "lastActivity": to_iso(updated_at) or to_iso(created_at),
        "model": model,
    }


def load_messages(value):
    payload = safe_json(value, {})
    history = payload.get("history")
    if not isinstance(history, list):
        history = []

    messages = []
    for entry in history:
        prompt = extract_user_prompt(entry)
        if prompt:
            messages.append({
                "role": "user",
                "text": prompt,
                "timestamp": extract_user_timestamp(entry),
            })

        answer = extract_assistant_text(entry)
        if answer:
            messages.append({
                "role": "assistant",
                "text": answer,
                "timestamp": extract_assistant_timestamp(entry),
            })

    return messages
`;

const LIST_ALL_KIRO_SESSIONS_PY = String.raw`
${KIRO_PY_SHARED}

db_path = os.path.expanduser(sys.argv[1])
db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
rows = db.execute(
    "SELECT key, conversation_id, value, created_at, updated_at FROM conversations_v2 ORDER BY updated_at DESC"
).fetchall()
db.close()

result = [parse_session_row(row) for row in rows]
print(json.dumps(result))
`;

const LOAD_KIRO_HISTORY_PY = String.raw`
${KIRO_PY_SHARED}

db_path = os.path.expanduser(sys.argv[1])
workspace = sys.argv[2]
conversation_id = sys.argv[3]

db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
row = db.execute(
    "SELECT value FROM conversations_v2 WHERE key = ? AND conversation_id = ?",
    (workspace, conversation_id),
).fetchone()
db.close()

if row is None:
    print("[]")
    raise SystemExit(0)

print(json.dumps(load_messages(row[0])))
`;

const DELETE_KIRO_SESSION_PY = String.raw`
${KIRO_PY_SHARED}

db_path = os.path.expanduser(sys.argv[1])
workspace = sys.argv[2]
conversation_id = sys.argv[3]

db = sqlite3.connect(db_path)
cursor = db.execute(
    "DELETE FROM conversations_v2 WHERE key = ? AND conversation_id = ?",
    (workspace, conversation_id),
)
deleted = cursor.rowcount > 0
db.commit()
db.close()

print(json.dumps({"deleted": deleted}))
`;
