# PLAN-012: Session Maintenance Hooks and Cleanup Discipline

> Implementation plan for runtime-owned session maintenance metadata, reset
> boundaries, and cleanup discipline that keep long-running sessions predictable
> without moving memory extraction into `cats-runtime`.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / Team 4 runtime lifecycle workstream |

## Related Specs / Research

- [SPEC-010: Usage Metering, Rate-Limit Detection, and Execution Guardrails](../specs/SPEC-010-usage-metering-rate-limit-detection-and-execution-guardrails.md)
- [SPEC-011: Session Fork and Context-Transplant Primitives](../specs/SPEC-011-session-fork-and-context-transplant-primitives.md)
- [ADR-012: Separate Evidence, Durable Memory, and Retrieval Layers](../decisions/012-separate-evidence-memory-and-retrieval-layers.md)
- [cats research: OpenClaw chat runtime gap analysis](../../../cats-platform/docs/research/2026-03-20-openclaw-chat-runtime-gap-analysis.md)
- [cats research: OpenClaw memory layering benchmark](../../../cats-platform/docs/research/2026-03-19-openclaw-memory-layering-benchmark.md)

## Overview

`cats-runtime` already had first-slice run inspection plus explicit
`close` / `cancel` / `reset` routes, but long-running session discipline still
had gaps:

- reset boundaries were not explicit beyond clearing provider resume state
- close/delete semantics did not leave a stable machine-readable lifecycle mark
- compaction readiness existed only as an implied future concern
- Team 4/product memory work had no runtime-owned seam for pre-reset or
  pre-compaction memory flush
- stale run/progress state could survive a reset and blur the next session
  boundary

This slice adds a lightweight maintenance contract without turning runtime into
a full memory pipeline or a scheduler.

## Scope

### In Scope

- additive `inspection.maintenance` contract on session/history/observe reads
- runtime-owned lifecycle markers for `close`, `reset`, and `delete`
- explicit hard-reset boundary metadata
- compaction-readiness metadata for long-running sessions
- additive pre-reset / pre-compaction hook seam for future memory flush work
- machine-readable delete cleanup summaries
- clearing stale runtime run/progress state on reset

### Out of Scope

- actual compaction execution
- memory extraction / summarization / retrieval pipelines
- provider compatibility or MCP facade work
- product-side run inspector UI

## Implementation Phases

### Phase 1: Maintenance Contract

- [x] Add runtime-owned maintenance contract types for lifecycle markers,
      compaction readiness, hook groups, and cleanup summaries
- [x] Add a shared `sessionMaintenance` builder under `src/core/runtime`

### Phase 2: Lifecycle State Integration

- [x] Extend `RuntimeSessionManager` with lifecycle markers and hard-reset
      boundary tracking
- [x] Ensure reset clears stale run/progress/recent-event state instead of
      leaking it across the next session boundary

### Phase 3: Route Wiring

- [x] Surface additive maintenance metadata through session/history inspection
- [x] Add machine-readable delete cleanup metadata and retained-delete markers
- [x] Keep route changes additive and confined to session lifecycle surfaces

### Phase 4: Verification and Documentation

- [x] Add unit tests for compaction/hook/cleanup derivation
- [x] Extend session close/reset/delete route tests
- [x] Update `README.md`, `docs/api.md`, `docs/architecture.md`, and
      `PROGRESS.md`
- [x] Run `npm run build` and `npm test`

## Technical Decisions

- Keep the memory-flush seam declarative: runtime advertises pending
  `memory_flush` hooks before reset/compaction, but Team 4/product memory
  remains responsible for the eventual memory export pipeline.
- Treat compaction execution as external. Runtime may expose a public
  `/sessions/{id}/compact` preparation route for readiness and hook
  coordination, but it still does not execute compaction itself.
- Preserve evidence transcripts; reset clears live runtime boundary state
  (provider resume state, wakeups, hydration, run/progress snapshots) without
  deleting historical evidence.
- Keep delete cleanup summaries route-owned because they describe a terminal
  action whose session object no longer exists after success.

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-23 | Plan created and implemented in the same Team 4 lifecycle pass |
| 2026-03-24 | Follow-up hardening added persisted `inspection.maintenance.lastRequest` metadata plus additive route-level maintenance trigger payloads for close/reset/delete |
| 2026-03-24 | Added public `POST /sessions/{id}/compact` as an external-only compaction-preparation seam backed by the same maintenance contract |
| 2026-03-24 | Generalized persisted maintenance follow-through over `POST /sessions/{id}/maintenance/follow-through`, with compaction-specific HTTP/MCP shortcuts retained for compatibility |
| 2026-03-24 | Added opt-in `requireAcknowledgedHooks` gating for reset/delete/workspace cleanup so destructive lifecycle routes can stop on pending action-scoped hooks before mutating session state |

---

*Created: 2026-03-23*
*Author: Codex*
