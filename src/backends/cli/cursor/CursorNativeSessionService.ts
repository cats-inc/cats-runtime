import { spawn } from 'node:child_process';
import { isWslDistroRunning, type WslDistroInspector } from '../discovery/wslDiscovery.js';
import type { CommandRunnerOptions } from '../pythonScripts.js';
import { runPythonJsonScript, type CommandRunner } from '../pythonScripts.js';
import type { RuntimeAdapter } from '../runtime/runtime.js';
import {
  createRuntimeAdapter,
} from '../runtime/runtime.js';
import { hiddenWindowsSpawnOptions } from '../../../core/process/windowsSpawn.js';

export interface CursorNativeSessionSummary {
  providerSessionId: string;
  cwd: string;
  summary?: string;
  messageCount: number;
  lastActivity?: string;
  model?: string;
}

export interface CursorHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: string;
}

export type CursorCommandRunner = CommandRunner;
export interface CursorSessionListOptions {
  startIfNeeded?: boolean;
}

export interface CursorNativeSessionServiceOptions {
  command: string;
  chatsDir: string;
  runtime: RuntimeAdapter;
  runner?: CursorCommandRunner;
  wslInspector?: WslDistroInspector;
}

interface RawCursorSession {
  sessionId?: string;
  workspacePath?: string;
  summary?: string;
  messageCount?: number;
  lastActivity?: string;
  model?: string;
}

interface RawCursorHistoryMessage {
  role?: string;
  text?: string;
  timestamp?: string;
}

export class CursorNativeSessionService {
  private readonly command: string;
  private readonly chatsDir: string;
  private readonly runtime: RuntimeAdapter;
  private readonly runner: CursorCommandRunner;
  private readonly wslInspector: WslDistroInspector;

  constructor(options: CursorNativeSessionServiceOptions) {
    this.command = options.command;
    this.chatsDir = options.chatsDir;
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
    options: CursorSessionListOptions = {},
  ): Promise<CursorNativeSessionSummary[]> {
    const workspace = this.normalizeWorkspace(cwd);
    return (await this.listAllSessions(options)).filter(
      (session) => this.normalizeWorkspace(session.cwd) === workspace,
    );
  }

  async listAllSessions(
    options: CursorSessionListOptions = {},
  ): Promise<CursorNativeSessionSummary[]> {
    if (!(await this.shouldStartDiscovery(options))) {
      return [];
    }

    const result = await this.runJsonScript<RawCursorSession[]>(LIST_ALL_CURSOR_SESSIONS_PY, [
      this.chatsDir,
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

  async createSession(cwd: string): Promise<CursorNativeSessionSummary> {
    const workspace = this.normalizeWorkspace(cwd);
    const stdout = this.runtime.mode === 'native'
      ? await this.runCommand(['create-chat'], workspace)
      : await this.runShell(`cd ${shellQuote(workspace)} && ${shellQuote(this.command)} create-chat`);
    const sessionId = stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);

    if (!sessionId) {
      throw new Error('Cursor did not return a session ID');
    }

    const sessions = await this.listSessions(cwd);
    const existing = sessions.find((session) => session.providerSessionId === sessionId);
    if (existing) {
      return existing;
    }

    return {
      providerSessionId: sessionId,
      cwd,
      messageCount: 0,
    };
  }

  async loadHistory(cwd: string, providerSessionId: string): Promise<CursorHistoryMessage[]> {
    const workspace = this.normalizeWorkspace(cwd);
    const result = await this.runJsonScript<RawCursorHistoryMessage[]>(LOAD_CURSOR_HISTORY_PY, [
      workspace,
      providerSessionId,
      this.chatsDir,
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
    const result = await this.runJsonScript<{ deleted?: boolean }>(DELETE_CURSOR_SESSION_PY, [
      workspace,
      providerSessionId,
      this.chatsDir,
    ]);
    return Boolean(result.deleted);
  }

  private async shouldStartDiscovery(
    options: CursorSessionListOptions,
  ): Promise<boolean> {
    if (options.startIfNeeded !== false || this.runtime.mode !== 'wsl') {
      return true;
    }

    return this.wslInspector(this.runtime.distro || 'Ubuntu');
  }

  private async runJsonScript<T>(script: string, args: string[]): Promise<T> {
    return runPythonJsonScript<T>({
      runtime: this.runtime,
      runner: this.runner,
      script,
      args,
      commandLabel: 'Cursor native command',
      parseLabel: 'Cursor session',
    });
  }

  private async runShell(script: string): Promise<string> {
    const { command, args } = this.runtime.buildShellInvocation(script);
    return this.run(command, args);
  }

  private async runCommand(args: string[], cwd?: string): Promise<string> {
    return this.run(this.command, args, {
      ...(shouldUseNativeCommandShell(this.command) ? { shell: true } : {}),
      ...(cwd ? { cwd } : {}),
    });
  }

  private async run(
    command: string,
    args: string[],
    options: CommandRunnerOptions = {},
  ): Promise<string> {
    const result = await this.runner(command, args, options);

    if (result.code !== 0) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      throw new Error(stderr || stdout || `Cursor native command failed with code ${result.code}`);
    }

    return result.stdout;
  }
}

export function normalizeCursorWorkspacePath(cwd: string): string {
  return new CursorNativeSessionService({
    command: 'cursor-agent',
    chatsDir: '~/.cursor/chats',
    runtime: createRuntimeAdapter({
      mode: process.platform === 'win32' ? 'wsl' : 'native',
      distro: 'Ubuntu',
    }),
    runner: async () => ({ code: 0, stdout: '', stderr: '' }),
  }).normalizeWorkspace(cwd);
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: CommandRunnerOptions = {},
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...hiddenWindowsSpawnOptions(),
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

function shouldUseNativeCommandShell(command: string): boolean {
  if (process.platform !== 'win32') {
    return false;
  }

  return /\.(cmd|bat)$/i.test(command.trim());
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const CURSOR_PY_SHARED_A = String.raw`
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import datetime, timezone


WORKSPACE_RE = re.compile(r"Workspace Path:\s*(.+)")
WORKSPACE_LOG_RE = re.compile(r"workspacePath=(.+)")
USER_QUERY_RE = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.DOTALL)


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


def decode_meta_value(raw_value):
    if raw_value is None:
        return None
    text = raw_value.decode("utf-8", "replace") if isinstance(raw_value, (bytes, bytearray)) else str(raw_value)
    stripped = text.strip()
    if stripped and len(stripped) % 2 == 0:
        try:
            decoded = bytes.fromhex(stripped).decode("utf-8", "replace")
            return json.loads(decoded)
        except Exception:
            pass
    try:
        return json.loads(text)
    except Exception:
        return text


def extract_text(content):
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "\n".join(part for part in parts if part).strip()
    return ""


def summarize_user_text(text):
    if not text:
        return None
    match = USER_QUERY_RE.search(text)
    if match:
        text = match.group(1)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None
    return text[:100]


def parse_message_payload(payload):
    role = payload.get("role")
    content = payload.get("content")
    timestamp = payload.get("timestamp") or payload.get("createdAt")

    message = payload.get("message")
    if isinstance(message, dict):
        if role is None:
            role = message.get("role")
        if content is None:
            content = message.get("content")
        timestamp = timestamp or message.get("timestamp") or message.get("createdAt")

    return role, content, timestamp


def emit_message(role, content, timestamp, messages):
    if role not in ("user", "assistant"):
        return
    text = extract_text(content)
    if not text:
        return
    messages.append({
        "role": role,
        "text": text,
        "timestamp": timestamp,
    })


def read_jsonl(path):
    rows = []
    if not os.path.isfile(path):
        return rows
`;

const CURSOR_PY_SHARED_B = String.raw`
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        return rows

    return rows


def open_store_db(store_db):
    try:
        return sqlite3.connect(f"file:{store_db}?mode=ro", uri=True)
    except sqlite3.OperationalError:
        # Recent Cursor sessions can keep the DB in a state where plain mode=ro
        # fails, while immutable=1 still gives us a safe snapshot for discovery.
        return sqlite3.connect(f"file:{store_db}?mode=ro&immutable=1", uri=True)


def extract_latest_user_summary_from_db(db):
    try:
        rows = db.execute(
            "SELECT rowid, data FROM blobs WHERE substr(data, 1, 1) = X'7B' ORDER BY rowid DESC LIMIT 200"
        ).fetchall()
    except Exception:
        return None

    for _, raw_data in rows:
        try:
            raw_text = raw_data.decode("utf-8", "replace") if isinstance(raw_data, (bytes, bytearray)) else str(raw_data)
            payload = json.loads(raw_text)
        except Exception:
            continue

        role, content, _ = parse_message_payload(payload)
        if role != "user":
            continue

        summary = summarize_user_text(extract_text(content))
        if summary:
            return summary

    return None


def extract_workspace_path_from_db(db):
    try:
        rows = db.execute(
            "SELECT rowid, data FROM blobs WHERE substr(data, 1, 1) = X'7B' ORDER BY rowid ASC LIMIT 200"
        ).fetchall()
    except Exception:
        return None

    for _, raw_data in rows:
        try:
            raw_text = raw_data.decode("utf-8", "replace") if isinstance(raw_data, (bytes, bytearray)) else str(raw_data)
            payload = json.loads(raw_text)
        except Exception:
            continue

        role, content, _ = parse_message_payload(payload)
        text_candidates = []
        if isinstance(content, (str, list)):
            text_candidates.append(extract_text(content))
        if role == "system" and isinstance(payload.get("content"), (str, list)):
            text_candidates.append(extract_text(payload.get("content")))

        for candidate in text_candidates:
            if not candidate:
                continue
            match = WORKSPACE_RE.search(candidate)
            if match:
                return match.group(1).strip()

    return None


def get_projects_dir(base_dir):
    return os.path.join(os.path.dirname(os.path.normpath(base_dir)), "projects")


def extract_workspace_path_from_worker_log(project_dir):
    worker_log = os.path.join(project_dir, "worker.log")
    workspace_path = None
    if not os.path.isfile(worker_log):
        return None
`;

const CURSOR_PY_SHARED_C = String.raw`
    try:
        with open(worker_log, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                match = WORKSPACE_LOG_RE.search(line)
                if match:
                    workspace_path = match.group(1).strip()
    except Exception:
        return None

    return workspace_path


def summarize_transcript(transcript_path):
    summary = "Untitled Session"
    message_count = 0
    model = None
    latest_user_summary = None

    for payload in read_jsonl(transcript_path):
        role, content, _ = parse_message_payload(payload)
        if role not in ("user", "assistant"):
            continue
        message_count += 1
        if role == "user":
            candidate = summarize_user_text(extract_text(content))
            if candidate:
                latest_user_summary = candidate

        metadata = payload.get("metadata")
        if not model and isinstance(metadata, dict):
            model = metadata.get("model") or metadata.get("modelName")

    if latest_user_summary:
        summary = latest_user_summary

    last_activity = None
    try:
        last_activity = to_iso(os.path.getmtime(transcript_path) * 1000)
    except Exception:
        pass

    return {
        "summary": summary,
        "messageCount": int(message_count or 0),
        "lastActivity": last_activity,
        "model": model,
    }


def find_transcript_paths(base_dir, session_id, workspace=None):
    projects_dir = get_projects_dir(base_dir)
    matches = []
    if not os.path.isdir(projects_dir):
        return matches

    for project_name in sorted(os.listdir(projects_dir)):
        project_dir = os.path.join(projects_dir, project_name)
        if not os.path.isdir(project_dir):
            continue

        transcript_path = os.path.join(project_dir, "agent-transcripts", f"{session_id}.jsonl")
        if not os.path.isfile(transcript_path):
            continue

        workspace_path = extract_workspace_path_from_worker_log(project_dir)
        if workspace and workspace_path and workspace_path != workspace:
            continue

        matches.append((transcript_path, workspace_path))

    return matches


def collect_store_sessions(base_dir):
    result = []
    if not os.path.isdir(base_dir):
        return result
`;

const CURSOR_PY_SHARED_D = String.raw`
    for workspace_hash in sorted(os.listdir(base_dir)):
        workspace_dir = os.path.join(base_dir, workspace_hash)
        if not os.path.isdir(workspace_dir):
            continue

        for session_id in sorted(os.listdir(workspace_dir)):
            session_path = os.path.join(workspace_dir, session_id)
            store_db = os.path.join(session_path, "store.db")
            if not os.path.isfile(store_db):
                continue

            summary = "Untitled Session"
            created_at = None
            last_activity = None
            message_count = 0
            model = None
            workspace_path = None
            metadata = {}
            db = None

            try:
                db = open_store_db(store_db)
                rows = db.execute("SELECT key, value FROM meta").fetchall()
                for key, value in rows:
                    metadata[key] = decode_meta_value(value)

                try:
                    message_count = db.execute("SELECT COUNT(*) FROM blobs WHERE substr(data, 1, 1) = X'7B'").fetchone()[0]
                except Exception:
                    message_count = db.execute("SELECT COUNT(*) FROM blobs").fetchone()[0]

                agent = metadata.get("agent") if isinstance(metadata.get("agent"), dict) else {}
                summary = (
                    extract_latest_user_summary_from_db(db)
                    or metadata.get("title")
                    or metadata.get("sessionTitle")
                    or agent.get("name")
                    or summary
                )
                created_at = to_iso(agent.get("createdAt") or metadata.get("createdAt"))
                model = agent.get("model") or agent.get("lastUsedModel") or metadata.get("model")
                workspace_path = (
                    metadata.get("workspacePath")
                    or agent.get("workspacePath")
                    or extract_workspace_path_from_db(db)
                )
            except Exception:
                pass
            finally:
                if db is not None:
                    try:
                        db.close()
                    except Exception:
                        pass

            try:
                last_activity = to_iso(os.path.getmtime(store_db) * 1000)
            except Exception:
                last_activity = created_at

            if not workspace_path:
                continue

            result.append({
                "sessionId": session_id,
                "workspacePath": workspace_path,
                "summary": summary,
                "messageCount": int(message_count or 0),
                "lastActivity": last_activity or created_at,
                "model": model,
            })

    return result


def collect_transcript_sessions(base_dir):
    result = []
    projects_dir = get_projects_dir(base_dir)
    if not os.path.isdir(projects_dir):
        return result

    for project_name in sorted(os.listdir(projects_dir)):
        project_dir = os.path.join(projects_dir, project_name)
        transcripts_dir = os.path.join(project_dir, "agent-transcripts")
        if not os.path.isdir(project_dir) or not os.path.isdir(transcripts_dir):
            continue

        workspace_path = extract_workspace_path_from_worker_log(project_dir)
        if not workspace_path:
            continue

        for entry in sorted(os.listdir(transcripts_dir)):
            if not entry.endswith(".jsonl"):
                continue

            transcript_path = os.path.join(transcripts_dir, entry)
            session_id = os.path.splitext(entry)[0]
            summary = summarize_transcript(transcript_path)

            result.append({
                "sessionId": session_id,
                "workspacePath": workspace_path,
                "summary": summary.get("summary"),
                "messageCount": summary.get("messageCount"),
                "lastActivity": summary.get("lastActivity"),
                "model": summary.get("model"),
            })

    return result


def merge_sessions(items):
    merged = {}
    for item in items:
        session_id = item.get("sessionId")
        if not session_id:
            continue

        current = merged.get(session_id)
        if current is None:
            merged[session_id] = item
            continue

        current_count = int(current.get("messageCount") or 0)
        next_count = int(item.get("messageCount") or 0)
        current_last = current.get("lastActivity") or ""
        next_last = item.get("lastActivity") or ""

        if next_count > current_count or next_last > current_last:
            merged[session_id] = item

    return list(merged.values())
`;

const CURSOR_PY_SHARED = [
  CURSOR_PY_SHARED_A,
  CURSOR_PY_SHARED_B,
  CURSOR_PY_SHARED_C,
  CURSOR_PY_SHARED_D,
].join('\n');

const LIST_ALL_CURSOR_SESSIONS_PY = String.raw`
${CURSOR_PY_SHARED}

base_dir = os.path.expanduser(sys.argv[1])
result = merge_sessions(collect_store_sessions(base_dir) + collect_transcript_sessions(base_dir))
print(json.dumps(result))
`;

const LOAD_CURSOR_HISTORY_PY = String.raw`
${CURSOR_PY_SHARED}

workspace = sys.argv[1]
session_id = sys.argv[2]
base_dir = os.path.expanduser(sys.argv[3])
workspace_hash = hashlib.md5(workspace.encode("utf-8")).hexdigest()
store_db = os.path.join(base_dir, workspace_hash, session_id, "store.db")
messages = []

if os.path.isfile(store_db):
    db = open_store_db(store_db)
    rows = db.execute(
        "SELECT rowid, data FROM blobs WHERE substr(data, 1, 1) = X'7B' ORDER BY rowid ASC"
    ).fetchall()
    for _, raw_data in rows:
        try:
            raw_text = raw_data.decode("utf-8", "replace") if isinstance(raw_data, (bytes, bytearray)) else str(raw_data)
            payload = json.loads(raw_text)
        except Exception:
            continue

        role, content, timestamp = parse_message_payload(payload)
        emit_message(role, content, timestamp, messages)

    db.close()
else:
    transcript_paths = find_transcript_paths(base_dir, session_id, workspace)
    if not transcript_paths:
        transcript_paths = find_transcript_paths(base_dir, session_id)

    if transcript_paths:
        transcript_path, _ = transcript_paths[0]
        for payload in read_jsonl(transcript_path):
            role, content, timestamp = parse_message_payload(payload)
            emit_message(role, content, timestamp, messages)

print(json.dumps(messages))
`;

const DELETE_CURSOR_SESSION_PY = String.raw`
${CURSOR_PY_SHARED}

workspace = sys.argv[1]
session_id = sys.argv[2]
base_dir = os.path.expanduser(sys.argv[3])
workspace_hash = hashlib.md5(workspace.encode("utf-8")).hexdigest()
session_dir = os.path.join(base_dir, workspace_hash, session_id)
deleted = False

if os.path.isdir(session_dir):
    shutil.rmtree(session_dir, ignore_errors=True)
    deleted = deleted or not os.path.exists(session_dir)

workspace_dir = os.path.join(base_dir, workspace_hash)
if os.path.isdir(workspace_dir):
    try:
        if not os.listdir(workspace_dir):
            os.rmdir(workspace_dir)
    except Exception:
        pass

transcript_paths = find_transcript_paths(base_dir, session_id, workspace)
if not transcript_paths:
    transcript_paths = find_transcript_paths(base_dir, session_id)

for transcript_path, _ in transcript_paths:
    try:
        os.remove(transcript_path)
        deleted = deleted or not os.path.exists(transcript_path)
    except Exception:
        pass

print(json.dumps({"deleted": deleted}))
`;
