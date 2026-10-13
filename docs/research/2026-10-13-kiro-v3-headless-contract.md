# Kiro V3 headless contract

Date: 2026-10-13. Scope: how Cats launches, resumes, lists, reads and deletes
Kiro sessions on the V3 engine (`src/backends/cli/providers/kiro.ts`,
`src/backends/cli/kiro/KiroNativeSessionService.ts`). Kiro CLI 2.30.0
(`kiro-cli-chat 2.30.0`) on native Windows 11, `chat.agentEngine` saved as `v3`.
Decision: [ADR-045](../decisions/045-drive-kiro-through-the-v3-headless-engine.md).

## Why

Kiro 2.30.0 offers every V2 user the switch to V3 at startup, and Kiro's
announcement of 2026-10-09 says CLI 3.0 makes V3 the default at the end of
October 2026 and retires Classic. Cats ran Kiro on the V1 engine
([2026-09-28](./2026-09-28-kiro-v2-ignores-model.md)), parsed plain text and read
sessions from SQLite through python. The operator asked for V3 only.

## Probes

Eight `kiro-cli chat --no-interactive --agent-engine v3 --output-format
stream-json` runs in scratch directories, about 0.5 credits in total, each
deleted afterwards with `--delete-session`. Redacted captures are in
[`fixtures/kiro-2.30.0/`](./fixtures/kiro-2.30.0/).

1. **Text turn** (`--model claude-sonnet-4.5 --trust-tools=`):
   `headless-stream.text-turn.redacted.jsonl`. 0.089 credits.
2. **Resume by id from the same and from another directory** (`--resume-id`):
   `headless-stream.resume-from-other-cwd.redacted.jsonl`. Both answered from
   the first turn's context. `session.json` then listed both directories under
   `rootPaths`.
3. **Tool turn** (`--trust-all-tools`, read a file):
   `headless-stream.tool-turn.redacted.jsonl` and the resulting store in
   `session-store/`.
4. **Write without a trust flag**: `headless-stream.denied-write.redacted.jsonl`
   and `stderr.denied-write.redacted.txt`.
5. **Write with `--trust-tools=fs_write`**: the file was written; the tool call
   passed through `waiting_on_user` and `completed`.
6. **Effort** (`--model gpt-5.6-luna --effort low`):
   `headless-stream.effort-low.redacted.jsonl`; `session.json` recorded
   `effortLevel: "low"`. `--effort low` on `claude-sonnet-4.5` warned
   `model 'claude-sonnet-4.5' offers no effort levels` and continued
   (`stderr.effort-unavailable.redacted.txt`).
7. **Prompt on stdin** with no positional argument: a two-line prompt arrived
   intact in the stored user message.
8. **List and delete**: `list-sessions.all-cwds.redacted.json`;
   `--delete-session <id>` removed the session directory and its index entry
   from any working directory and printed `✔ Deleted chat session <id>`.
9. **`--all-cwds` and V3**: with a V3 session present in a directory,
   `--list-sessions --format json` run there listed it (`source: v3`) beside the
   directory's V2 session, while `--list-sessions --all-cwds --format json` from
   the same directory listed only V2 sessions. The flag's help text says
   "local stores only"; on 2.30.0 that means the V1/V2 stores.

## Stream

One JSON object per line on stdout. Kiro's own logs go to stderr as
`[INFO]`, `[warn]`, `[denied]` and `[ERROR]` lines.

- `{"type":"runStarted","data":{"payloadSchema":"acp","acpProtocolVersion":1,"engine":"v3"}}`
- `{"type":"sessionUpdate","data":{"sessionId":"sess_<uuid>","update":{...}}}`,
  where `update` is a verbatim ACP `session/update` body:
  - `available_commands_update`, `config_option_update` (twice at start; the
    second carries the requested model as `currentValue`);
  - `config_option_update` lists every model as an option with
    `_meta.kiro.{rateMultiplier,rateUnit,hasEffort,effortLevels,defaultEffortLevel,thinkingToggleable}`,
    and, for a model with effort, an `effortLevel` option with its levels;
  - `agent_message_chunk` with `content: {type:'text', text}` deltas;
  - `agent_thought_chunk` for thinking models (not observed with these models;
    mapped by the ACP shape);
  - `tool_call` with `toolCallId`, `title` (`Read File`, `Write File`),
    `kind` (`read`, `edit`), `locations`, `rawInput`, and `_meta.kiro.preview`
    for an edit;
  - `tool_call_update` with `status` `pending`, `in_progress`,
    `waiting_on_user`, `completed` or `failed`, `content` blocks
    (`{type:'content', content:{type:'text', text}}` or
    `{type:'diff', path, oldText, newText}`) and `rawOutput.message`;
  - `session_info_update` keyed by `_meta.kiro.kind`: `context_usage`
    (`usagePercentage`, `breakdown`), `focus_update` (title and status),
    `user_message_id_assigned`, `turn_start`, `turn_completion`
    (`promptTurnSummaries[].usage` in credits, `elapsedTime` in ms,
    `requestIds`, `status`), `turn_end` (`stopReason`).
- `{"type":"runFinished","data":{"sessionId","status":"success","stopReason":"end_turn","finalText","finalTextTruncated"}}`.
  `finalText` is the concatenation of the text chunks.

Kiro's headless documentation says an interrupted run writes a final
interruption record; its shape was not observed. The adapter treats any
top-level frame with a `message` or an `error`/`interrupted` type as an error.

## Permissions

`[denied] tool permission approval is not supported in non-interactive mode. Use
--trust-all-tools to auto-approve.` on stderr, and the tool call ends `failed`
with `rawOutput.message` `The user rejected this tool call.`; the turn still
completes with `status: success`. `--trust-tools` takes Kiro's internal tool
ids (`fs_write` worked; the transcript names the read tool `read_file`).

## Session store

- `~/.kiro/sessions/<workspace hash>/sess_<uuid>/session.json`,
  `messages.jsonl`, `publish.cursor`; `~/.kiro/session-index/<hash>.jsonl`
  with `{"op":"add","sessionPath":"<hash>/sess_...","at":<ms>}`;
  `~/.kiro/session-index/.migration-v3`. The V2 store stays in
  `~/.kiro/sessions/cli/`.
- `session.json`: `schemaVersion` `1.0.0`, `dataModelVersion` 1, `id`,
  `title`, `agentMode`, `workspacePaths`, `rootPaths`, `createdAt`,
  `lastModifiedAt`, `modelId`, `effortLevel` (when set), `autopilot`, `status`.
- `messages.jsonl`: `{id, timestamp, payload}` with `payload.type` `agent_note`
  (the context snapshot), `user` (`content`), `turn_start`, `assistant`
  (`content`, `operationType: 'Say'`), `tool_call` (`toolCallId`, `toolName`,
  `args`, `status`, `kind`, `title`), `tool_result` (`content`, `success`),
  `session_metadata`, `usage_summary` (same fields as `turn_completion`),
  `session_event`, `turn_end`, `session_start` (Kiro's system prompt; elided
  from the fixture).
- Kiro documents the layout as private and `session/list` or `--list-sessions`
  as the way to enumerate. Neither enumerates V3 sessions across directories
  from a headless process (probe 9), so the runtime enumerates the store's
  `session.json` files and guards on `schemaVersion`.

## `--list-sessions --format json`

An array of `{cwd, sessions, complete}`; each session has `sessionId`,
`source` (`v2` or `v3`), `title`, `updatedAt` and, for V3, `executionTarget`
and `status`; V2 entries carry `messageCount` instead. Windows directories may
arrive in extended-length form (`\\?\C:\...`). Without `--all-cwds` it covers
the current directory; with it, only the V1/V2 stores. 1.4 s on this machine.

## Change

- `KiroProvider` runs V3 headless, prompt on stdin, `--resume-id`, and maps the
  stream to `init`, `text`, `progress` (reasoning), `tool_use`, `tool_result`,
  `result` (with `reportedModels` from `config_option_update`) and `error`.
  `permissions: false`.
- `KiroNativeSessionService` enumerates and reads the V3 store, natively or
  through the runtime's shell, and deletes through the CLI in the instance's
  runtime. `sessions_dir` / `KIRO_SESSIONS_DIR` replace `db_path` /
  `KIRO_DB_PATH`. The python scripts, the SQLite reader and the V2 file reader
  are gone, with the `workspace_latest` session ownership and the
  `latest_in_workspace` resume strategy.
- Compatibility profile `kiro-cli-chat-v3` requires the `--agent-engine` and
  `--output-format` help tokens.

## Open

- The catalog's Kiro effort rows were captured from the 2.27.1 picker;
  `config_option_update` now gives the same rows with explicit
  `defaultEffortLevel` values. The catalog refresh is a separate data change.
- `--trust-tools` ids are Kiro's internal names; a Cats allowlist written in
  ACP display names (`Read File`) would not match.
- `agent_thought_chunk` and the interruption record are mapped from Kiro's ACP
  documentation, not from a capture.
