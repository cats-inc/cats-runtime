# PLAN-026: Verified Advanced Provider Catalogs and Manual-Refresh Discovery

> Implementation plan for hardening provider advanced catalogs so `cats-runtime`
> stops publishing guessed advanced metadata and stops live-probing upstreams
> from routine dashboard reads.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Safety, Cache-First Reads, Entry-Scoped Controls, and Setup Refresh UX Landed) |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Spec

- [SPEC-023: Verified Advanced Provider Catalogs and Manual-Refresh Discovery](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)
- Supporting decisions:
  [ADR-029](../decisions/029-keep-advanced-provider-catalogs-verified-and-manual-refresh.md),
  [ADR-022](../decisions/022-model-advanced-selection-as-entries-presets-and-provider-specific-controls.md),
  [ADR-008](../decisions/008-runtime-owned-provider-model-catalog.md)

## Overview

This work is a hardening follow-up, not a greenfield provider-catalog feature.
The current runtime already ships:

- lightweight provider-model discovery
- additive advanced catalogs
- dashboard/setup/playground consumers
- dynamic discovery for API, CLI, local, and agent targets

The immediate goal is not to add more provider-specific advanced knobs. The
immediate goal is to stop lying and stop probing too eagerly:

- unverified advanced metadata must be removed from public catalogs
- ordinary reads must become cache-first and non-probing
- live discovery must move behind explicit refresh
- provider truth must be curated by runtime-owned manifests and tests

Current audit result:

- conservative public advanced catalogs for unverified targets are landed
- ordinary route reads are non-probing, with explicit refresh reserved for
  `refresh=1|true|refresh|force`
- entry-scoped control applicability/default handling is landed on curated
  verified targets and enforced in resolution/UI helpers
- restart-stable persisted snapshots and refresh backoff are now landed in the
  runtime catalog service
- a runtime-owned verified-manifest registry plus additive provenance metadata
  are now landed for the first curated targets
- broader manifest onboarding/checklist work remains open

## Implementation Phases

### Phase 1: Safety Slice and Contract Tightening

- [x] Add a runtime-owned advanced metadata registry/manifest seam separate from
      raw entry discovery.
- [x] Change advanced-catalog builders so unverified targets emit conservative
      entry-only catalogs with empty `presets`, empty `controls`, and
      `defaultSelection: null`.
- [x] Remove current heuristic-only public presets/controls/support claims from
      unverified providers, especially CLI targets.
- [x] Add regression coverage proving unverified providers no longer leak
      guessed presets or controls.

**Deliverables**: public advanced catalogs become conservative by default even
before refresh-policy changes land.

### Phase 2: Discovery Read/Refresh Split

- [x] Refactor provider catalog service so ordinary route reads are
      non-probing and use in-memory cache before falling back to config/static
      truth.
- [x] Extend that fallback ordering with persisted restart-stable snapshots
      between memory cache and config fallback.
- [x] Preserve explicit live refresh through `refresh=1` or equivalent setup
      and diagnostics actions.
- [x] Persist successful discovery snapshots with timestamps and source
      metadata.
- [x] Add cooldown/backoff state for rate limits, auth failures, timeouts, and
      repeated probe failures.
- [x] Expose additive freshness/warning metadata so callers know when cached or
      stale data is being served.

**Deliverables**: live vendor probes only happen on explicit refresh, not on
routine reads.

### Phase 3: UI Surface Ownership Cleanup

- [x] Update dashboard `Create New Session` and related session-management flows
      to consume cached/config/static catalogs only.
- [ ] Move explicit refresh affordances and capability-inspection UX to setup
      and diagnostics surfaces.
- [x] Ensure the dashboard can still create sessions from conservative
      entry-only catalogs without trying to infer missing advanced controls.
- [x] Show refresh freshness and stale/cooldown warnings on setup surfaces
      instead of hiding probe state.

**Deliverables**: session-management UI no longer triggers vendor probing and
setup becomes the honest inspection/refresh surface.

### Phase 4: Schema Expressiveness for Verified Providers

- [x] Extend advanced control schema to support per-entry allowed values and
      defaults.
- [x] Update selection resolution logic to enforce entry-specific control
      constraints.
- [x] Update UI helpers/renderers to read entry-scoped control constraints
      instead of assuming one global `values` list.
- [x] Add route and resolver tests for providers whose control values differ by
      entry.

**Deliverables**: verified providers can express cases like "model A supports
`max`, model B does not" without flattening truth.

### Phase 5: Verified Provider Onboarding

- [ ] Create an evidence-backed onboarding checklist for provider manifests.
- [x] Ship the first verified manifests for the highest-value targets.
- [x] Keep all remaining providers in conservative entry-only mode until their
      manifests and tests exist.
- [x] Link provider-specific verification evidence into repo memory so future
      updates are auditable.

**Deliverables**: a sustainable rollout model where the runtime team grows
verified advanced capability coverage without requiring user-by-user manual
audits.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/models/providerModelCatalog.ts` | Modify | Split cache-first ordinary reads from explicit refresh behavior |
| `src/core/models/providerAdvancedKnowledge.ts` | Modify | Remove heuristic public metadata for unverified targets and add verified-manifest integration |
| `src/core/models/providerAdvancedCatalog.ts` | Modify | Extend schema for provenance and entry-scoped control constraints |
| `src/core/models/providerSelectionResolution.ts` | Modify | Enforce entry-specific control applicability and defaults |
| `src/http/routes/providers.ts` | Modify | Preserve route shape while separating ordinary reads from explicit refresh |
| `public/index.html` | Modify | Stop routine dashboard flows from triggering live discovery and consume conservative catalogs |
| `public/provider-setup.html` | Modify | Own explicit refresh, freshness, cooldown, and capability inspection UI |
| `src/core/models/*.test.ts` | Modify/Create | Cover conservative fallback, verified manifests, and entry-specific constraints |
| `tests/runtime-server.test.ts` | Modify | Cover route semantics and dashboard/setup ownership changes |
| `docs/research/*` | Modify/Create as needed | Store provider verification evidence used to onboard manifests |

## Technical Decisions

- Decision 1: Safety wins over breadth. Unverified advanced metadata is removed
  even if that temporarily makes some providers look less "feature rich".
- Decision 2: Discovery refresh becomes explicit. Ordinary reads should be cheap
  and predictable, while setup/diagnostics own live probing and warning UX.
- Decision 3: Provider truth stays runtime-owned. Product UIs consume manifests
  and provenance instead of hardcoding provider differences.
- Decision 4: Schema must represent per-entry truth. A single provider-wide enum
  is not expressive enough for providers whose capabilities differ by model.

## Testing Strategy

- **Unit Tests**:
  verify conservative fallback, manifest loading, entry-scoped control
  constraints, resolver enforcement, cooldown state, and persisted snapshot
  behavior
- **Integration Tests**:
  verify route semantics for ordinary read vs explicit refresh, stale snapshot
  serving, and dashboard/setup ownership boundaries
- **Manual Testing**:
  open dashboard and setup surfaces with configured providers; confirm routine
  session-management reads do not trigger live probes; confirm setup manual
  refresh does

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Removing heuristic metadata makes some provider UIs look less capable at first | Medium | Communicate conservative-mode intent and prioritize verified manifests for the highest-value providers |
| Route-semantics change surprises existing callers expecting live discovery on ordinary reads | Medium | Keep explicit refresh additive, surface provenance clearly, and update docs/tests first |
| Persisted snapshot store becomes another opaque runtime state layer | Medium | Keep format small, timestamped, and covered by tests; document store ownership clearly |
| Provider manifests drift as providers evolve | High | Tie onboarding to evidence docs and regression tests; reuse provider-evolution follow-through from existing docs |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-30 | Plan created after runtime advanced-catalog truthfulness and discovery-trigger review |
| 2026-04-07 | Audit update: status corrected to `In Progress`. Landed slices now include conservative advanced catalogs for unverified targets, non-probing ordinary reads plus explicit `refresh=1`, stale in-memory cache reuse with `cache.stale`, and entry-scoped control applicability/default handling on curated verified targets. Persisted snapshots, cooldown/backoff, setup-owned refresh UX, and evidence-backed manifest onboarding remain open. |
| 2026-04-07 | Phase 2 follow-through landed: successful dynamic catalogs now persist restart-stable snapshots under the runtime data dir, ordinary reads can reuse those persisted snapshots before config/static fallback, and repeated refresh failures now activate catalog refresh backoff with additive cache metadata and warnings instead of hammering upstreams on every request. |
| 2026-04-07 | Phase 1 / 5 follow-through landed: verified advanced targets now resolve through a runtime-owned manifest registry with additive provenance metadata on public advanced catalogs, and the first curated manifests/evidence refs are now recorded in `docs/research/2026-04-07-advanced-provider-manifest-baseline.md`. |
| 2026-04-07 | Phase 3 setup-surface follow-through landed: `provider-setup` now exposes per-target model-catalog freshness on the runtime-target inspection view, including stale/persisted/backoff hints, metering-derived cooldown warnings, bounded catalog-warning surfacing, and an explicit per-target `refresh=1` button that updates runtime-owned catalog truth without moving that workflow back into the dashboard read path. |
| 2026-04-07 | Follow-on setup truthfulness slice landed: the same runtime-target inspection view now also reuses `GET /diagnostics/providers` for filtered provider availability truth (`ok` / `degraded` / `unavailable` plus attention codes), so setup/repair surfaces no longer rely on model-catalog metadata alone when deciding how healthy a target currently is. |

---

*Created: 2026-03-30*
*Author: Codex*
