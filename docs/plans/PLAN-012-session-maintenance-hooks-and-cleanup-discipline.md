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
- [cats research: OpenClaw chat runtime gap analysis](../../../cats/docs/research/2026-03-20-openclaw-chat-runtime-gap-analysis.md)
- [cats research: OpenClaw memory layering benchmark](../../../cats/docs/research/2026-03-19-openclaw-memory-layering-benchmark.md)

## Overview

`cats-runtime` already had first-slice run inspection plus explicit
`close` / `cancel` / `reset` routes, but long-running session discipline still
had gaps:

- reset boundaries were not explicit beyond clearing provider resume state
- close/delete semantics did not leave a stable machine-readable lifecycle mark
- compaction readiness existed only as an implied future concern
- Team 6 had no runtime-owned seam for pre-reset or pre-compaction memory flush
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
  `memory_flush` hooks before reset/compaction, but Team 6 remains responsible
  for the eventual memory export pipeline.
- Treat compaction readiness as metadata, not as a command. Hosts can read the
  readiness contract without implying a new public `/compact` route.
- Preserve evidence transcripts; reset clears live runtime boundary state
  (provider resume state, wakeups, hydration, run/progress snapshots) without
  deleting historical evidence.
- Keep delete cleanup summaries route-owned because they describe a terminal
  action whose session object no longer exists after success.

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-23 | Plan created and implemented in the same Team 4 lifecycle pass |

---

*Created: 2026-03-23*
*Author: Codex*
