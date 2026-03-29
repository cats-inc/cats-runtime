# PLAN-024: Runtime Skill Library, Setup Diagnostics, and Wakeup Follow-Through

> Implementation plan for the highest-value follow-on work that previously
> lived only in `PROGRESS.md` / `ROADMAP.md` across `SPEC-013`,
> `SPEC-015`, and `SPEC-012`.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / runtime workstream |

## Related Specs

- [SPEC-013: Internal Skill Library and Role Taxonomy](../specs/SPEC-013-internal-skill-library-and-role-taxonomy.md)
- [SPEC-015: Runtime Setup Diagnostic Report](../specs/SPEC-015-runtime-setup-diagnostic-report.md)
- [SPEC-012: Scheduled Wakeup Substrate](../specs/SPEC-012-scheduled-wakeup-substrate.md)

## Overview

`cats-runtime` now has meaningful landed slices for:

- the runtime-owned internal skill library
- setup diagnostic report generation and read surfaces
- the scheduled wakeup substrate

Those three areas are no longer speculative, but their remaining work is still
tracked as scattered follow-through across `PROGRESS.md` and `ROADMAP.md`
instead of one implementation plan.

That fragmentation now costs more than it saves:

- it hides priority across three still-important runtime-owned seams
- it makes it harder to cut focused implementation slices
- it leaves future contributors guessing whether the remaining work belongs to
  skills, setup/bootstrap, or wakeup orchestration

This plan consolidates the remaining high-value follow-through into one place.

Priority is re-evaluated as:

1. `SPEC-013` first, because the runtime skill library is already a shipped
   contract and still lacks some hardening/publish discipline
2. `SPEC-015` second, because setup diagnostics are operator-facing and the
   bootstrap/setup workstream remains in progress
3. `SPEC-012` third, because the wakeup substrate is already usable and its
   remaining work is mostly follow-through rather than correctness recovery

## Goals

1. Give the unplanned-but-important follow-through under `SPEC-013`,
   `SPEC-015`, and `SPEC-012` one canonical implementation plan.
2. Land the next safe hardening slices without reshaping the public runtime
   contract gratuitously.
3. Prefer runtime-owned read-model truth, bounded safety, and clearer operator
   workflows over large new orchestration features.
4. Keep slices small enough to verify and commit independently.

## Non-Goals

- Replacing the existing dedicated plans for other specs
- Folding product-owned orchestration policy into `cats-runtime`
- Turning wakeups into a full job/workflow engine
- Turning the skill library into a product-owned profile system
- Collapsing setup diagnostics, compatibility evidence, and provider evolution
  into one artifact family

## Implementation Phases

### Phase 1: Skill Library Hardening and Publish Discipline

- [x] Add explicit recursive discovery guards for the runtime skill catalog
      (depth/cycle/path-shape hardening) so the library root can grow without
      assuming a perfectly well-formed tree forever
- [ ] Strengthen runtime-owned skill catalog diagnostics and verification only
      where they improve shipped-library truth
- [ ] Update skill-library docs and implementation tracking so the remaining
      work no longer hides only in roadmap bullets

**Deliverables**: runtime skill discovery is harder to break accidentally, and
`SPEC-013` follow-through has a canonical plan/verification anchor.

### Phase 2: Setup Diagnostic Operator Follow-Through

- [x] Reuse the shared setup repair-summary builder inside persisted setup
      diagnostic reports so report artifacts and `GET /setup-state` stop
      drifting on preferred-scan, next-action, and ordered follow-up actions
- [x] Prefer bounded operator summary/report improvements over broad setup UI
      rewrites
- [ ] Keep setup-report follow-through coordinated with, but not blocked on,
      larger bootstrap/UI work

**Deliverables**: setup diagnostics gain clearer operator follow-through
without inventing a second setup stack.

### Phase 3: Wakeup Follow-Through and Orchestration Readiness

- [ ] Land the next bounded wakeup hardening slice only where it improves
      runtime-owned scheduling truth, retry clarity, or diagnostics
- [ ] Keep later product workflow/orchestration policy explicitly out of scope
- [ ] Update wakeup docs/spec tracking so remaining work is separated from
      already-landed substrate behavior

**Deliverables**: wakeup follow-through becomes easier to reason about without
turning the runtime into a full scheduler/orchestrator.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `docs/plans/PLAN-024-runtime-skill-library-setup-and-wakeup-follow-through.md` | Create | Canonical follow-through plan for `SPEC-013` / `SPEC-015` / `SPEC-012` |
| `docs/specs/README.md` | Modify | Point the three specs at this follow-through plan |
| `docs/plans/README.md` | Modify | Index the new plan and explain its scope |
| `docs/specs/SPEC-013-internal-skill-library-and-role-taxonomy.md` | Modify | Replace "no dedicated plan" tracking with explicit PLAN-024 follow-through |
| `docs/specs/SPEC-015-runtime-setup-diagnostic-report.md` | Modify | Replace direct-only tracking with explicit PLAN-024 follow-through |
| `docs/specs/SPEC-012-scheduled-wakeup-substrate.md` | Modify | Replace direct-only tracking with explicit PLAN-024 follow-through |
| `src/core/skills/*` | Modify | First implementation slices for skill-library hardening |
| `src/core/diagnostics/*` | Modify | Later setup diagnostic follow-through slices |
| `src/core/wakeup/*` | Modify | Later wakeup follow-through slices |

## Technical Decisions

- Decision 1: Use one follow-through plan for these three specs because the
  missing problem is no longer "lack of first implementation" but "lack of one
  place to track the remaining runtime-owned work."
- Decision 2: Start with `SPEC-013` slices because skill-library hardening is
  both important and least entangled with broader bootstrap/UI work.
- Decision 3: Keep `SPEC-015` follow-through additive and operator-facing,
  rather than using this plan as cover for a wide bootstrap UI redesign.
- Decision 4: Keep `SPEC-012` follow-through focused on bounded substrate
  improvements, not product workflow ownership.

## Testing Strategy

- **Unit tests**: expand the relevant `src/core/skills`, `src/core/diagnostics`,
  and `src/core/wakeup` suites per slice
- **Route/integration tests**: update `src/http/*` / `tests/runtime-server.test.ts`
  only when a slice changes a host-facing read model
- **Verification gates**:
  - `npm run verify:skills` for skill-library changes
  - targeted `vitest` runs for each slice
  - `git diff --check`

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Plan grows into an unfocused catch-all backlog | Medium | Keep phases tied only to `SPEC-013`, `SPEC-015`, and `SPEC-012` |
| Setup follow-through accidentally expands into full bootstrap/UI redesign | High | Keep those slices additive and explicitly outside shared-UI rewrites |
| Wakeup follow-through drifts into product orchestration logic | Medium | Keep workflow policy out of scope and stay substrate-first |
| Skill-library changes silently affect shipped runtime packages | High | Use targeted catalog tests plus `npm run verify:skills` |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-29 | Plan created to consolidate important follow-through previously tracked only in `PROGRESS.md` / `ROADMAP.md` |
| 2026-03-29 | Phase 1 slice 1 landed: runtime skill catalog discovery now enforces bounded traversal depth and rejects symbolic-link/junction entries instead of assuming a perfectly well-formed checked-in tree |
| 2026-03-29 | Phase 2 slice 1 landed: persisted setup diagnostic reports now reuse the same shared repair-summary builder as `GET /setup-state`, so setup artifacts carry preferred-scan, next-action, and ordered follow-up actions instead of stopping at issue lists |
| 2026-03-29 | Phase 2 slice 2 landed: non-server setup-diagnostic stderr summaries now reuse the persisted report's repair summary and next-action guidance instead of stopping at the report headline alone |

---

*Created: 2026-03-29*
*Author: Codex*
