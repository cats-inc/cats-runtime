# PLAN-046: Session MCP servers

Status: In progress (2026-09-29). R1 is in PR #130. R2 is on `feat/session-mcp-claude`,
stacked on R1.
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
- Session reads map `resume`/`fork`/`permissions` explicitly and do not surface
  `sessionMcpServers`, so list and detail reads stay consistent. Exposing the
  capability remains R4.

## R3 — Codex

- [ ] Add `-c mcp_servers.<name>.url` / `bearer_token_env_var` through
  `composeLaunchArgs` and enable the capability. Codex 0.158.0 supports
  `--url` and `--bearer-token-env-var`.
- [ ] Approve tool calls and elicitations for the configured servers only. Keep
  the current decline for all other servers.
- [ ] `startWindowsCodexHost` receives the merged child environment. Decide
  whether the Code Mode host needs the bearer or should get a stripped env.
- [ ] Run an isolated live smoke as in R2.

## R4 — Surfacing and release boundary

- [ ] Expose `sessionMcpServers` in provider tooling/continuity reads.
- [ ] Record the release boundary: an additive optional field within the current
  0.x line. The version is chosen at release time under the release SOP. This
  plan authorizes no bump.

## Validation

Follow AGENTS.md Local Validation Scope. Focused Vitest files for the touched
routes, adapters and pool, plus `npm run typecheck`. Live smokes use temporary
runtime directories and a stub server, never `~/.cats/runtime`. Full CI gates
the merge.

*Created: 2026-09-29*
