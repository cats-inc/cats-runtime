# PLAN-049: Provider Session Capabilities and Interactions

## Metadata

| Field | Value |
| --- | --- |
| Status | In progress; Runtime interaction core implemented, transport and consumers pending |
| Owner | Runtime execution boundary |
| Assigned To | Unassigned |
| Reviewer | Product owner and consumer maintainers |
| Related spec | [SPEC-039](../specs/SPEC-039-provider-session-capabilities-and-interactions.md) |
| Decision | [ADR-048](../decisions/048-bridge-provider-interactions-and-report-effective-session-capabilities.md) |

## Overview

The owner approved the documented direction on 2026-10-28 and requested auto-merged
documentation PRs, latest-source integration and incremental implementation commits.
Publication remains a separate authorization.
Implement the control contract once in Runtime, then integrate Platform and Bots
independently. Native Windows Codex is the first measured end-to-end target.

## Implementation Phases

### P0 — Freeze the contract and capture protocol evidence

- [ ] Review ADR-048/SPEC-039 with `cats-platform SPEC-132 / PLAN-124` and
  `cats-bots SPEC-004 / PLAN-004`; freeze schemas, limits and capability negotiation.
- [ ] Characterize existing default/skip/whitelist, read-only, ADR-041 dynamic
  tools and SPEC-035 injection behavior, including the MCP `approve` overlay.
- [ ] Capture sanitized request/reply/resolve fixtures from the selected Codex
  executable. Confirm user-input aliases, form/URL completion and initialization
  capabilities without relying solely on documentation or version equality.
- [ ] Freeze execution-policy source/constraints, event compatibility, typed
  responses, deadlines, receipt retention and failure/restart semantics.
- [ ] Inventory affected persisted settings and determine whether additive reads
  suffice or protected migrations are required in each owner repository.

**Exit:** both consumers can implement against one reviewed fixture/schema set;
unknown variants and packaging prerequisites are explicitly recorded.

### P1 — Runtime interaction registry and control transport

- [ ] Add per-session/generation request storage, authenticated reads/responses,
  bounded snapshots and negotiated stream events.
- [ ] Route replies through the backend/worker control channel while a turn is
  occupied; retain existing turn serialization.
- [ ] Validate typed bodies, revision/idempotency, authorization boundary and
  races against cancellation, process exit and provider resolution.
- [ ] Separate human deadlines from model/idle timeouts and preserve responsive
  cancellation. Reconcile snapshot/stream without duplicating requests.

**Exit:** fixture provider and HTTP consumer complete A1–A3/A6; an incapable or
disconnected host cannot cause an unbounded wait or automatic grant.

### P2 — Codex mapping and explicit execution policy

- [ ] Adapt supported server requests and resolution notifications; keep native
  identifiers and response schemas private to the adapter.
- [ ] Add provider-policy and explicit-policy modes, effective-policy verification
  and the opt-in MCP approval overlay. Reject incompatible host constraints.
- [ ] Preserve old callers, read-only workflows, explicit read grants and session
  MCP credentials. Detect user/injected server-name collisions.
- [ ] Expose support/mismatch reasons; test unsupported modes on non-native targets
  and other providers without changing their existing execution paths.

**Exit:** A4/A6 pass and a live Codex request completes through Runtime. No permission
label or process-start success substitutes for effective-policy evidence.

### P3 — Session inventory and dependency observations

- [ ] Read paginated inventory through the current worker; report completeness,
  observation identity, policy coverage and stale/no-worker states.
- [ ] Keep configured/injected/dynamic tool provenance distinct; avoid leaking
  secrets or claiming a lazy tool host's nested catalog is complete.
- [ ] Report helper/browser availability with evidence and bounded refresh.
  Do not start another model turn or take ownership of upstream helper processes.

**Exit:** A5 passes with global and injected MCP, unavailable auth/helper and partial
discovery. Read-only inspection does not execute a sample tool.

### P4 — Consumer integration and matched-environment acceptance

- [ ] Supply contract fixtures to Platform PLAN-124 and Bots PLAN-004.
- [ ] Complete each host's request/reply, reconnect, cancel, expiry and stale-response
  checks. Use temporary state and explicit test destinations.
- [ ] Compare terminal vs each host with the same executable/account/config/cwd,
  project trust and policy; record intentional differences and provider limits.
- [ ] Separately verify a controlled Chrome navigation/read and a harmless desktop
  interaction in a dedicated test window. Record target identity, tool invocation
  and observed result, then verify helper-off behavior. Do not use user data as fixtures.
- [ ] Record Windows evidence separately from macOS/Linux and packaged acceptance;
  do not mark unsupported or unrun cells successful.

**Exit:** A7/A8 and consumer criteria pass. Discovery alone cannot complete this phase.

### P5 — Compatibility and release preparation, when authorized

- [ ] Pin the exact Runtime source/artifact for each consumer; old Runtime must
  show capability unavailable rather than silently starting a different mode.
- [ ] Verify any protected migration and rollback/failure behavior before changing
  persisted policy. Never migrate an existing setting to broader access implicitly.
- [ ] Prepare notes and version boundaries: additive opt-in within 0.6.x; changed
  legacy meaning needs the next minor. Bump/publish only under release authorization.

## Files to Create/Modify

| Area | Intended change |
| --- | --- |
| `src/core`, `src/http` | Capability contract, registry, control routes and streams |
| `src/backends/cli/pool/WorkerProcess.ts` | Pending-request lifecycle and reply path |
| `src/backends/cli/providers/codex.ts` | Native request mapping, policy verification and discovery |
| Existing provider/worker/HTTP tests | Regression fixtures and interaction races |
| `docs/api.md`, `docs/architecture.md` | Publish implemented contract only when it exists |

## Testing Strategy and Risks

Use focused fixtures first, then affected transport/consumer tests. Live checks use
isolated Runtime/Bot/Platform state and authorized test surfaces; no exploratory
model turn is needed for discovery. Reuse existing auth through supported provider
selection rather than copying credentials into fixtures.

Key risks are a response stuck behind its own turn, a stale reply reaching a new
worker, policy inheritance exceeding host intent, and a catalog falsely implying
working computer access. Each has an explicit acceptance criterion in SPEC-039.
Fixture captures record versions as provenance, never as an execution allowlist.

## Progress Log

| Date | Update |
| --- | --- |
| 2026-10-28 | Worktree documentation drafted from source inspection and prior discovery; P0–P5 not started. Runtime behavior, versions and user settings unchanged. |
| 2026-10-28 | P1 core slice: bounded generation-scoped interaction store, strict typed answers, idempotent delivery, cancellation/deadlines and redacted receipts. All 16 focused tests and TypeScript check pass. Independent review found action coercion and responding-timeout defects; both fixed and independently rechecked. No HTTP/provider integration is claimed yet. |
| 2026-10-28 | P1/P2 transport slice connects native worker callbacks, negotiated create/resume hosts and authenticated snapshots/responses. Synthetic worker proves replies bypass the occupied model turn and cancellation invalidates callbacks. Focused interaction/HTTP/worker tests: 30 pass; Codex/read-tool regressions: 98 pass; worker/pool regressions: 29 pass; session HTTP tests: 14 pass. Independent review led to experimental/form capability negotiation, fallback tombstones, strict form constraint rejection and transactional host negotiation. A wire-order test covers provider resolution immediately before turn completion. Policy/inventory and both consumers remain pending. |

*Created / last updated: 2026-10-28*
