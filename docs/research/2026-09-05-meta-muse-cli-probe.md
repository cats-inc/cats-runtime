# Meta Muse CLI Install, Execution, and Permission Probe

Date: 2026-09-05

## Scope and conclusion

This note records the evidence for adding Meta's Muse CLI (`muse`) to
cats-runtime as an executable CLI provider family, and for removing Aider in the
same change.

Muse 1.0.3-R2198.1 was probed on Windows against a signed-in Meta account. It
has a real headless mode with a machine-readable event stream, resumes a prior
conversation from an argument, and can be reduced to a genuinely read-only run.
That closes the success, tool, resume, model, and permission gaps a native
adapter needs, so Cats enables `muse` session execution.

Aider is removed rather than kept alongside it. The 2026-08-09 probe
(`2026-08-09-aider-cli-probe.md`) found no machine-readable output, no ACP or
server mode, and a zero exit code even when the model call failed. It has been
carried since then as an install-and-detect-only provider that could never
become a usable execution target — a state the desktop onboarding grid had to
special-case away from users. Nothing about that has changed upstream, so the
provider is deleted instead of maintained.

Every prompt ran with a newly created temporary directory as the workspace; the
CLI was never pointed at a Cats checkout. Repository fixtures under
`fixtures/muse-1.0.3/` are sanitized copies — session, run, task, and tool-call
identifiers are renumbered, timestamps are frozen, and the probe workspace path
is rewritten to `/tmp/muse-probe`. Raw captures and probe-created working files
were deleted after validation.

## Install and authentication contract

- Windows installs with `irm https://dev.meta.ai/install.ps1 | iex`; macOS and
  Linux use `curl -fsSL https://dev.meta.ai/install.sh | bash`.
- What the installer places is a **launcher**, not the agent. On Windows it
  writes `muse.cmd` plus `.muse-launcher.ps1` into
  `%LOCALAPPDATA%\Programs\muse`; on macOS and Linux it writes a launcher
  script to `~/.local/bin/muse`. Both honour `MUSE_INSTALL_DIR`.
- The launcher downloads `muse-bin-<version>` beside itself and records the
  version in `.muse-version`. An install that dies between those two steps
  leaves a launcher with no binary, which is why presence of the launcher alone
  is not evidence of a working install.
- The launcher self-updates in the background. `MUSE_NO_AUTO_UPDATE=1` stops it.
- `muse login` signs in to a Meta account and writes
  `~/.config/muse/auth.json`. There is no documented API-key variable that
  substitutes for that sign-in; `muse auth` stores *provider* credentials and is
  a different thing.

### Reading the version without running the tool

The launcher forwards every argument straight to the agent binary. On 1.0.3 that
binary does accept `-V/--version` — `muse --version` prints
`Muse Code 1.0.3 (1.0.3-R2198.1)` — but a build that did not recognise the flag
would open the interactive TUI instead and hang an unattended run forever.

The packaged setup helpers therefore never execute `muse` at all and read
`.muse-version` from the install directory, matching what
`sammykenny2/environment-bootstrap` does (commit `6f59feb`). The runtime's
compatibility probe does run `--version`, because it runs every provider under
an explicit timeout and reports the timeout rather than blocking.

Cost of the launcher indirection, measured on 1.0.3: ~4.2s for `--version`
alone, ~4.2s for `--help` alone, and ~5.7s wall clock for both concurrently,
which is what the compatibility service does. That is close enough to the
default 10s budget that the provider declares `minProbeTimeoutMs: 20_000`.

## Verified CLI and model contract

- `muse exec` is the only headless entry point. Bare `muse` opens the TUI and
  `muse resume` opens a session picker.
- `muse exec --json` writes one JSON record per line to stdout. The startup
  banner (`muse: workspace root: …`) goes to stderr, so stdout is clean.
- The workspace root defaults to the process cwd, which is what the adapter
  relies on: passing `--workspace` would send an untranslated host path into the
  WSL and Docker runners.
- Model catalog, read from muse's own `model/list` over the MSP host it serves
  on stdio (`muse serve`) — the CLI has no `models` subcommand:

  | modelId | releaseDate | contextLimit | outputLimit |
  | --- | --- | --- | --- |
  | `muse-spark-1.3` | 2026-09-02 | 1007997 | 128000 |
  | `muse-spark-1.3-contributor` | 2026-09-02 | 1007997 | 128000 |
  | `muse-spark-1.2` | 2026-08-05 | 1007997 | 128000 |
  | `muse-spark-1.2-contributor` | 2026-08-05 | 1007997 | 128000 |

  The reply carried `providerId: "meta"`, `profileId: "tbh"`, and
  `source: "providerCatalog"`. The `-contributor` rows describe themselves as
  "Your content, including inter-session messages, may be used for product
  improvement."
- `model/list` marks `muse-spark-1.3-contributor` as `isDefault`. Neither the
  runtime catalog nor the product catalog mirrors that, because projecting it
  would opt every runtime turn into content sharing without anyone asking. With
  no `--model` argument muse uses whatever the account already prefers.
- **An unknown model id is silently ignored.** `muse exec --model
  definitely-not-a-model` completed normally, answering from the account
  default, with `run.model.configured` reporting
  `model_id: "definitely-not-a-model"` and `profile_id: null`. Model selection is
  therefore best-effort and cannot be validated from the exit code.
- `--reasoning-effort` is a root argument on both `muse` and `muse exec`, with
  one list for every model: `none|minimal|low|medium|high|xhigh|max|ultra`,
  defaulting to `high`. Unlike Grok, the menu does not vary per model, which is
  why the curated catalog carries it in `shared_options`.
- `--provider echo` runs the whole record pipeline with no account and no model
  call. `fixtures/muse-1.0.3/echo-provider.success.redacted.ndjson` is that run
  and is reproducible offline.

## Stream lifecycle

Every record carries `schema_version`, a `stream` ref, `sequence`,
`record_type`, `durability`, `causation_id`, `payload_type`, and `payload`. The
top-level `stream` is `{"kind":"session","id":"<uuid>"}` on the *first* record
and every record after it, which is what makes the session id available before
anything can fail.

Records observed across all probes:

- `runtime.command.accepted` — command intake acknowledgement.
- `session.run.linked`, `task.stream.linked` — stream plumbing.
- `run.model.configured` — `provider_id`, `model_id`, `display_label`.
- `turn.input.user` — the prompt echoed back.
- `run.lifecycle.started`.
- `task.lifecycle.{proposed,accepted,scheduled,side_effect_intent,started,status,output,completed}`.
- `tool.result` — `call_id`, `text`, and
  `correlation_facts.{tool_name,outcome}`.
- `run.output.delta` — incremental assistant text.
- `run.terminal.{completed,failed,cancelled}` — `terminal`, `text`, `reason`.

The binary's own record table also lists `task.lifecycle.{rejected,failed,
cancelled,timed_out,tool_delta,tool_output_ref}`, `todo.snapshot.updated`, and
three `mcp.*` records. Those did not appear in any probe; the adapter handles
them rather than falling through to its unknown-record path.

A tool call is a task, spread across records:

- `task.lifecycle.proposed` names it as `task_kind: "tool.<name>"`;
- `task.lifecycle.side_effect_intent` is the first record carrying the tool call
  id, as `idempotency_key: "tool:<call_id>"`;
- `task.lifecycle.output` carries the output text as `event.chunk`;
- `tool.result` names the tool and its outcome side by side.

Model responses are tasks too (`task_kind: "model.meta.response"`, or
`model.unknown.response` under `--provider echo`), so `tool.` is the prefix that
separates a tool call from a model step.

**There is no token usage anywhere in the stream.** No probe produced a usage
record, and the payload-type table the binary carries has no usage entry for the
exec plane. Turns through this provider report no usage; that is a property of
the CLI, not a gap in the adapter.

`run.terminal.completed` repeats the entire answer in `payload.text` after it
has already been streamed as deltas. The adapter drops that text and keeps only
the session identity, so a turn's text is not duplicated.

## Resume

`muse exec --session-id <uuid>` is the whole resume contract:

- With an id muse has not seen, it creates the session under that id.
- With an id it has, it replays that session's history and continues it.

Verified end to end: one turn was told the codeword `TANGERINE` and replied
`OK`; a second `muse exec` with the same `--session-id` and no other shared
state answered `TANGERINE`. Both turns are recorded as
`resume-seed.success.redacted.ndjson` and `resume.success.redacted.ndjson`, and
both carry the same session id in `stream.id`.

There is no fork counterpart. `session/fork` exists on the MSP `muse serve`
plane only, and `muse exec` has no fork argument, so the provider declares
`fork: false` and refuses a fork request rather than silently resuming.

## Permissions — approval mode does not gate anything headless

This is the finding that shapes the adapter, and it repeats the Grok 1.0.0
lesson in a different place.

Muse advertises `--approval-mode untrusted|on-request|never` and states that
"approval and the sandbox are ON by default". In a headless `muse exec` run,
**none of those approval settings prevented a tool from executing**. The same
prompt — "create a file called hello.txt containing WORLD" — was run three ways:

| Run | Flags | Result |
| --- | --- | --- |
| default | none | `write_file` ran, `hello.txt` written |
| never | `--approval-mode never` | `write_file` ran, `hello.txt` written |
| untrusted | `--approval-mode untrusted` | `write_file` ran, `hello.txt` written |

A headless run has no reviewer to prompt, so it resolves its own approvals.
`approval-untrusted-executes.redacted.ndjson` is the third run.

What *does* remove a capability is the three `--disable-*` switches. The same
prompt under `--disable-write --disable-shell --disable-web-tools` called no
tool at all, wrote no file, and answered "Cannot create `hello.txt` — file
writes and shell execution are disabled for this session". That run is
`read-only-capability-toggles.redacted.ndjson`.

The adapter therefore expresses every runtime permission mode with the
capability switches and treats the approval flags only as prompt suppression:

- `default` (fail-safe) — `--disable-write --disable-shell --disable-web-tools`.
- `skip` — approvals off, all capabilities on.
- `whitelist` — one switch per group, derived from the requested tools.

`muse exec` has no per-tool allowlist argument, so the three switches are the
only granularity available. A whitelist that names part of a gated group is
refused with a message naming the whole group, rather than quietly enabling
tools the caller did not ask for. Read tools (`read_file`, `read_memory`,
`read_skill`, `search`, `tool_search`) have no switch at all and are always
reachable.

The tool roster behind each switch was read from the binary's own tool tables:

- write group: `add_memory`, `apply_patch`, `artifact`, `edit_file`,
  `edit_memory`, `write_file`
- shell group: `bash`, `bash_input`, `exec_command`, `monitor`, `powershell`,
  `powershell_input`, `shell`, `write_stdin`
- web group: `web_fetch`, `web_search`

Note that `--disable-write` is documented as disabling *non-shell* workspace
writes, so a read-only posture needs `--disable-shell` alongside it. The
read-only fixture used both.

`--yolo` is deliberately not used for `skip` mode: it also disables the sandbox
and trusts the workspace, which loads that repository's own muse skills and
rules. That is more than "skip permission checks" asks for.

## Session storage — not wired

muse keeps transcripts under `~/.local/share/muse/sessions/<yyyy>/<mm>/<dd>/
<session-uuid>/session.jsonl` (that path is used on Windows too), with a
companion `session-index.db` and an `.msp-view-v1` projection directory. The
runtime has no scanner for that layout, so no `museSessionsDir` is configured
and finished muse runs do not appear through file-backed discovery. Resume is
unaffected: it goes through `--session-id`, not through the files.

## Fixtures

All under `docs/research/fixtures/muse-1.0.3/`:

- `echo-provider.success.redacted.ndjson` — `--provider echo`, no account.
- `tool-success.redacted.ndjson` — `read_file` tool call and result.
- `resume-seed.success.redacted.ndjson` / `resume.success.redacted.ndjson` — the
  two halves of the `--session-id` resume check.
- `approval-untrusted-executes.redacted.ndjson` — a write executing under
  `--approval-mode untrusted`.
- `read-only-capability-toggles.redacted.ndjson` — the same prompt refused under
  the three `--disable-*` switches.
