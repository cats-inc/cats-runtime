# Roadmap

> Long-term project planning and milestones.

## Optimizations

### OPT-1: WSL Discovery Policy and Visibility

**Priority**: P1
**Status**: In Progress

#### Problem

`CursorNativeSessionService` and `KiroNativeSessionService` scan CLI sessions inside WSL by spawning `wsl -d Ubuntu bash -lc "python3 -c 'import base64; exec(...)'"`. This triggers the entire WSL VM to start (if stopped), which in turn causes systemd to auto-start all enabled services (e.g. `openclaw-gateway`), consuming 1GB+ RAM. On low-memory machines (8GB), this makes it difficult to run other VM-based features (e.g. Claude Desktop Cowork) concurrently.

#### Current Flow

1. `cats-runtime` polls for Cursor/Kiro sessions
2. For WSL sessions, it spawns `wsl -d Ubuntu bash -lc "python3 ..."` (see `src/backends/cli/runtime/runtime.ts:170-176`)
3. Python script reads SQLite databases inside WSL to extract session data
4. WSL Ubuntu starts up, systemd boots all enabled services, RAM usage spikes

#### Phase 1 Direction

Introduce an explicit WSL discovery policy for Windows/WSL-backed providers, and
surface its current behavior in the dashboard.

- Add `CATS_RUNTIME_WSL_DISCOVERY_POLICY` to control whether background
  Cursor/Kiro discovery may start WSL
- Start with three policies:
  - `always`: preserve the current behavior
  - `if_running`: scan only when the configured distro is already running
  - `manual_only`: never start WSL from background discovery
- Record discovery state so the UI can show whether scans are active, skipped,
  disabled, or failing
- Expose discovery status through a dedicated runtime endpoint for dashboard use
- Add a global dashboard indicator that shows both the configured policy and the
  current WSL discovery state

Current implementation status:

- Implemented `CATS_RUNTIME_WSL_DISCOVERY_POLICY`
- Implemented `GET /discovery/status`
- Implemented dashboard header visibility for WSL discovery state
- Deferred manual discovery overrides such as `startIfNeeded`

#### Deferred Optimization

Direct Windows-side SQLite reads via `\\wsl$\Ubuntu\...` (or
`\\wsl.localhost\Ubuntu\...`) remain an optional follow-up optimization, not the
first response.

This path should only be revisited if policy-based skipping is insufficient and
there is still a measurable need to reduce scan latency or remove the embedded
Python readers.

#### Rationale

- The primary pain is unintended WSL activation during background polling, not
  Python itself
- `\\wsl$\` is not a complete fix because it can still activate WSL when the
  distro is stopped
- A policy-first design is lower-risk than introducing new native SQLite
  dependencies and cross-platform filesystem edge cases

#### Affected Files

- `src/backends/cli/config.ts`
- `src/server.ts`
- `src/http/app.ts`
- `src/http/routes/health.ts` or a new discovery status route
- `public/index.html`
- `src/backends/cli/runtime/runtime.ts`
- `src/backends/cli/cursor/CursorNativeSessionService.ts`
- `src/backends/cli/kiro/KiroNativeSessionService.ts`
- `docs/specs/SPEC-001-wsl-discovery-policy.md`
- `docs/plans/PLAN-001-wsl-discovery-policy.md`

---

*Last updated: 2026-03-13*
