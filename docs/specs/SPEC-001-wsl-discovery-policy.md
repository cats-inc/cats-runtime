# SPEC-001: WSL Discovery Policy and Dashboard Status

> Define how `cats-runtime` should control and expose WSL-backed native session
> discovery for Cursor and Kiro.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | TBD |

## Summary

`cats-runtime` currently treats WSL-backed Cursor/Kiro discovery as an
unconditional background scan. On Windows, that means the runtime can
accidentally wake a stopped WSL distro every few seconds just to inspect native
sessions. This feature introduces an explicit discovery policy, separates
configured behavior from current live state, and exposes that state to the
dashboard so users can understand why scans are running, skipped, or disabled.

## Goals

- Prevent accidental WSL activation during background discovery when the user
  wants conservative behavior
- Make WSL discovery behavior explicit and configurable in `.env`
- Surface both configured policy and current live state in the dashboard
- Preserve a path for intentional, user-driven discovery without forcing a full
  storage-reader rewrite first

## Non-Goals

- Rewriting Cursor/Kiro SQLite readers from Python to Node.js in this phase
- Replacing the embedded dashboard with a separate frontend application
- Changing non-WSL provider discovery behavior
- Removing existing manual discovery endpoints

## User Stories

- As a Windows user with limited RAM, I want background discovery to avoid
  waking WSL unless I explicitly allow it.
- As a dashboard user, I want to see whether WSL discovery is active, skipped,
  or disabled so the runtime does not feel opaque.
- As a developer, I want a clear policy model so future runtime changes do not
  reintroduce unconditional WSL activation by accident.

## Requirements

### Functional Requirements

1. The system shall support a new environment variable named
   `CATS_RUNTIME_WSL_DISCOVERY_POLICY`.
2. The initial policy values shall be:
   - `always`: background discovery may start WSL in order to scan Cursor/Kiro
   - `if_running`: background discovery shall scan only when the configured WSL
     distro is already running
   - `manual_only`: background discovery shall not start WSL and shall skip
     WSL-backed Cursor/Kiro scans
3. The policy shall apply only to WSL-backed native discovery paths. Providers
   configured for `native` runtime mode shall continue to behave normally.
4. The runtime shall keep machine-readable discovery status that distinguishes:
   - configured policy
   - configured runtime mode and distro per provider
   - whether a provider scan ran, was skipped by policy, was disabled, or failed
   - the most recent scan timestamp and outcome message when available
5. The runtime shall expose discovery status through a dedicated HTTP endpoint
   suitable for dashboard polling.
6. The dashboard shall show a global WSL discovery indicator that includes:
   - the configured policy
   - the current overall WSL discovery state
   - enough detail to explain whether Cursor/Kiro scans are active or skipped
7. Manual discovery endpoints for Cursor/Kiro shall remain available. They may
   later support an explicit `startIfNeeded` override, but that is not required
   for the first UI-only visibility slice.

### Non-Functional Requirements

- **Safety**: Conservative policies must avoid waking WSL during background
  polling.
- **Clarity**: Dashboard state must separate configuration from current runtime
  behavior.
- **Compatibility**: Existing installs should continue to work when the new env
  var is absent.
- **Maintainability**: The first implementation should avoid adding new native
  SQLite dependencies unless policy controls prove insufficient.

## Design Overview

```text
.env / config
  -> WSL discovery policy
  -> background discovery controller
  -> per-provider discovery state
  -> HTTP discovery status endpoint
  -> dashboard header badge / state text
```

Recommended rollout:

- Keep parser fallback compatible with current behavior when the env var is
  absent
- Set `.env.example` and setup docs to recommend `if_running` for Windows/WSL
  use cases
- Defer `\\wsl$` direct-file reads until policy controls are in place and
  validated

## Dependencies

- Existing background discovery loop in `src/server.ts`
- Existing runtime config parsing in `src/backends/cli/config.ts`
- Existing dashboard polling in `public/index.html`

## Open Questions

- [ ] Should `if_running` become the runtime default in a later compatibility
      break, or stay as a documented opt-in?
- [ ] Should the first UI slice show only a global badge, or also expose
      per-provider detail inline?

## References

- [PLAN-001: WSL Discovery Policy and Dashboard Visibility](../plans/PLAN-001-wsl-discovery-policy.md)
- [Roadmap](../../ROADMAP.md)
- [Architecture](../architecture.md)

---

*Created: 2026-03-13*
*Author: Codex*
*Related Plan: [PLAN-001](../plans/PLAN-001-wsl-discovery-policy.md)*
