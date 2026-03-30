# PLAN-010: Session Discipline and Run Inspector Contracts

> Implementation plan for runtime-owned session lifecycle symmetry and
> machine-readable inspection payloads that product-side run inspectors can
> consume directly.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / Team 3 integration |

## Related Specs

- [SPEC-003: Agent Backend](../specs/SPEC-003-agent-backend.md)
- [SPEC-010: Usage Metering, Rate-Limit Detection, and Execution Guardrails](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- [SPEC-011: Session Fork and Context Transplant Primitives](../specs/SPEC-011-session-fork-and-context-transplant-primitives.md)
- [2026-03-19 Paperclip Gap Assessment](../research/2026-03-19-paperclip-gap-assessment.md)
- [Cats Paperclip Killer Feature Gap Analysis](../../../cats-platform/docs/research/2026-03-20-paperclip-killer-feature-gap-analysis.md)

## Overview

The next runtime slice is not another provider subsystem. It is lifecycle rigor
and trust.

`cats-runtime` already has first-slice agent backends, runtime-managed skills,
compatibility, usage metering, guardrails, and provider-agnostic progress. What
is still weak is the runtime's ability to answer:

- what this session is doing right now
- why it woke
- what the last run produced
- whether it is blocked / cooling down / stale
- what close / delete / cancel / reset actually do across backend families

This plan adds one runtime-owned run-inspection contract plus additive lifecycle
operations so product-side run inspector surfaces can consume stable data
without re-parsing provider-native logs.

## Scope

### In Scope

- runtime-owned per-session execution state and last-run inspection snapshot
- additive inspection payloads on session, history, and observe routes
- additive `cancel` and `reset` session routes
- stronger backend lifecycle symmetry across `cli`, `api`, and `agent`
- remote agent cleanup through adapter hooks on close / cancel / delete / reset
- session-scoped metering / incident / guardrail projection for inspection
- light preview/service/artifact links suitable for run inspector surfaces

### Out of Scope

- scheduled wakeups or queueing/scheduler behavior
- product-side approval policy, UI, or chat rendering
- compatibility install/check metadata
- provider catalog or setup UX redesign
- full provider-native log archival redesign

## Implementation Phases

### Phase 1: Runtime-Owned Run State

- [x] Add shared inspection and run-state contract types in `src/core/types.ts`
- [x] Extend `RuntimeSessionManager` with per-session run snapshots and session
      lifecycle helpers
- [x] Extend `ManagedExecutionHandle` so remote-backed handles support explicit
      cancel vs close semantics

**Deliverables**: runtime can represent current state, wake reason, last run,
progress snapshot, and recent event excerpts independent of transcript history.

### Phase 2: Backend Lifecycle Symmetry

- [x] Route agent-backed close / cancel / delete / reset through adapter-aware
      remote cleanup instead of local handle close only
- [x] Add best-effort cancel symmetry for API and CLI backends
- [x] Keep close/delete wire format stable where possible while making backend
      behavior more honest

**Deliverables**: backend families behave more consistently and remote agent
cleanup is not skipped.

### Phase 3: HTTP Inspection Surfaces

- [x] Add machine-readable inspection payloads to `/sessions`
- [x] Extend `/sessions/{id}/history` with the same inspection block
- [x] Add `/sessions/{id}/observe` JSON payload while keeping
      `/sessions/{id}/stream` for live SSE
- [x] Add additive `POST /sessions/{id}/cancel` and
      `POST /sessions/{id}/reset`

**Deliverables**: Team 3 can consume one stable run-inspector contract across
list/detail/history/observe surfaces.

### Phase 4: Verification and Documentation

- [x] Update backend/session/history/observe tests for lifecycle and inspection
      behavior
- [x] Update `docs/api.md`, `docs/architecture.md`, and `PROGRESS.md`
- [x] Record lifecycle/inspection status in this plan and linked docs
- [x] Run targeted `cats-runtime` build/tests

**Deliverables**: docs match shipped behavior and the new contract has
regression coverage.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/types.ts` | Modify | Add runtime inspection, run-state, and session-scoped metering contract types |
| `src/core/runtime/ManagedExecutionHandle.ts` | Modify | Support explicit cancel/close semantics for managed backends |
| `src/core/runtime/RuntimeSessionManager.ts` | Modify | Track per-session run state and lifecycle helpers |
| `src/core/runtime/sessionInspection.ts` | Create | Build machine-readable inspection payloads and preview hints |
| `src/core/usage/RuntimeMeteringService.ts` | Modify | Expose session-scoped metering / incident / guardrail reads |
| `src/backends/agent/runtime/AgentBackendManager.ts` | Modify | Honor remote cleanup hooks for close/cancel/delete/reset |
| `src/backends/api/runtime/ApiBackendManager.ts` | Modify | Support explicit cancel/close lifecycle helpers |
| `src/backends/cli/pool/WorkerPool.ts` | Modify | Add best-effort cancel helper for CLI workers |
| `src/backends/cli/pool/WorkerProcess.ts` | Modify | Separate turn cancel from full worker close where possible |
| `src/http/routes/messages.ts` | Modify | Feed run-state updates during turn execution |
| `src/http/routes/sessions.ts` | Modify | Surface inspection and add cancel/reset routes |
| `src/http/routes/history.ts` | Modify | Surface inspection with history payloads |
| `src/http/routes/observe.ts` | Modify | Add JSON observe payload and keep SSE stream route |
| `tests/*.test.ts` | Modify | Cover lifecycle symmetry, inspection payloads, and remote cleanup |

## Technical Decisions

- Keep inspection additive. Existing session/history payloads remain valid and
  gain an `inspection` block.
- Put per-session run state in `RuntimeSessionManager`, not in persistent
  `SessionInfo`, so close/delete can drop handles without losing the last run.
- Reuse existing metering/guardrail/progress subsystems instead of rebuilding
  them inside inspection.
- Treat `cancel` and `reset` as lifecycle primitives separate from `close` and
  `delete`, but allow backend-specific best-effort implementation where the
  provider cannot guarantee stronger semantics.
- Prefer explicit action/read-model fields over provider-native log parsing.

## Testing Strategy

- **Unit Tests**:
  - runtime session manager run-state transitions
  - managed execution handle cancel vs close behavior
  - agent backend remote cleanup hooks
- **Integration Tests**:
  - `/sessions` inspection payload
  - `/sessions/{id}/history` inspection payload
  - `/sessions/{id}/observe` snapshot + `/stream` coexistence
  - `/sessions/{id}/cancel` and `/sessions/{id}/reset`
  - agent-backed close/delete/reset issuing remote cleanup requests
- **Manual Testing**:
  - start a run, inspect `/sessions` and `/observe` while active
  - cancel a run and verify inspection shows canceled state
  - reset a stale session and verify next resume creates a fresh provider state

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Inspection payload becomes a second transcript format | Medium | Keep it state-oriented: current/last run, wake, progress snapshot, outputs, actions |
| Backend semantics still differ subtly | Medium | Normalize route contract and document best-effort cases explicitly |
| Remote cancel hooks are flaky across external agent runtimes | Medium | Treat adapter cleanup as best-effort but always surface the attempted lifecycle outcome |
| Session list payload becomes heavy | Medium | Keep inspection compact and bounded; use `/observe` for detail |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-23 | Plan created and implementation started |
| 2026-03-23 | Completed lifecycle symmetry, inspection payloads, cancel/reset routes, and targeted verification for Team 3 run inspector integration |

---

*Created: 2026-03-23*
*Author: Codex*
