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
`../../tests/fixtures/provider-captures/muse-1.0.3/` are sanitized copies — session, run, task, and tool-call
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
- **The prompt is positional, and a leading `-` is fatal.** `muse exec "-do the
  thing"` prints `unknown option -do the thing` plus a usage line instead of running,
  and exits 0 while doing it. `--` ends option parsing and works, so the adapter always
  emits `-- <prompt>`; an arbitrary runtime prompt cannot be passed safely without it.
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
- `--reasoning-effort` is a root argument on both `muse` and `muse exec`.
  The recorded help lists `none|minimal|low|medium|high|xhigh|max|ultra` and `high`
  as its parser default. The original inference that this was every model's picker
  menu was incorrect; the 2026-09-18 operator correction below supersedes it.
- `--provider echo` runs the whole record pipeline with no account and no model
  call. `../../tests/fixtures/provider-captures/muse-1.0.3/echo-provider.success.redacted.ndjson` is that run
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

There is also no reasoning signal. `task.lifecycle.status` carries operational lines
such as `opening meta model stream attempt 1/10`, which the adapter surfaces as status
progress rather than dressing up as model thinking.

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

## Spawning from a stale PATH — the desktop "not in the list" bug

Found after the provider shipped: with muse installed, the desktop's provider
list did not show it. The runtime's own diagnostics explained why. Muse came
back `degraded` with `version_unknown`, and the captured version line was
cmd.exe's `'"muse"' is not recognized as an internal or external command`
(CP950 mojibake, since the host is Traditional Chinese). The muse installer
adds `%LOCALAPPDATA%\Programs\muse` to the **User** PATH in the registry, but
any process already running — the shell, the desktop host, the runtime it
spawns — keeps the PATH it started with. Grok resolved fine in the same
process only because `~/.grok/bin` had been on PATH long before.

The contradiction was that setup reported `expectedPathExists: true` for
`%LOCALAPPDATA%\Programs\muse\muse.cmd` while the spawn path fell through to
`cmd.exe "muse"`. The runtime knew where the binary was and did not use it.

Two changes in `src/backends/cli/runtime/runtime.ts`:

- **Install-knowledge fallback.** When neither PATH nor the common npm
  directories can see a bare command, the resolver consults the provider's own
  `expectedPaths[platform]` and `pathHints[platform].directoryHint`, with
  `%VAR%` and `~` expanded, and spawns from there if the file exists. This is
  guarded by basename: the expected path names the *stock* binary, and an
  operator who configured `path: my-wrapper` must get a failure for
  `my-wrapper`, not a silent switch to the installer's binary. The same
  fallback applies on POSIX for a GUI-launched host whose PATH lacks
  `~/.local/bin`, though the desktop host already prepends that directory.
- **Launcher bypass** (`windowsMuseLauncher.ts`). `muse.cmd` is a batch file,
  so reaching it means `cmd.exe`, which from the console-less desktop host
  hands a console to Windows Terminal and flashes a window — the exact
  problem `windowsNodeShim.ts` fixed for npm shims. The resolver recognises the
  installer's shim by its `-File "%~dp0.muse-launcher.ps1"` line, reads
  `.muse-version` beside it, and spawns `muse-bin-<version>.exe` directly,
  passing `MUSE_RELEASE_INFO` from `.muse-release-info.json` exactly as the
  launcher would. It also removes the launcher's ~4s startup from every spawn.
  A launcher with no binary behind it (the half-install state) is left alone,
  since only the launcher can repair that. The one behaviour lost is the
  launcher's background update check on runtime-initiated launches.

Verified on this machine with a runtime started from a shell whose PATH did
not contain the muse directory: `/diagnostics/providers?force=1` now reports
muse `ok`, version `1.0.3` from `Muse Code 1.0.3 (1.0.3-R2198.1)`, and the
exact `muse-cli-exec-json-1.0.3` profile. The desktop's `/api/providers` only
lists a provider whose runtime diagnostics are `ok` or `degraded`, so this is
what the list was waiting on.

## Session storage — automatic discovery added 2026-09-16

muse keeps transcripts under `~/.local/share/muse/sessions/<yyyy>/<mm>/<dd>/
<session-uuid>/session.jsonl` (that path is used on Windows too), with a
companion `session-index.db` and an `.msp-view-v1` projection directory.

A read-only inspection of existing Windows logs on 2026-09-16 established the
durable format needed for discovery. It differs from exec stdout: metadata is
`runtime.session.metadata` with `payload.record.workspace_root` / `model_id`;
working-directory updates also appear in `runtime.session.route_facts`.
`runtime.session` records nest a run event in `payload.event`: `started.prompt`
is the user turn, and `assistant_message_committed.text` is the assistant turn.
`recorded_at` is Unix microseconds. Transaction frames contain JSON-encoded
child records. User-intent intake, reasoning, and task output are separate
records and must not be duplicated or treated as assistant replies.

The runtime now scans these logs on startup, watches later changes, and retries
missing session directories. The same reader supplies provider-owned history.
`MUSE_SESSIONS_DIR` and per-instance `sessions_dir` configure the root; deletion
uses the same contained provider-directory boundary as Cline and Grok. It does
not query or mutate the Muse index database. Resume continues to use
`--session-id`. Tests use synthetic versions of these observed shapes under
temporary directories; no verification sessions were created in user state.

The accompanying Devin audit found that Dashboard refresh previously only read
the registry while manual discovery queried ACP. Agent targets now receive an
asynchronous initial scan and periodic scans without `session/new`. Complete
pagination follows the [ACP Session List contract](https://agentclientprotocol.com/protocol/v1/session-list);
incomplete listings never prune the registry.

Validation on 2026-09-16:

- Focused discovery, configuration, ACP, and deletion suites: 171 tests passed
  across six files. Existing Cline/Grok scanner suites: nine tests passed.
- Selected runtime startup/dashboard and agent-discovery integration checks:
  nine tests passed. These include the existing prohibition on background Goose
  execution and file-watcher deduplication.
- Full `npm test` passed before PR submission: 214 test files and 2,158 tests
  passed; two files and ten tests were skipped. This includes a fresh build and
  the UI artifact check with the generated pages staged for commit.
- TypeScript `tsc --noEmit -p tsconfig.json` and `npm run build:ui` also passed.
- Independent review verified the watcher catch-up/shutdown guards, complete
  ACP pagination, unsupported permanent deletion, stale-list rejection after
  deletion, and Muse path precedence. No remaining correctness findings were
  reported.
- This validates the source change with isolated fixtures. The installed Desktop
  runtime (`0.1.22`) was not replaced during this check.

## 2026-09-18 correction: per-model effort menus

Mode: refresh; interaction policy: confirm uncertainty. The operator explicitly corrected the
complete effort menus for both regular/contributor rows in each generation. This resolves the
older help-derived inference; no additional confirmation or CLI probe was needed. The current
CLI version was not supplied, so model-list version/freshness and model limits retain the earlier
provenance. The correction is preserved in
[the operator evidence](./fixtures/muse-unknown-version/efforts-2026-09-18.redacted.txt).

| Models | Ordered effort menu | Declared default |
| --- | --- | --- |
| muse-spark-1.3, muse-spark-1.3-contributor | minimal, low, medium, high, xhigh, max | None |
| muse-spark-1.2, muse-spark-1.2-contributor | minimal, low, medium, high, xhigh | None |

Root cause: the initial implementation promoted the global help's parser vocabulary and its
high default into a shared picker menu. The provider skill repeated that incorrect inference;
there was no bundled-catalog regression checking Muse's per-model menus. Machine-readable model
identity evidence cannot establish effort availability, and a global argument cannot establish
that every model's picker is identical. The operator's correction supersedes that inference.

The curated menus now live on each model. Runtime already supports per-model applicability and
no-default controls, so no selector or adapter behavior change is required. Playground renders
minimal first and submits it through the existing form serializer without adding a default label;
Desktop consumes the same public control metadata. Existing parser acceptance stays separate from
curated structured selections. Model ids/labels/order, contributor metadata, context/output limits,
and other providers are unchanged.

The canonical maintenance skill now distinguishes evidence by field and selected model, removes
the false Muse shared-menu rule, and requires validating exact per-model menus against the loaded
catalog, including absent defaults and cross-model rejection. Generated agent mirrors are synced
from the canonical source, including Claude; no hand edits to discovery copies.

Validation:

- Focused catalog loading, normalization, advanced knowledge, and model catalog suites passed.
- The final Muse catalog, Playground, and adapter run passed all 38 tests (3 files, 2.98 seconds).
  These check exact menus, no effort defaults, first-value form serialization, saved effort,
  rejected cross-model options, and the generated CLI arguments without spawning Muse.
- Desktop's existing model-default selector suite passed all 3 tests using its unchanged compiled
  bundle. It covers generic per-model filtering, first selection without default labels, and saved
  effort restoration; it is not a Muse-specific installed-Desktop visual smoke.
- Runtime typecheck (including UI generation) passed. The first sandboxed Vitest attempt hit
  Windows spawn EPERM before collecting tests; the authorized unsandboxed run completed.
  Two initial new-test failures were test harness mistakes (missing adapter turn preparation and
  checking normalization instead of the actual form serializer), corrected before the final pass.
- The skill's Python validator could not import PyYAML. Equivalent frontmatter/name/description,
  placeholder and relative-link checks passed with the existing Node YAML dependency. Runtime
  mirrors match the source; workspace sync/check also passed for both Codex and Claude.
- The operator authorized personal Muse sync. A backup and unchanged-source check preceded the
  provider-only write; parsed comparison verified every other provider stayed unchanged.
- Read-only GET /providers/muse/models/advanced against the running localhost Runtime returned
  the four corrected menus, no declared effort defaults, and no warnings. No restart was needed
  for this check. No installed Desktop visual smoke or provider inference was performed.

## Fixtures

All under `tests/fixtures/provider-captures/muse-1.0.3/`:

- `echo-provider.success.redacted.ndjson` — `--provider echo`, no account.
- `tool-success.redacted.ndjson` — `read_file` tool call and result.
- `resume-seed.success.redacted.ndjson` / `resume.success.redacted.ndjson` — the
  two halves of the `--session-id` resume check.
- `approval-untrusted-executes.redacted.ndjson` — a write executing under
  `--approval-mode untrusted`.
- `read-only-capability-toggles.redacted.ndjson` — the same prompt refused under
  the three `--disable-*` switches.
