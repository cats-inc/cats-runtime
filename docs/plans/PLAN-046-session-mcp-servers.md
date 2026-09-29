# PLAN-046: Session MCP servers

Status: Complete (2026-09-30). R1 merged in #130, R2 in #132, R3 in #134 and R4
in #140. The F3 follow-up adds GitHub Copilot CLI and records why the other
adapters cannot take the set yet. Release remains separate (see R4 and F3).
[SPEC-035](../specs/SPEC-035-session-mcp-servers.md) and
[ADR-044](../decisions/044-configure-session-mcp-servers-for-provider-clis.md)
govern this work. The Platform consumer is PLAN-116, which tracks the matching
runtime tasks as R1–R4.

## R1 — Contract, storage and reports (no adapter)

- [x] Add a strict parser and an in-memory store in `src/core/sessionMcpServers.ts`.
- [x] Accept the field on create (every branch), resume and send. Clear the
  store on session removal only.
- [x] Pass only token-free launch descriptors in `ProviderSpawnOptions`. Pass the
  token as a separate environment contribution that `WorkerProcess` merges after
  the provider command environment, and only in native mode.
- [x] Add the optional `ProviderCapabilities.sessionMcpServers` flag and keep
  `buildFallbackCapabilities` consistent. No adapter enables it in R1.
- [x] Return the report on create and resume, and as the first send stream event.
- [x] Tests: validation, no token in persistence/reads/responses/spawn options,
  and `unsupported` for providers without support.
- [x] Update `docs/api.md` and `docs/mcp-config.md` (facade exclusion) and the
  indexes.

## R2 — Claude Code

- [x] Verify `${VAR}` expansion in `--mcp-config` headers on the installed CLI
  (2.1.284). Verified: the stub server received the expanded bearer, never a
  literal placeholder, and the token was absent from argv. No temporary file is
  needed.
- [x] Add `--mcp-config` (inline JSON) and `mcp__<name>` in `--allowedTools`
  for `default` and `whitelist` modes, and enable the capability.
- [x] Recycle a live worker through resume at the turn boundary when a send
  changes the set (SMCP-08). A recycle failure closes the session and returns
  500.
- [x] Normalize `system:init.mcp_servers` into `InitStreamEvent.mcpServers`. The
  pool keeps the latest states per live worker. `connected` maps to `connected`,
  `failed` and `needs-auth` map to `failed`, and anything else is `unknown`.
- [x] Isolated live smoke (2026-09-29, Windows, Claude Code 2.1.284, haiku).
  Setup: Runtime under a temporary `CATS_RUNTIME_DIR` with a stub loopback
  Streamable HTTP server and permission mode `default`.
  - Create reported `delivered`.
  - Turn 1 called `mcp__probe__echo`, and the stub recorded an authenticated
    `tools/call` with the requested arguments.
  - Turn 2 reported `connection: connected`.
  - The token did not appear in create or read bodies, `sessions.json`, other
    data files or Runtime output. The CLI-created project folders were removed
    afterwards.

R2 findings for consumers:

- Claude Code defers MCP tools behind `ToolSearch`: the model first called
  `ToolSearch` with `select:mcp__probe__echo`, then called the tool. Session
  instructions should name the full tool IDs (for example
  `mcp__cats__show_in_canvas`) so the model can load them directly.
- Connection evidence arrives with the provider's `system:init`, which Claude
  emits during the first turn. The first report therefore shows
  `connection: unknown`, and later turns show `connected`.
- The config travels as an inline JSON argument. Native `.exe` launches pass it
  unchanged. Instances that run through the Windows `cmd` proxy rely on its
  argument quoting and were not exercised.
- A recycle kills and respawns the worker synchronously, like the Pi precedent.
  A session at exactly `maxSessions` can hit "Max sessions reached" while the
  killed worker still counts as alive. This latent limit is shared with Pi and
  is not fixed here.
- Session list reads use fallback capabilities rather than the adapter's, so R4
  added `sessionMcpServers` to the Claude and Codex fallback when it exposed the
  capability. List and detail reads report the same value.

## R3 — Codex

- [x] Add `-c mcp_servers.<name>.url` and `bearer_token_env_var` after
  `app-server`, and enable the capability. Configured instance overrides still
  precede the session's values.
- [x] Approve tool calls for the configured servers only, using
  `-c mcp_servers.<name>.default_tools_approval_mode="approve"`. Without it,
  Codex 0.158.0 fails the call with "MCP tool call requires approval, but
  approval policy is never". With it, no elicitation or approval request is
  sent. Elicitations stay declined for every server.
- [x] The Windows Code Mode host gets the child environment without the
  `CATS_MCP_*` secrets; only Codex itself needs them.
- [x] `mcpServer/startupStatus/updated` for a session server becomes a provider
  `progress` event of kind `mcp_servers` with `mcpServers: [{ name, status }]`.
  Other servers are ignored. `ready` maps to `connected`, and `failed`/`error`
  map to `failed`. The pool merges per-server updates.
- [x] Isolated live smoke (2026-09-29, Windows, Codex 0.158.0, default model).
  - A direct app-server probe first confirmed the approval failure and the
    per-server fix.
  - Through Runtime (temporary `CATS_RUNTIME_DIR`, permission mode `default`):
    - Create reported `delivered`.
    - Turn 1 streamed the provider statuses `starting` then `ready`, and the
      stub logged an authenticated `tools/call` with the requested arguments.
    - Turn 2 reported `connection: connected`.
    - The token did not appear in bodies, reads, persisted data or Runtime
      output.
  - The two rollouts that the direct probes created under `~/.codex/sessions`
    were deleted. Session deletion removed the Runtime smoke's own history.

R3 notes for consumers:

- Provider-sourced `mcp_servers` progress events (`metadata.source: "provider"`)
  may appear in a turn's stream. Hosts should read delivery only from the
  leading Runtime-sourced event (`metadata.source: "runtime"`, with
  `metadata.mcpServers`).
- The Runtime `tool_use` projection for Codex MCP calls carries the bare tool
  name (`echo`) and no arguments. Hosts must not rely on it to identify the
  server.

## R4 — Surfacing and release boundary

- [x] Expose `sessionMcpServers` in provider tooling/continuity reads.
  `ProviderContinuitySummary.sessionMcpServers` appears wherever `continuity`
  does: `GET /providers/config`, `GET /providers/:provider/tools`,
  `GET /diagnostics/providers` and session `providerTarget` reads. It is `true`
  only for a CLI adapter that declares the capability on a `native` instance,
  the gate that session create, resume and send apply. The session manager and
  the summary share one predicate, `targetSupportsSessionMcpServers`. Docker/WSL
  instances and `api`, `local` and `agent` targets report `false`.
- [x] Record the release boundary: an additive optional field within the current
  0.x line. The optional `mcpServers` request field and the
  `continuity.sessionMcpServers` read field are compatible additions: no
  existing HTTP, configuration or persisted-data contract changes, and no
  migration is needed. The version is chosen at release time under the release
  SOP. This plan authorizes no bump. Runtime 0.4.0 was published from
  `2f167ad5` (#139, recorded in #141) with R1–R3 but before R4 merged, so the
  read field first ships in a later compatible 0.4.x release.

## F3 — More provider CLIs (follow-up for PLAN-116 F3)

The Platform task is PLAN-116 F3: extend delivery to other providers or record
why each one cannot take it. The per-provider decisions and evidence are in the
SPEC-035 provider matrix.

- [x] Survey every other CLI adapter against the SPEC-035 bar. Only GitHub
  Copilot CLI qualifies today: a per-run flag plus bearer expansion from the
  environment, without writing any user or workspace config.
- [x] Copilot: add `--additional-mcp-config` inline JSON with
  `Authorization: Bearer ${CATS_MCP_<NAME>_TOKEN}`. Enable the capability, and
  add Copilot to the session-list fallback capabilities so that list and
  detail reads agree. Normalize `session.mcp_server_status_changed` and
  `session.mcp_servers_loaded` for session servers into provider `mcp_servers`
  progress events. Other servers, such as the built-in GitHub server, are
  ignored.
- [x] Recycling needs no adapter work. Copilot runs one process per turn, and
  the existing SMCP-08 recycle replaces the logical worker and its launch
  environment. The next process resumes the same Copilot session with the new
  set.
- [x] Commit the loopback stub used by the smokes as
  `scripts/testing/session-mcp-stub-server.mjs`, with an offline test. It reads
  the expected bearer from an environment variable, and its log records only
  an auth classification: `ok`, `absent`, `literal-placeholder` or `other`.
- [x] Isolated live smoke (2026-09-30, Windows, Copilot CLI 1.0.89,
  `gpt-5-mini`, permission mode `default`). Runtime ran from the branch with a
  temporary `CATS_RUNTIME_DIR` and a Copilot-only `providers.yaml`.
  - `GET /providers/copilot/tools` reported `continuity.sessionMcpServers: true`.
  - Create reported `delivered` with `connection: unknown`.
  - In turn 1, the stub logged `initialize`, `tools/list` and the SSE `GET`,
    all with the expanded bearer (`auth: ok`). The stream carried the provider
    statuses `pending` then `connected`.
  - Turn 2 reported `connection: connected`.
  - A send that changed the URL recycled the worker. The report returned to
    `unknown`, the stub saw the new path with the bearer, and the same Copilot
    session was resumed.
  - The token did not appear in create, list, detail or stream bodies, in the
    temporary Runtime directory, in Runtime output or under `~/.copilot`.
  - Not covered: `tools/call`. The account's Copilot quota rejected every
    model call with HTTP 402 (`quota_exceeded`), including the 0x-premium
    `gpt-5-mini`, so the model never reached a tool call.
  - Direct probes of Kiro, Grok and Auggie ran against the same stub. Their
    Kiro and Grok sessions were deleted with each CLI's own delete command.
    Auggie ran with `--dont-save-session`. Copilot has no non-interactive
    delete, so its three probe sessions remain in `~/.copilot/session-state`.

F3 notes for consumers:

- Treat Copilot like Claude for instructions: name the tools the model should
  call. Connection evidence arrives during a turn, so the first report after
  create or recycle shows `connection: unknown`.
- The inline JSON always contains `"`. It reaches Copilot intact when Runtime
  resolves the npm shim to `node <script>` (the default, and the smoke path).
  If that resolution fails, the Windows launcher falls back to the PowerShell
  proxy, which was not exercised with this argument.
- A server that stalls while connecting is still bounded by the instance
  `timeout_ms`. The worker re-arms its inactivity timer on each event, and
  Copilot emits `pending` before it connects.
- Known gap, not changed here: the Copilot adapter does not surface
  `session.error`. A quota rejection therefore ends the Runtime stream with an
  empty `result` and no error text.
- Grok and Kiro are the closest candidates. Each has a working per-run route
  (a Grok agent file with `bearer_token_env_var`, or the Kiro v2 agent
  directory), but it would replace the session's primary agent or give up
  model selection. Revisit either one if the CLI adds a per-run MCP flag.

Release boundary: an additive capability within the current 0.x line. No HTTP,
configuration or persisted-data contract changes. The existing
`continuity.sessionMcpServers` field now reads `true` for native Copilot
targets. No migration and no version bump. The version is chosen at release
time under the release SOP.

## Validation

Follow AGENTS.md Local Validation Scope. Focused Vitest files for the touched
routes, adapters and pool, plus `npm run typecheck`. Live smokes use temporary
runtime directories and a stub server, never `~/.cats/runtime`. Full CI gates
the merge.

*Created: 2026-09-29*
