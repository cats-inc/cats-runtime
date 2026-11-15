# Kimi Code CLI provider (2026-11-16)

Kimi Code CLI 2.5.3 (Moonshot AI) on native Windows 11, installed by environment-bootstrap
4108ac8 into `~/.kimi-code/bin/kimi.exe`. Decision: [ADR-054](../decisions/054-drive-kimi-code-through-print-mode-stream-json.md).

## What was observed, and how

- **Account turns.** The operator account was signed in with `kimi login` (region `global`) but
  had no Kimi Code plan. Every prompt, on the default model and on `kimi-code/k3` and
  `kimi-code/kimi-for-coding-highspeed`, failed with
  `provider.auth_error: Your current subscription does not have access to Kimi Code right now`.
  Captured as `subscription-required.error`. No successful turn reached Moonshot's service.
- **Successful output.** Kimi 2.5.3 itself was driven against a local scripted
  OpenAI-compatible endpoint through its documented environment model
  (`KIMI_MODEL_NAME`, `KIMI_MODEL_API_KEY`, `KIMI_MODEL_PROVIDER_TYPE=openai`,
  `KIMI_MODEL_BASE_URL`) with a throwaway `KIMI_CODE_HOME`, `KIMI_DISABLE_TELEMETRY=1` and
  `KIMI_CODE_NO_AUTO_UPDATE=1`. Stdout, stderr and the session store are Kimi's own; only the
  model replies were scripted. Captures: text turn, tool turn (Read), resumed turn with
  multi-line Chinese text, unknown session id, resume from another directory, an HTTP 400 from
  the model endpoint, and an alias missing from config.toml. A Chinese prompt passed in argv
  arrived intact in the session journal.
- **Source.** The single executable embeds its JavaScript bundle as text. `PromptJsonWriter`
  (`src/cli/prompt-render.ts`), `runV2Print` (`src/cli/v2/run-v2-print.ts`), `validateOptions`
  (`src/cli/options.ts`), `applyEnvModelConfig` and `isAutoUpdateDisabledByEnv` were read to
  explain the captures; the bundle itself is not stored.
- **Model list.** `kimi provider list --json` (machine-readable), redacted:
  [`model-list.provider-list.redacted.json`](fixtures/kimi-2.5.3/model-list.provider-list.redacted.json).

Test fixtures: `tests/fixtures/provider-captures/kimi-2.5.3/` (stdout and stderr per case, plus a
two-turn wire journal excerpt). Local paths are redacted; session ids come from the throwaway home.

## Print-mode contract (2.5.3)

- `-p/--prompt <text>` with `--output-format stream-json`. Print mode never reads stdin and
  rejects `--yolo`, `--auto` and `--plan`; it sets the session's permission mode to `auto`, where
  every tool call is decided without asking.
- Stdout lines: `{"role":"meta","type":"system.version"}` first; one
  `{"role":"assistant","content","tool_calls"}` per model step, flushed when the step ends or when
  its first tool result arrives; `{"role":"tool","tool_call_id","content"}` per tool result;
  `{"role":"meta","type":"turn.step.retrying"}` before a retried request;
  `{"role":"meta","type":"session.resume_hint","session_id"}` only after a completed turn. A busy
  session writes `{"type":"error","code","message"}` and exits 4. Thinking and token usage are
  never written to stdout.
- Failures exit 1 with `error: failed to run prompt: <message>` and `See log: <path>` on stderr.
- `--session <id>` resumes; Kimi refuses a session created under another working directory.
  The hint text says `kimi -r <id>`; `-S/--session` is the documented flag.
- `--model <alias>` takes an alias key from config.toml; an unknown alias fails before the turn.
- Effort: no flag. A turn uses `[thinking].effort` from config.toml or the model's
  `defaultEffort`. `KIMI_MODEL_THINKING_EFFORT` is read only together with `KIMI_MODEL_NAME`.
- Session store: `<KIMI_CODE_HOME>/sessions/wd_<dir>_<hash>/<session id>/` with `state.json`
  (`id`, `cwd`, timestamps, `lastTurnReason`) and `agents/main/wire.jsonl` (protocol 1.5:
  `turn.prompt`, `llm.request` with `model` and `modelAlias`, `usage.record` with `inputOther`,
  `inputCacheRead`, `inputCacheCreation` and `output`). A failed turn still leaves its session.
  `agent.message.appended` records carry the visible transcript: user input
  (`meta.source: input`), assistant text and tool results. Injected reminders are
  `context.append_message` records only.
- `kimi session list --all --json` lists `id`, `workDir`, `sessionDir`, timestamps, `archived` and
  `lastTurnReason` for every workspace. `kimi session` has no delete subcommand.
- `kimi acp` (2.6 s to `initialize`) advertises `sessionCapabilities` list, resume, close,
  delete, fork and additionalDirectories without a sign-in.
  - `session/list` filters by its `cwd` parameter.
  - `session/delete` returned `{}` from a different working directory and removed the session.
    It removed the directory and appended `{"sessionId":"…","deleted":true}` to
    `session_index.jsonl`, and the session was gone from `kimi session list`.
  - Kimi's own delete (`ISessionManager.delete`) also removes the index entry and the file history.
  - Starting `kimi acp` in a directory did not add it to `projects.json`.
- `kimi --version` and `kimi --help` take about 5 seconds each here; environment-bootstrap
  reports 9-30 seconds on cold Windows hosts.

## Model list

Six managed `kimi-code` aliases in enumeration order: K2.8 Preview (`kimi-for-coding`, 1M
context, efforts low/high/max, default max), K2.7 Code Highspeed (262144, no efforts), K3 (1M,
default high), K3-256k (262144), K3.1 Pro (1M) and K3.1 Pro Highspeed 2x Usage Cost (1M). The
`/model` picker was not captured, so no picker order or default marker is claimed.

## Session management acceptance

An isolated source Runtime used a copied throwaway `KIMI_CODE_HOME` holding the captured
sessions, with the dashboard driven by headless Chromium and checked against `kimi session list
--all --json`:
- Background discovery listed all six of Kimi's sessions with their first prompts, including
  Chinese ones, and user-turn counts.
- A Cats-created session that ran one turn merged with its discovered copy.
- Opening a session showed its transcript.
- Deleting one discovered and one Cats-created session through the dashboard removed both from
  Runtime and from Kimi's own list, and appended two `deleted` lines to `session_index.jsonl`.
  Neither came back after further polls.

## Computer use and `kimi acp` (Kimi Code 2.6.0, later on 2026-11-16)

The installed CLI had updated itself to 2.6.0, and the operator account now had a Kimi Code plan.
Real turns used the default model (`kimi-for-coding`, "K2.8 Preview"); `kimi-for-coding-highspeed`
answered `-32000 Authentication required: Your current subscription does not have access to
kimi-for-coding-highspeed` (captured). Every probe session was deleted through `session/delete`.
Decision: [ADR-054 decision 11](../decisions/054-drive-kimi-code-through-print-mode-stream-json.md).

- **How Kimi does computer use.** The user installs the marketplace plugin `kimi-cu-win` 0.3.13
  from the TUI (`/plugins`) into `~/.kimi-code/plugins/managed/kimi-cu-win`, recorded in
  `plugins/installed.json`. Its `kimi.plugin.json` declares MCP server `win`
  (`runtime/node-repl.exe`, tools `js`, `js_reset`, `js_add_node_module_dir`,
  `toolTimeoutMs: 660000`) and the skill `kimi-cu`; the model runs `await import("@kimi/cu")` in a
  `js` cell to list windows, capture screenshots and UIA text, and send input. The plugin needs
  the separately installed native runtime `%LOCALAPPDATA%\Kimi Computer Use\kimi-cu.exe` (0.3.0
  or later) and Node.js 24.15 or later on the host PATH. Plugins load at session start, so a
  session that was open during installation needs `/new` or `/reload`; the operator's own TUI
  sessions show exactly that. In the session tools the plugin appears as
  `mcp__plugin-kimi-cu-win_win__js`.
- **Kimi desktop is a separate install.** The Kimi desktop app (3.2.27) runs its own kimi-code
  home under `%APPDATA%\kimi-desktop\daimon-share\daimon\runtime\kimi-code\home` with its own copy
  of the plugin. Installing computer use there does not install it for the CLI.
- **Print mode loads the plugin and never asks.** A `kimi -p` turn in an empty directory recorded
  `permission.set_mode: auto`, `mcp.tools_discovered` for `plugin-kimi-cu-win:win` and the three
  `js` tools in `llm.tools_snapshot`. The bundle has no environment variable or flag that disables
  plugins for one process (only marketplace and MCP timeout variables).
- **`kimi acp` loads plugins and asks.** `initialize` advertises `loadSession`,
  `sessionCapabilities` list/resume/close/delete/fork/additionalDirectories and
  `mcpCapabilities` `http` and `sse`. `session/new` returns `configOptions` `model`, `thinking`
  and `mode`, plus `modes`, with `default` ("Manual approvals; tools execute normally"), `plan`,
  `auto` ("Auto-approve safe operations") and `yolo` ("Auto-approve everything"). Installed plugin
  skills arrive in `available_commands_update` as `skill:kimi-cu-win:kimi-cu`. In `default`, a
  `js` call sends `session/request_permission` with `approve_once`/`allow_once`,
  `approve_always`/`allow_always` ("Approve for this session") and `reject`/`reject_once`; the
  tool runs only after the answer. The request names the tool but has no `rawInput`; the
  arguments arrive before it as the cumulative JSON text of `tool_call_update` frames with status
  `in_progress`. Captures: `tests/fixtures/provider-captures/kimi-2.6.0/`.
- **Bash and Write ask too.** In `default`, a Bash `echo` and a one-letter Write in a scratch
  directory each sent `session/request_permission` (title `Bash` / `Write`, no `kind`, no
  `rawInput`) and ran only after the answer. Their `tool_call` frames carried `kind: execute` and
  `kind: edit`; plugin tools carry `kind: other`. Capture:
  `acp-bash-write-permission.success.redacted.ndjson`.
- **Start-up time.** On this host `initialize` answered in 1.9-2.8 s, `session/new` (which
  starts the plugin MCP server) in 1.2-1.4 s and the mode change in under 30 ms.
- **Session controls.** `session/set_config_option` for `mode` and `model` returns the updated
  options (and `current_mode_update`/`config_option_update` notifications); an unknown mode is
  -32602 `Unknown modeId`, an alias missing from config.toml -32603 with `details`. Mode and model
  persist with the session across `session/resume` from a new process. `session/resume` of an
  unknown id is -32602 `Invalid params: Unknown sessionId: <id>`. Resuming from another working
  directory succeeded without a check, so Runtime keeps sending the session's own cwd.
- **Session MCP.** An HTTP server with an `Authorization` header in `session/new` was attempted
  (`mcp.server_failed` for the unreachable fixture URL); the bearer value appeared nowhere under
  `~/.kimi-code` (sessions, logs, JSON and TOML files).
- **Images.** A `js` cell that emitted a PNG returned, in the completed `tool_call_update`, a
  text block with `kimi-file://f_mcp_<sha256>` and the saved path under the session's `media/`
  directory; no image bytes cross ACP.
- **Project registry.** Starting sessions in a directory through `kimi acp` or `kimi -p` adds it
  to `projects.json` and leaves an empty `sessions/wd_<dir>_<hash>/` after the session is deleted.
- **End to end through Runtime.** The worktree's Runtime from source, with an isolated
  `CATS_RUNTIME_DIR`, a `kimi` native instance with `protocol: hosted`, the full provider policy
  and an interaction host: the `js` call surfaced as a `tool_approval` titled
  `mcp__plugin-kimi-cu-win_win__js` whose message showed `{"code":"nodeRepl.write('cats-e2e-ok')",
  "title":"probe"}` and offered only "Approve once". Accepting it through
  `POST /sessions/:id/interactions/:id/responses` resolved the card and finished the turn; the
  capability snapshot reported `computer_use: available` and the verified provider policy, and
  deleting the Runtime session removed Kimi's session. No desktop input was sent in any probe.

## Not verified

- A turn on a real Kimi Code plan, and therefore the managed provider's real text, tool and
  usage records.
- macOS, Linux, WSL and Docker runs (the WSL/Docker session store path is tested with a fake
  shell runner only); `kimi acp` prompt sessions.
- Long-running tool steps beyond the 30-minute turn limit, and subagent usage.

## Scripts

- Mock OpenAI-compatible endpoint used for the captures: one-off, not kept (the fixtures replace
  it; a later version can be re-captured the same way with any scripted endpoint).
- Fixture copy and path redaction helpers: one-off, not kept.
- Kept: `parseKimiProviderList` and the `kimi` probe source in the catalog skill, and the Kimi
  sign-in check in `cli-login-status.mjs`, each with offline tests.
