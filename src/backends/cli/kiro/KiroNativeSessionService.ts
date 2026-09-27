import { spawn } from 'node:child_process';
import { isWslDistroRunning, type WslDistroInspector } from '../discovery/wslDiscovery.js';
import type { CommandRunnerOptions } from '../pythonScripts.js';
import { runPythonJsonScript, spawnCommandRunner, type CommandRunner } from '../pythonScripts.js';
import type { RuntimeAdapter } from '../runtime/runtime.js';
import {
  createRuntimeAdapter,
} from '../runtime/runtime.js';
import { defaultKiroDbPath } from '../config.js';
import { hiddenWindowsSpawnOptions } from '../../../core/process/windowsSpawn.js';

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

export type KiroCommandRunner = CommandRunner;
export interface KiroSessionListOptions {
  startIfNeeded?: boolean;
}

export interface KiroNativeSessionServiceOptions {
  command: string;
  dbPath: string;
  /** Kiro 2.24+ session files; defaults to `~/.kiro/sessions/cli` in the runtime's home. */
  sessionsDir?: string;
  runtime: RuntimeAdapter;
  runner?: KiroCommandRunner;
  wslInspector?: WslDistroInspector;
}

// Kiro 2.24 moved sessions out of data.sqlite3 into one metadata file
// (<id>.json, with the session's cwd) and one transcript (<id>.jsonl) each.
const DEFAULT_KIRO_SESSIONS_DIR = '~/.kiro/sessions/cli';

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
  private readonly sessionsDir: string;
  private readonly runtime: RuntimeAdapter;
  private readonly runner: KiroCommandRunner;
  private readonly wslInspector: WslDistroInspector;

  constructor(options: KiroNativeSessionServiceOptions) {
    this.command = options.command;
    this.dbPath = options.dbPath;
    this.sessionsDir = options.sessionsDir || DEFAULT_KIRO_SESSIONS_DIR;
    this.runtime = options.runtime;
    this.runner = options.runner || spawnCommandRunner;
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
      this.sessionsDir,
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
      this.sessionsDir,
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
      this.sessionsDir,
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
    return runPythonJsonScript<T>({
      runtime: this.runtime,
      runner: this.runner,
      script,
      args,
      commandLabel: 'Kiro native command',
      parseLabel: 'Kiro session',
    });
  }
}

export function normalizeKiroWorkspacePath(cwd: string): string {
  return new KiroNativeSessionService({
    command: 'kiro-cli',
    dbPath: defaultKiroDbPath(),
    runtime: createRuntimeAdapter({
      mode: 'native',
    }),
    runner: async () => ({ code: 0, stdout: '', stderr: '' }),
  }).normalizeWorkspace(cwd);
}


const KIRO_PY_SHARED = String.raw`
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone


def workspace_key_candidates(workspace):
    # Kiro stores the raw OS path as the conversations_v2.key value, so on
    # Windows the stored key keeps backslashes. Callers hand us paths after
    # toRuntimePath, which normalizes them to forward slashes, producing a
    # mismatch against the stored key. Try every separator variant so the
    # match works regardless of which form the caller used.
    seen = set()
    ordered = []
    for candidate in (workspace, workspace.replace("\\", "/"), workspace.replace("/", "\\")):
        if candidate not in seen:
            seen.add(candidate)
            ordered.append(candidate)
    return ordered


def resolve_stored_key(db, conversation_id, workspace):
    # Resolve the caller's workspace to the exact key the row was written
    # under, so downstream SELECT/DELETE operate on one deterministic row.
    # If the DB ever contains the same conversation under multiple separator
    # forms (belt and suspenders — Kiro itself should not do this), we pick
    # the first candidate in order rather than touching every match.
    candidates = workspace_key_candidates(workspace)
    placeholders = ",".join("?" * len(candidates))
    stored = {
        row[0]
        for row in db.execute(
            f"SELECT key FROM conversations_v2 WHERE conversation_id = ? AND key IN ({placeholders})",
            (conversation_id, *candidates),
        ).fetchall()
    }
    for candidate in candidates:
        if candidate in stored:
            return candidate
    return None


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
    # Kiro 2.24 writes nanoseconds; fromisoformat before Python 3.11 takes at most six digits.
    text = re.sub(r"(\.\d{6})\d+", r"\1", text)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat().replace("+00:00", "Z")
    except Exception:
        return text


def activity_epoch(iso_text):
    if not iso_text:
        return 0.0
    try:
        return datetime.fromisoformat(iso_text.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


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


def list_database_sessions(db_path):
    # Kiro before 2.24 keeps conversations here; a newer install may have no database.
    if not os.path.isfile(db_path):
        return []
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = db.execute(
            "SELECT key, conversation_id, value, created_at, updated_at FROM conversations_v2 ORDER BY updated_at DESC"
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    finally:
        db.close()
    return [parse_session_row(row) for row in rows]


def read_json_file(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def strip_verbatim_prefix(path):
    # Windows extended-length form, as in \\?\C:\...
    if isinstance(path, str) and path.startswith("\\\\?\\"):
        return path[4:]
    return path


def read_store_session(store, session_id):
    # (metadata, workspace) of a Kiro 2.24+ session file, or None.
    if not isinstance(session_id, str) or not session_id or session_id in (".", ".."):
        return None
    if "/" in session_id or "\\" in session_id:
        return None
    meta = read_json_file(os.path.join(store, session_id + ".json"))
    if not isinstance(meta, dict) or meta.get("session_id") != session_id:
        return None
    workspace = strip_verbatim_prefix(meta.get("cwd"))
    if not isinstance(workspace, str) or not workspace:
        return None
    return meta, workspace


def store_text(content):
    parts = []
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("kind") == "text" and isinstance(item.get("data"), str):
                parts.append(item["data"])
    return "\n".join(parts).strip()


def load_store_messages(store, session_id):
    messages = []
    try:
        handle = open(os.path.join(store, session_id + ".jsonl"), "r", encoding="utf-8")
    except OSError:
        return messages
    with handle:
        for line in handle:
            entry = safe_json(line, None)
            if not isinstance(entry, dict) or not isinstance(entry.get("data"), dict):
                continue
            data = entry["data"]
            text = store_text(data.get("content"))
            if not text:
                continue
            if entry.get("kind") == "Prompt":
                meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
                messages.append({"role": "user", "text": text, "timestamp": to_iso(meta.get("timestamp"))})
            elif entry.get("kind") == "AssistantMessage":
                messages.append({"role": "assistant", "text": text, "timestamp": None})
    return messages


def store_model(meta):
    state = meta.get("session_state") if isinstance(meta.get("session_state"), dict) else {}
    conversation = state.get("conversation_metadata")
    turns = conversation.get("user_turn_metadatas") if isinstance(conversation, dict) else None
    if isinstance(turns, list):
        for turn in reversed(turns):
            model = turn.get("model") if isinstance(turn, dict) else None
            if isinstance(model, str) and model.strip():
                return model.strip()
    rts = state.get("rts_model_state")
    info = rts.get("model_info") if isinstance(rts, dict) else None
    model = info.get("model_id") if isinstance(info, dict) else None
    if isinstance(model, str) and model.strip():
        return model.strip()
    return None


def list_store_sessions(store):
    try:
        names = os.listdir(store)
    except OSError:
        return []
    sessions = []
    for name in names:
        if not name.endswith(".json"):
            continue
        found = read_store_session(store, name[:-len(".json")])
        if found is None:
            continue
        meta, workspace = found
        prompts = [
            message["text"]
            for message in load_store_messages(store, meta["session_id"])
            if message["role"] == "user"
        ]
        title = meta.get("title") if isinstance(meta.get("title"), str) else None
        sessions.append({
            "sessionId": meta["session_id"],
            "workspacePath": workspace,
            "summary": summarize_prompt(prompts[-1] if prompts else title) or "Untitled Session",
            "messageCount": len(prompts),
            "lastActivity": to_iso(meta.get("updated_at")) or to_iso(meta.get("created_at")),
            "model": store_model(meta),
        })
    return sessions
`;

const LIST_ALL_KIRO_SESSIONS_PY = String.raw`
${KIRO_PY_SHARED}

db_path = os.path.expanduser(sys.argv[1])
store = os.path.expanduser(sys.argv[2])

result = list_database_sessions(db_path) + list_store_sessions(store)
result.sort(key=lambda session: activity_epoch(session.get("lastActivity")), reverse=True)
print(json.dumps(result))
`;

const LOAD_KIRO_HISTORY_PY = String.raw`
${KIRO_PY_SHARED}

db_path = os.path.expanduser(sys.argv[1])
store = os.path.expanduser(sys.argv[2])
workspace = sys.argv[3]
conversation_id = sys.argv[4]

found = read_store_session(store, conversation_id)
if found is not None:
    matched = found[1] in workspace_key_candidates(workspace)
    print(json.dumps(load_store_messages(store, conversation_id) if matched else []))
    raise SystemExit(0)

if not os.path.isfile(db_path):
    print("[]")
    raise SystemExit(0)

db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
matched_key = resolve_stored_key(db, conversation_id, workspace)
if matched_key is None:
    db.close()
    print("[]")
    raise SystemExit(0)

row = db.execute(
    "SELECT value FROM conversations_v2 WHERE conversation_id = ? AND key = ?",
    (conversation_id, matched_key),
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
store = os.path.expanduser(sys.argv[2])
workspace = sys.argv[3]
conversation_id = sys.argv[4]

found = read_store_session(store, conversation_id)
if found is not None:
    deleted = False
    if found[1] in workspace_key_candidates(workspace):
        # Kiro manages the .lock file. The metadata goes last, so a failed
        # removal leaves the session listed and the upper-layer verify fails.
        for suffix in (".jsonl", ".history", ".json"):
            path = os.path.join(store, conversation_id + suffix)
            if os.path.isfile(path):
                os.remove(path)
                deleted = True
    print(json.dumps({"deleted": deleted}))
    raise SystemExit(0)

if not os.path.isfile(db_path):
    print(json.dumps({"deleted": False}))
    raise SystemExit(0)

db = sqlite3.connect(db_path)
# Scope: conversation_id (a globally unique UUID — different separator forms
# of the same conv_id represent the same logical session) AND only the
# caller-provided workspace's separator variants. This never fans across
# unrelated conv_ids or unrelated paths. Clearing every variant keeps the
# DELETE and the upper-layer verify in sync: once the DB is mutated, no row
# with this conv_id under this workspace should remain, so listSessions-based
# verification and the next native discovery both agree the session is gone.
candidates = workspace_key_candidates(workspace)
placeholders = ",".join("?" * len(candidates))
cursor = db.execute(
    f"DELETE FROM conversations_v2 WHERE conversation_id = ? AND key IN ({placeholders})",
    (conversation_id, *candidates),
)
deleted = cursor.rowcount > 0
db.commit()
db.close()

print(json.dumps({"deleted": deleted}))
`;
