# PLAN-046: Session MCP servers

Status: In progress (2026-09-29). R1 is on `feat/session-mcp-servers`.
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

- [ ] Verify `${VAR}` expansion in `--mcp-config` headers on the installed CLI
  (2.1.284). If it does not work, use an owner-only temporary file removed at
  worker exit.
- [ ] Add `--mcp-config` and `mcp__<name>` in `--allowedTools`, and enable the
  capability.
- [ ] Recycle a live worker at the turn boundary when the set changes (SMCP-08).
- [ ] Parse `system:init.mcp_servers` into per-server `connection`.
- [ ] Run an isolated live smoke against a stub loopback MCP server.

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
