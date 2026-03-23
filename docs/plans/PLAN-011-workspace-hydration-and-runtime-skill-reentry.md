# PLAN-011: Workspace Hydration and Runtime Skill Re-entry

> Implementation plan for making session create/resume/fork re-enter the same
> workspace and runtime-skill context more reliably across CLI targets.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Specs

- [SPEC-005: Runtime-Managed Skills v0](../specs/SPEC-005-runtime-managed-skills-v0.md)
- [SPEC-008: Workspace Substrate Init, Audit, and Update](../specs/SPEC-008-workspace-substrate-init-audit-and-update.md)

## Related ADRs

- [ADR-015: Own Workspace Substrate Tools in `cats-runtime`](../decisions/015-own-workspace-substrate-tools-in-cats-runtime.md)

## Overview

`cats-runtime` already has first-slice runtime-managed skills, workspace
substrate tools, and additive session inspection payloads. The remaining gap is
execution-time re-entry discipline:

- backend-specific skill delivery state can go stale across `resume`
- `fork` can accidentally carry parent delivery metadata into a different
  provider/backend target
- isolated sandboxes can be mistaken for the long-term workspace truth
- create/resume/fork do not share one explicit hydration seam that later
  product-side context layers can hook into

This plan lands a runtime-owned hydration layer that keeps the public route
surface additive while making re-entry behavior consistent and testable.

## Goals

1. Recompute or re-materialize runtime-managed skill delivery when the target
   backend/workspace changes or persisted artifacts are missing.
2. Add a runtime-owned workspace hydration summary that distinguishes runtime
   cwd from the authoritative workspace source when they differ.
3. Route session create/resume/fork through one shared hydration path.
4. Keep the hydration seam generic enough for future product-owned companion
   context without hard-coding product schema into runtime.
5. Update docs/tests/PROGRESS together with the additive session metadata.

## Non-Goals

- redesigning `/sessions`, `/observe`, or `/history`
- adding provider compatibility/remediation behavior
- moving companion-box or product-owned durable state into runtime
- rewriting workspace substrate apply policy or generic delivery governance

## Implementation Phases

### Phase 1: Shared Hydration Contract

- [x] Add runtime types for workspace/skill hydration state and a generic
      future-facing metadata seam
- [x] Add a shared hydration module that can rebuild skill manifests from
      persisted session state and compute workspace hydration provenance
- [x] Define re-entry rules for filesystem, instruction-file, and unsupported
      skill delivery modes

**Deliverables**: runtime-owned hydration types plus a reusable re-entry helper

### Phase 2: Lifecycle Wiring

- [x] Route `POST /sessions` through the hydration helper after workspace
      resolution
- [x] Route `POST /sessions/{id}/resume` through the hydration helper so stale
      Codex/Pi artifacts are re-materialized before spawn
- [x] Route `POST /sessions/{id}/fork` through the hydration helper so provider
      switch and workspace-mode changes re-resolve delivery state instead of
      copying parent delivery metadata blindly
- [x] Persist additive hydration metadata in session state/history/observe

**Deliverables**: consistent create/resume/fork hydration behavior

### Phase 3: Verification and Docs

- [x] Add route-level regressions for Codex/Pi re-entry and provider-switch fork
- [x] Add unit coverage for workspace hydration provenance and persisted-state
      re-entry
- [x] Update `README.md`, `docs/api.md`, `docs/architecture.md`,
      `docs/plans/README.md`, and `PROGRESS.md`

**Deliverables**: documented and verified hydration contract

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/types.ts` | Modify | Add hydration state contracts |
| `src/core/skills/catalog.ts` | Modify | Rebuild skill manifests from persisted state and detect missing materializations |
| `src/core/runtime/WorkspaceSubstrateService.ts` | Modify | Reuse audit logic for read-only workspace hydration summaries |
| `src/backends/cli/pool/workspace.ts` | Modify | Preserve workspace provenance for isolated sandboxes |
| `src/backends/cli/pool/SessionRegistry.ts` | Modify | Persist hydration metadata and clone it safely |
| `src/backends/cli/providers/codex.ts` | Modify | Keep re-entry assumptions aligned with filesystem hydration |
| `src/backends/cli/providers/pi.ts` | Modify | Keep re-entry assumptions aligned with instruction-file hydration |
| `src/http/routes/sessions.ts` | Modify | Use the shared hydration path for create/resume/fork |
| `src/http/routes/messages.ts` | Modify | Keep skill mutation and Pi re-entry on the same hydration rules |
| `src/http/routes/history.ts` | Modify | Surface additive hydration metadata |
| `src/http/routes/observe.ts` | Modify | Surface additive hydration metadata |

## Technical Decisions

- Prefer additive session metadata over a route redesign so Team 2/3 can adopt
  the hydration contract incrementally.
- Treat persisted requested skills as the canonical re-entry input; backend-
  specific delivery artifacts are re-derived runtime-owned outputs.
- Distinguish runtime cwd from authoritative workspace source so isolated
  sandboxes do not become the only truth when a real workspace origin exists.

## Testing Strategy

- **Unit Tests**: hydration helper, persisted-skill re-entry, workspace
  provenance cloning/persistence
- **Integration Tests**: create/resume/fork across Codex and Pi, especially
  provider-switch forks and missing materialization recovery
- **Regression Tests**: history/observe/session payloads continue to expose the
  current skill/workspace state additively without breaking existing routes

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Re-entry logic drifts between routes again | High | Centralize resolution in one hydration helper |
| Hydration metadata leaks product-specific schema | Medium | Keep the seam generic and runtime-owned; reserve only a plain metadata bag for future layers |
| Resume mutates shared workspaces too aggressively | Medium | Keep workspace substrate checks read-only and re-materialize only runtime-owned artifacts |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-23 | Plan created for workspace hydration and runtime skill re-entry |
| 2026-03-23 | Implemented shared hydration seam, route wiring, tests, and docs updates |

---

*Created: 2026-03-23*
*Author: Codex*
