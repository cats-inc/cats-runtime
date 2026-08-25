# Antigravity CLI stream-json probe (agy 1.1.20)

Date: 2026-08-25
Scope: prove or disprove that `agy` can be driven by the CLI backend, and if it
can, record the contract the adapter is allowed to encode.

## Why this was reopened

`src/backends/cli/providers/antigravity.ts` refused to build spawn arguments at
all, on the stated grounds that "the raw agy subprocess or stream contract has
not been probed". That refusal traced back to
`docs/research/2026-05-24-antigravity-cli-probe.md`, which says plainly that it
never ran the binary — not even `agy --version` (line 67) — and to
`docs/plans/PLAN-033-replace-gemini-cli-with-antigravity-cli.md:53`, which gated
every code change on "official product documentation, openab `agy-acp` adapter
source, and environment-bootstrap installer scripts. No live `agy` smoke run was
performed."

The consequence was that Antigravity had no usable execution path at all: the
CLI backend refused, and the ACP profile (`agy-acp`) needs a separate openab
binary that is not part of the Antigravity install and is not present on the
machine this was probed from.

`agy --help` on 1.1.20 advertises `--print`, `--output-format
text|json|stream-json`, `--input-format stream-json`, `--conversation`,
`--continue`, `--add-dir`, `--mode`, and `--dangerously-skip-permissions`. That
is the same shape as the Claude and Codex contracts the runtime already drives,
so the refusal was three months out of date.

## Contract as observed

Six live turns against `agy 1.1.20`, Windows native runner.

`stdout` is pure NDJSON — zero non-JSON lines across every capture, including
the permission-denied run. Human-readable warnings go to `stderr` instead:

```
jetski: no output produced — a tool required the "command" permission that
headless mode cannot prompt for, so it was auto-denied.
```

Three event envelopes:

- `{"event":"init","conversation_id":…,"init":{cwd,tools[],permission_mode}}`
- `{"event":"step_update","step_update":{conversation_id, step_index, state,
  step_type, text_delta?, duration_seconds?, usage?, tool_name?, tool_info?}}`
- `{"event":"result","result":{conversation_id, status, response,
  duration_seconds, num_turns, usage}}`

`state` is `ACTIVE` | `DONE` | `ERROR`. `step_type` is `user_input`,
`checkpoint`, `agent_response`, `tool`, or `system_message` (the last appears
only on a resumed turn and carries no text).

Recorded under `docs/research/fixtures/antigravity-1.1.20/`, replayed by
`src/backends/cli/providers/antigravity.fixture.test.ts`.

### text_delta is a delta, not a snapshot

A 20-item counting prompt produced six `agent_response` updates on one
`step_index`, lengths 184 + 210 + 224 + 222 + 211 + 616 = 1667, matching
`result.response.length` exactly. `state` stays `ACTIVE` until the last update,
which is `DONE` and carries `usage`.

### Tool calls correlate on step_index

There is no tool call id. The `ACTIVE` update and its terminal `DONE`/`ERROR`
update share a `step_index`, which is the only stable key. The terminal update
repeats `tool_info.name` and `tool_info.parameters` but carries **no output
payload** — a successful tool result is observable but its content is not
recoverable. A failure carries `tool_info.error.message`, which is the one piece
of tool result text the adapter can surface.

### total_tokens excludes cache_read_tokens

Across all six turns `total_tokens === input_tokens + output_tokens`, and
`cache_read_tokens` is an independent counter that can exceed `input_tokens`
(observed 28485 cache read against 25955 input, total 26767). `thinking_tokens`
is a subset of `output_tokens`. The Grok adapter folds cache figures into
`inputTokens`; doing the same here would overstate every Antigravity turn, so
`normalizeAntigravityUsage` keeps them separate.

## Two traps the adapter has to defend against

### 1. agy ignores the process cwd for its workspace

`init.cwd` faithfully reports the process working directory, but the agent does
not treat it as the workspace. Asked to inspect "the current directory" while
spawned in a temp directory, agy called `list_dir` on
`~/.gemini/antigravity-cli/scratch` — its own built-in scratch area — and then
hit its protection boundary trying to read its parent. `settings.json` carries a
`trustedWorkspaces` list, and directories outside it do not become the
workspace implicitly.

Passing `--add-dir <cwd>` fixes it: the same prompt then called `list_dir` on
the intended directory. The adapter always passes it.

### 2. `--mode accept-edits` writes files while reporting `request-review`

This is the same class of trap as Devin's `accept-edits` default, but worse,
because the stream actively misreports it. Live probe, prompt "create a file
named trap-probe.txt containing the word TRAPPED":

- `--mode accept-edits` → `init.permission_mode` reported **`request-review`**,
  no permission request was ever issued, `write_to_file` completed `DONE` with
  no error, and the file was on disk with the expected contents.

So `init.permission_mode` cannot be trusted as the effective permission state
whenever `--mode` is passed. The adapter therefore never passes `--mode`, and
`antigravity.test.ts` pins that.

The two modes that do behave as labelled:

- no flag → `request-review`, and headless auto-denies every tool with a
  `TOOL_ERROR` step whose message says "user denied permission"
- `--dangerously-skip-permissions` → `always-proceed`

Even under `always-proceed`, agy still enforces hardcoded protection boundaries:
reading `~/.gemini/antigravity-cli` was refused with "Matches hardcoded system
protection boundary rule."

There is no per-invocation allowlist. agy's allow-rules live in the shared user
`settings.json` under `permissions.allow` (for example `command(<target>)`),
which is process-wide state that concurrent sessions share. The adapter refuses
runtime `whitelist` mode rather than rewriting that file for one turn or
silently downgrading to skip.

## A turn that is gutted by permissions still reports SUCCESS

The permission-denied run exited 0 with `result.status: "SUCCESS"` and
`result.response: ""`, even though its only tool call was denied. The failed
tool step is the sole in-band signal; the `jetski:` stderr line is the only
out-of-band one.

`classifyLaunchFailure` matches that stderr line, but note what that does and
does not buy. `maybeFailFastOnLaunchRefusal` returns early once
`launchResponseObserved` is set (`WorkerProcess.ts:511`), and agy emits `init`
within the first second, so on a turn that streams normally the refusal is never
raised — the failed `tool_result` is what the caller sees. The refusal only
fires on a turn that produces no stream events at all. That is the narrow case
it is there for; it is not a general "the tools were denied" signal.

## A rejected turn arrives on stdout, not stderr

An invalid `--model` exits 1 and emits a single stdout line:

```json
{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"",
 "error":"invalid model selection (--model \"x\"): model x is not recognized ...",
 "duration_seconds":0,"num_turns":0,"usage":{...all zero...}}}
```

So `result` carries an `error` field that a healthy turn never has, and the
failure is in-band rather than on stderr. The adapter turns any non-SUCCESS
status into a terminal `error` event carrying that text; reporting it as a
`result` with an empty response would have hidden the reason entirely. The
first version of this adapter guessed at stderr phrasing for model rejection —
that branch was removed once the real shape was observed.

## Sessions on disk

Conversations live at
`~/.gemini/antigravity-cli/conversations/<conversation_id>.db`, one SQLite
database each, in WAL mode.

`conversation_summaries.db` sitting next to that directory looks like the index
to read, and is not: it has exactly the columns a scanner would want
(`conversation_id`, `title`, `preview`, `step_count`, `last_modified_time`,
`workspace_uris`), but agy only writes it for interactive sessions. Across 32
conversations on the probe machine it held one row, for the one interactive
session, and none of the print-mode runs. `history.jsonl` is the same trap — it
records interactive slash commands only.

What the per-conversation databases do expose:

- `trajectory_meta.cascade_id` is the conversation id; it matched the file name
  in 32 of 32 databases.
- `trajectory_metadata_blob.data` is protobuf, but the workspace is stored as a
  literal `file:///` URI inside it, which is recoverable without a schema.
- `steps.step_type` is a plain integer. Replaying three conversations against
  their captured NDJSON gave an exact correspondence: `[14, 23, 15, 132, 15]`
  for one text-plus-tool turn, `[14, 23, 15, 14, 101, 15]` for a text turn plus
  a resume, `[14, 23, 15, 14, 101, 15, 132, 15]` for both. That pins 14 as a
  user message, 15 as an agent message, 23 as a checkpoint, 101 as the resume
  system message, and 132 as a tool call.
- Step payloads are unschema'd protobuf holding the prompt text behind length
  prefixes. The scanner does not mine them: a mangled title is worse than none.

A conversation started **without** `--add-dir` records no working directory at
all — not in the metadata blob, and not in the step payloads, which carry only
the two skills directories. Six of the 32 databases were in that state, all of
them probes run before `--add-dir` was added to the adapter. Such conversations
are surfaced with an empty `cwd` rather than dropped.

Reading these requires python, following the Kiro and Cursor precedent, since
`node:sqlite` still needs `--experimental-sqlite` at the package's Node 22.12
engine floor. Opening with `mode=ro` works even for databases with no `-shm`
file, but `immutable=1` must not be used: it bypasses the WAL and silently
serves a pre-WAL snapshot of a live conversation.

## Models

`agy models` prints one `<id>\t<label>` pair per line after a
`Fetching available models...` status line — 14 entries on 1.1.20. `--model`
takes the id; a rejected id is answered with the *labels*, so the two forms are
not interchangeable on input. There is no default marker in the listing: agy
takes its default from the per-user `settings.json` `model` field, which is why
the bundled catalog marks none of its entries default and the runtime omits
`--model` entirely when no model is selected.

## Resume works; fork does not exist

`--conversation <id>` replays prior turns and keeps the same conversation id
(`num_turns` went 1 → 2 and the agent recalled its earlier answer). Sessions are
stored as `~/.gemini/antigravity-cli/conversations/<conversation_id>.db`, one
SQLite file per conversation. There is no fork flag in 1.1.20, so
`capabilities.fork` stays false and `buildSpawnArgs` refuses a fork request.

A bug found while wiring this: the adapter first published the conversation id
on `providerSessionId`, which is the agent-backend field. The CLI worker reads
session identity off `event.sessionId` for `init`/`result`
(`src/backends/cli/pool/WorkerProcess.ts:575`), so resume silently never
happened. Fixed to `sessionId`.

## Verification

`--probe-provider-evolution --probe-provider antigravity --probe-profile
manual_tool`, replayed through the shipped parser:

```
parserId: antigravity-native-stream-json   version: 1.1.20
execution: {"status":"completed","turnsCompleted":1,"turnsPlanned":1}
capabilities: text=1 toolUse=1 toolResult=1 progress=2 result=1
counters:    {"normalized":5,"ignored":3,"unknown":0,"schemaFailure":0,"rawPassthrough":0}
ignored:     step_update:user_input, step_update:checkpoint, step_update:agent_response
```

Every capability observed, nothing unknown, nothing passed through raw.

`manual_smoke` was not used for the baseline. Its second turn fails with
`Process exited with code 0 before responding` — the same harness symptom
already recorded for Cline at
`docs/research/2026-08-24-grok-cline-version-drift-probe.md:77`, which is why
`manual_tool` was added in the first place. For Cline the cause was
`resume: false`; Antigravity resumes correctly outside the harness, including
immediately after the previous process is killed mid-stream, and the same turn
succeeded inside the harness when the run was slowed down by debug
instrumentation. The failure is timing-dependent and lives in the probe harness,
not in the adapter or the CLI.

## Not covered

- `--input-format stream-json` (multi-message stdin). The adapter drives
  ephemeral `-p` turns, so this was not exercised.
- WSL and Docker runners. Probed native only.
- Auth failure text. `classifyLaunchFailure` guesses at sign-in phrasing that
  was never observed, because the probing account was already signed in.
- Whether `steps.step_type` values are stable across agy releases. They are
  inferred from three replayed conversations on one version, not from a schema.
  A future release could renumber them, which would show up as a wrong message
  count rather than a crash.
