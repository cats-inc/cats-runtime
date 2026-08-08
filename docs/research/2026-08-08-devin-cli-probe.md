# Devin CLI Probe — 3000.3.27

Date: 2026-08-08
Scope: SPEC-027 / PLAN-034 Phase 1 for the `devin` provider family, and Probe Item P1
(the ADR-023 classification question).
Host: Windows 11, `devin.exe` at `%LOCALAPPDATA%\devin\cli\bin\devin.exe`.
Account: signed in (`devin auth status` → "Logged in (via Devin)").

## P1 resolved — Devin executes locally and stays a CLI family

ADR-033 §8 registered `devin` as a CLI provider family on the strength of the upstream
description, and recorded the reversal condition: if a probe showed it only orchestrates
remote sessions, it would move to a management adapter under ADR-023.

**It does not.** `devin --help` opens with "A fast and minimal agent that lives both in your
terminal and in the cloud", and the local agent surface is substantial:

- `-p/--print [PROMPT]` — non-interactive local turn
- `--permission-mode` — `auto` | `accept-edits` | `smart` | `dangerous`
- `--sandbox` — OS-level process sandboxing for the exec tool (macOS seatbelt, Linux bwrap+seccomp)
- `--model`, `--agent-config`, `--export`, `-c/--continue`, `-r/--resume [SESSION_ID]`

The remote surface is a *separate* `cloud` subcommand ("Manage Devin Cloud resources"). So
the two concerns are cleanly split in the CLI itself, and the ADR-023 reclassification is
not triggered. No follow-up ADR is needed.

## The blocking finding — there is no machine-readable output mode

`devin --print` emits **plain prose only**:

```
$ devin --respect-workspace-trust false -p "Reply with exactly: OK"
OK
```

There is no `--output-format`, no `--json`, and no stream flag anywhere in the long help.
The only JSON mentions are `--config` (a config file path) and `--agent-config` (a
declarative agent definition) — both inputs, not outputs.

This is decisive for the CLI backend. Without structured output the runtime cannot recover
tool calls, tool results, token usage, or session identity; it would get a single opaque
string per turn. That is materially worse than Grok's `streaming-json` or Cline's `--json`
NDJSON, and it is not a gap a parser can close.

**`devin` therefore ships install-tier only on the CLI backend, and its execution adapter
refuses.** This is not a "not yet probed" refusal like Antigravity's — it is a probed and
settled one.

## The structured path is ACP, which is an agent-backend concern

`devin acp` runs "an ACP (Agent Client Protocol) server over stdio", with `--agent-type`
(`summarizer`, `review`) and `--model` options. That is the transport the runtime should use
for Devin execution, and it belongs under ADR-031's agent backend, not the CLI backend.

Devin exposes ACP as a **subcommand of the same binary** (`devin acp`) rather than as a
separate `*-acp` binary.

*(Correction to the first version of this note, which claimed every existing profile keys on
a separate binary and that Devin would therefore need new detection machinery. That was
wrong: `resolveAcpProviderProfile` already computes `hasAcpSubcommand`, and `opencode acp`,
`kilo acp`, `goose acp`, and `kiro-cli acp` all use it. Devin needed no new machinery.)*

### Verified handshake

A live ACP session was driven against `devin acp` over stdio using the same request shapes
`AcpAdapter` sends.

`initialize` (with the runtime's `protocolVersion: 1`) returned:

- `protocolVersion: 1` — matches `DEFAULT_ACP_PROTOCOL_VERSION`, so no version negotiation
  gap.
- `agentCapabilities.loadSession: true` — **session loading is supported**, which the CLI
  surface could not offer.
- `promptCapabilities`: `image: true`, `audio: false`, `embeddedContext: true`.
- `sessionCapabilities`: `list`, `delete`, `additionalDirectories`.
- `authMethods`: `[{ id: 'devin-browser', name: 'Log in with browser' }]`.
- `agentInfo`: `{ name: 'affogato', title: 'Devin Agent', version: '0.0.0-dev' }`.
- Vendor extensions under `_meta` as `cognition.ai/*` flags (multiRootWorkspace,
  sessionRename, documentLifecycle, userEdits, terminalLifecycle, megaplan, …).

`session/new` returned `sessionId: "stump-mask"` (human-readable, not a UUID) plus a `modes`
block: `currentModeId: "accept-edits"` with `accept-edits` (Code), `ask` (Ask), `plan`
(Plan), and `bypass` (Bypass Permissions). The server also pushes `session/update`
notifications carrying `available_commands_update`.

Those four modes are the natural mapping target for the runtime's permission modes, and are
strictly richer than what the CLI backend could express — note that Cline, by contrast, had
only a global on/off.

### Operational note — stderr is noisy

`devin acp` writes continuous INFO-level tracing to stderr (`chisel: …`, one line per
lifecycle step) and also logs to
`%APPDATA%\devin\cli\logs\devin_<timestamp>_<pid>.log`. Any launch-failure
classification that scans stderr must not treat this traffic as error output.

## Install tier

- Binary `devin`. Windows `%LOCALAPPDATA%\devin\cli\bin\devin.exe`; Unix `~/.local/bin/devin`
  with versions under `$XDG_DATA_HOME/devin/cli/_versions`.
- `devin --version` → `devin 3000.3.27 (0becb483)`. Note the **`devin ` prefix and trailing
  commit hash** — this is not a bare semver string, unlike Cline's `3.0.51`. Any exact-version
  pinning must parse it rather than compare literally.
- Installers: `irm https://static.devin.ai/cli/setup.ps1 | iex` (Windows, PowerShell-only)
  and `curl -fsSL https://cli.devin.ai/install.sh | bash` (Unix).

### Authentication — correcting SPEC-027 §5

SPEC-027 §5 specified the auth hint should name `devin setup`. That is incomplete. The CLI
has both:

- `devin auth login` / `logout` / `status` — the actual authentication commands.
- `devin setup` — a broader interactive setup wizard.

`devin auth status` reports the credential file (`%APPDATA%\devin\credentials.toml` on this
host), the API server, and the webapp/API endpoints. The knowledge entry now names
`devin auth login` first and mentions the wizard second, and `devin auth status` is the
cheap way to check state after a packaged install stripped the interactive step.

Environment variables observed in help: `DEVIN_MODEL`, `DEVIN_PERMISSION_MODE`,
`DEVIN_SANDBOX`. None is a credential, so `auth.envVars` stays empty.

### Workspace trust — a real spawn hazard

`--respect-workspace-trust` defaults to true in every mode, and the help is explicit:

> Non-interactive (print) mode cannot show the trust prompt and fails in an untrusted
> directory; pass `--respect-workspace-trust false` to skip the check.

The runtime spawns into arbitrary workspaces, including fresh worktrees, which will not be
trusted. Any future Devin execution path — CLI or ACP — has to decide this explicitly rather
than inherit the default, and the probe run above needed the flag to work at all.

## Models

`devin models list` enumerates **37 model families** with aliases, context windows, and
per-MTok pricing (e.g. `claude-opus-5` with alias `opus`, variants
`claude-opus-5-{low,medium,high,xhigh,max}` and `-fast` counterparts). This is real
enumerable catalog evidence, unlike Cline.

No ids are bundled yet: the runtime cannot execute Devin through the CLI backend, so
bundling a selectable-looking model list would imply a capability that does not exist. The
playground exposes only the `devin-default` sentinel. When the ACP path lands, this command
is the source to populate from.

### session/prompt — the execution contract

Two turns were driven end to end (text-only, and one forcing a file read).

`session/prompt` returns `{ stopReason, usage, _meta }`, e.g.
`{"stopReason":"end_turn","usage":{"totalTokens":10078,"inputTokens":10072,"outputTokens":6,
"cachedReadTokens":9878,"cachedWriteTokens":191}}`. **Usage is reported over ACP**, which the
CLI backend could not provide at all.

`session/update` types observed, all of which `AcpAdapter` already handles:
`session_info_update`, `config_option_update`, `current_mode_update`,
`available_commands_update`, `agent_message_chunk`, `usage_update`, `tool_call`,
`tool_call_update`. No adapter change was needed for any of them.

Shapes worth noting:

- `tool_call` → `{ toolCallId, title: "Read file", kind: "read", locations: [{path}],
  _meta: {"cognition.ai/inferenceToolName": "read"} }`. Note it carries `title`/`kind`/
  `locations` rather than a raw input blob.
- `tool_call_update` arrives twice — first `{status}`, then `{status, content}`.
- `usage_update` is context-window occupancy, not per-turn cost: `{ used, size }` with token
  counts tucked under vendor `_meta` keys (`cognition.ai/inputTokens`, `…/cachedReadTokens`).
  The authoritative per-turn usage is the `session/prompt` result.

Two vendor notifications sit outside the ACP spec and are ignored as unknown methods:
`_cognition.ai/mcp/serversChanged` and `_cognition.ai/agent_stopped` (the latter carries
useful stats — `toolCalls`, `filesChanged`, `commandsRun`, `ttftMs`, `tokensPerSec`,
`modelLabel`).

No `session/request_permission` was issued in either turn: the default `accept-edits` mode
auto-approved the read. Permission-prompt behavior is still uncharacterized.

### Runtime bug found and fixed — string JSON-RPC ids

Devin issues agent-to-client requests with **string UUID ids**:

```
{"jsonrpc":"2.0","id":"d36679fd-d753-4cfd-97f5-f5aa657f4160","method":"fs/read_text_file",…}
```

`AcpStdioClient`'s `isRequest` guard required `typeof id === 'number'`. Such a frame
therefore matched neither `isRequest` (id not a number) nor `isNotification` (an `id` is
present) nor `isResponse` (a `method` is present), and fell through to
`failAll('Received malformed ACP JSON-RPC frame')` — **tearing down the whole session on the
first file read**.

JSON-RPC 2.0 permits String, Number, or NULL ids, so the runtime was non-compliant and Devin
is not at fault. The guard now accepts both, `AcpJsonRpcRequest.id` widened to
`number | string`, and a regression test pins it (verified to fail against the old guard).

This bug was latent for every ACP provider that uses string ids, not just Devin.

### Session modes — a safety gap in the default configuration

Three turns were driven with the prompt "Create a file named written-by-devin.txt", with the
probe client **rejecting** every `session/request_permission` it received:

- `accept-edits` (Devin's default) — **file written**. Devin issued
  `fs/write_text_file` to the client with **no permission request for the write at all**.
  Two permission requests did arrive, but for later, unrelated tool calls.
- `ask` — no write attempted, no permission request. Ask means "answer without code
  changes", not "prompt before acting".
- `bypass` — file written, no permission request.

The first line is the problem. The runtime's permission enforcement is request-driven: it
decides when `session/request_permission` arrives. In `accept-edits` that request never
arrives for edits, so a runtime turn in the conservative `default` mode would have edited
the workspace un-gated — and since the adapter never called `session/set_mode`, every Devin
session ran in `accept-edits`.

`session/set_mode` works (`{sessionId, modeId}` → `{}`), so the fix is to pin the mode at
bootstrap. The mapping now applied:

- runtime `skip` → `bypass`
- runtime `default` → `ask`
- runtime `whitelist` → **refused**

`whitelist` is refused rather than approximated because no Devin mode can both permit and
constrain an edit tool: `accept-edits` lets edits through un-gated, and `ask` blocks them
outright. Downgrading to either would present as a working allowlist while enforcing
something else — the same reasoning applied to Cline's global `--auto-approve`.

The mapping is declared on the ACP profile (`sessionModes`), not hardcoded in the adapter,
so agents that route every tool through `session/request_permission` keep their existing
behavior and need no mapping. If `session/set_mode` fails, the turn fails: a mode that
cannot be pinned must not silently fall back to a more permissive one.

## Not probed

- `session/request_permission` option semantics beyond `allow_once` / `allow_always` /
  `reject_once`; the runtime's existing option-kind selection was not re-verified per mode.
- Whether `plan` mode is worth exposing as a distinct runtime concept.
- Cancellation over ACP (`session/cancel`).
- `session/load` despite `loadSession: true` being advertised.
- `--agent-type` (`summarizer`, `review`) as ACP server variants.
- `--permission-mode` behavior per level on the CLI surface, and how `--agent-config`
  expresses tool visibility.
- `-c/--continue` and `-r/--resume` semantics, and where session ids are exposed.
- `devin list` (sessions in the current directory) output shape.
- `--export` conversation format, which may be the only structured transcript available.
- `--sandbox` (research preview; macOS/Linux only).
- Cancellation behavior.

## Related

- ADR-033 §8 (classification reversal condition, now resolved as "no change")
- ADR-031 (ACP inside the agent backend)
- SPEC-027 §5, Probe Item P1
- PLAN-034 Phase 1
