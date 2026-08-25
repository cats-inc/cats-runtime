import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runPythonJsonScript, spawnCommandRunner, type CommandRunner } from '../pythonScripts.js';
import { createRuntimeAdapter } from '../runtime/runtime.js';
import type { DiscoveredSession } from './types.js';

/**
 * Scan Antigravity CLI conversations stored under
 * `~/.gemini/antigravity-cli/conversations/<conversation_id>.db`.
 *
 * Every conversation is its own SQLite database, so this scanner cannot read
 * the directory with `fs` the way the JSON-backed provider scanners do. It
 * shells out to one python process per scan — the same mechanism the Kiro and
 * Cursor native session services already use — which reads every database in a
 * single pass.
 *
 * What is readable and what is not:
 *
 * - `trajectory_meta.cascade_id` is the conversation id and matched the file
 *   name in all 32 databases on the probe machine. The file name is used as the
 *   identity and the column as a consistency check, so a half-written database
 *   cannot register a session under the wrong id.
 * - `steps.step_type` is a plain integer column. Replaying three recorded
 *   conversations against their captured NDJSON streams pinned the values this
 *   scanner relies on: 14 is a user message and 15 an agent message (23 is a
 *   checkpoint, 101 a resume system message, 132 a tool call).
 * - Everything else in the file is unschema'd protobuf. The one field worth
 *   digging out is the workspace, which appears as a literal `file:///` URI
 *   inside `trajectory_metadata_blob`. No attempt is made to recover titles or
 *   message text from the step payloads; a mangled summary is worse than none.
 *
 * A conversation started without `--add-dir` records no workspace at all — not
 * in the metadata blob and not in the step payloads. The runtime always passes
 * `--add-dir`, so its own conversations always carry one, but conversations
 * created outside the runtime can arrive with an empty `cwd` rather than being
 * dropped.
 */
export class AntigravitySessionScanner {
  private readonly conversationsDir: string;
  private readonly runner: CommandRunner;

  constructor(conversationsDir: string, options: { runner?: CommandRunner } = {}) {
    this.conversationsDir = conversationsDir;
    this.runner = options.runner || spawnCommandRunner;
  }

  async scan(): Promise<DiscoveredSession[]> {
    // Starting python is expensive on Windows — a temp dir, a script write, and
    // an interpreter probe before anything is read — and a FileWatcher calls
    // this on every start and every debounced change. The other file-backed
    // scanners cost nothing when their directory is absent or empty, so this
    // one pays a cheap readdir first and only shells out when there is
    // something to read.
    if (!(await hasConversationDatabase(this.conversationsDir))) {
      return [];
    }

    let rows: RawAntigravityConversation[];
    try {
      rows = await runPythonJsonScript<RawAntigravityConversation[]>({
        // Host-side discovery hands this scanner a path the host process can
        // read directly (a UNC path for WSL instances), so the reader always
        // runs natively rather than inside the provider's runtime.
        runtime: createRuntimeAdapter({ mode: 'native' }),
        runner: this.runner,
        script: LIST_ANTIGRAVITY_CONVERSATIONS_PY,
        args: [this.conversationsDir],
        commandLabel: 'Antigravity conversation scan',
        parseLabel: 'Antigravity conversation',
      });
    } catch {
      // A missing directory, an absent python, or a corrupt database must not
      // take down the watcher that owns this scanner.
      return [];
    }

    if (!Array.isArray(rows)) {
      return [];
    }

    const discovered: DiscoveredSession[] = [];
    for (const row of rows) {
      const providerSessionId = readString(row?.conversationId);
      if (!providerSessionId) {
        continue;
      }

      const cwd = workspaceUriToPath(readString(row?.workspaceUri));
      discovered.push({
        providerSessionId,
        projectPath: this.conversationsDir,
        sourcePath: join(this.conversationsDir, `${providerSessionId}.db`),
        cwd: cwd ?? '',
        ...(typeof row?.messageCount === 'number' ? { messageCount: row.messageCount } : {}),
        ...(readString(row?.lastActivity) ? { lastActivity: row.lastActivity as string } : {}),
      });
    }

    return discovered;
  }
}

async function hasConversationDatabase(directory: string): Promise<boolean> {
  try {
    return (await readdir(directory)).some((entry) => entry.endsWith('.db'));
  } catch {
    return false;
  }
}

interface RawAntigravityConversation {
  conversationId?: unknown;
  workspaceUri?: unknown;
  messageCount?: unknown;
  lastActivity?: unknown;
}

/**
 * Turn a `file:///C:/dir` or `file:///home/user/dir` URI into a filesystem
 * path. Anything that is not a `file://` URI is discarded rather than guessed
 * at, so a stray printable run inside the protobuf blob cannot become a cwd.
 */
export function workspaceUriToPath(uri: string | undefined): string | undefined {
  if (!uri || !uri.startsWith('file:///')) {
    return undefined;
  }

  let path: string;
  try {
    path = decodeURIComponent(uri.slice('file://'.length));
  } catch {
    return undefined;
  }

  // `file:///C:/x` decodes to `/C:/x`; drop the leading slash for drive paths.
  const windowsDrive = /^\/([A-Za-z]:\/)/.exec(path);
  if (windowsDrive) {
    path = path.slice(1);
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

const LIST_ANTIGRAVITY_CONVERSATIONS_PY = String.raw`
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone

# The workspace is stored as a literal URI inside an unschema'd protobuf blob.
# Anchoring on the scheme keeps the match to something that can be validated on
# the TypeScript side rather than any printable run in the blob.
WORKSPACE_URI = re.compile(rb"file:///[\x20-\x7e]{2,400}")

# Verified against captured NDJSON streams: a conversation's steps replay in the
# same order the CLI emitted them, and these two types are the message-bearing
# ones.
USER_STEP_TYPE = 14
AGENT_STEP_TYPE = 15


def read_conversation(path):
    # mode=ro without immutable: agy keeps these databases in WAL mode, and
    # immutable=1 would silently serve a pre-WAL snapshot of a live conversation.
    db = sqlite3.connect("file:" + path.replace("?", "%3f") + "?mode=ro", uri=True)
    try:
        cascade_id = None
        row = db.execute("SELECT cascade_id FROM trajectory_meta LIMIT 1").fetchone()
        if row and isinstance(row[0], str) and row[0]:
            cascade_id = row[0]

        workspace_uri = None
        row = db.execute(
            "SELECT data FROM trajectory_metadata_blob ORDER BY id LIMIT 1"
        ).fetchone()
        if row and row[0]:
            match = WORKSPACE_URI.search(row[0])
            if match:
                workspace_uri = match.group(0).decode("utf-8", "replace")

        message_count = db.execute(
            "SELECT COUNT(*) FROM steps WHERE step_type IN (?, ?)",
            (USER_STEP_TYPE, AGENT_STEP_TYPE),
        ).fetchone()[0]

        return cascade_id, workspace_uri, message_count
    finally:
        db.close()


def main():
    directory = sys.argv[1]
    try:
        names = sorted(os.listdir(directory))
    except OSError:
        print("[]")
        return

    out = []
    for name in names:
        if not name.endswith(".db"):
            continue
        conversation_id = name[:-3]
        full = os.path.join(directory, name)
        try:
            cascade_id, workspace_uri, message_count = read_conversation(full)
        except Exception:
            # One unreadable conversation must not hide the rest.
            continue

        # The file name is the identity, but a database that names a different
        # conversation is not trustworthy enough to import.
        if cascade_id is not None and cascade_id != conversation_id:
            continue

        try:
            mtime = os.path.getmtime(full)
            last_activity = datetime.fromtimestamp(mtime, timezone.utc).isoformat()
        except OSError:
            last_activity = None

        out.append({
            "conversationId": conversation_id,
            "workspaceUri": workspace_uri,
            "messageCount": message_count,
            "lastActivity": last_activity,
        })

    print(json.dumps(out))


main()
`;
