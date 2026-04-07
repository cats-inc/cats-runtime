# PLAN-019: Shared Runtime UI Foundation for Dashboard, Playground, and Provider Setup

## Metadata

| Field | Value |
|-------|-------|
| **Status** | In Progress (Shared Shell, HTML Emit, and Manual Repair Landed) |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / runtime setup workstream |

## Related Spec

- [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [ADR-027](../decisions/027-adopt-a-playground-derived-dark-runtime-ui-shell-with-sidebar-surface-switching.md)

## Related Context

- `cats-runtime/docs/architecture.md`
- `cats-runtime/docs/api.md`

## Overview

- This plan closes a follow-through gap already defined by `SPEC-017`, not a new feature branch-out.
- `cats-runtime` already has the first bootstrap slice in place:
  - bootstrap mode exists
  - `GET /` switches between dashboard and provider setup
  - `GET /dashboard` and `GET /playground` already exist
  - provider setup APIs already exist
- Since the plan was written, additive runtime-owned UI slices have already
  landed out of order:
  - `injectSharedUI()` now injects shared CatsUI helpers, shared provider badge
    / status helpers, and generated Tailwind-based runtime tokens into all
    runtime-served pages
  - `injectRuntimeShellState()` now injects the shared sidebar surface switcher
    and bootstrap locked-state contract across `Dashboard`, `Playground`, and
    `Setup`
  - `GET /setup-state` is now the shared repair/read seam used by
    `provider-setup` and the dashboard repair panel
  - the dashboard now has an inline manual scan and repair panel instead of
    relying on YAML edits or bootstrap-only setup access
  - `build:ui` now generates the shared runtime Tailwind payload before normal
    builds and package creation
- The user-approved direction is now explicit:
  - keep the runtime UI dark
  - treat the current playground surface as the canonical shell/layout baseline
  - adopt a shared sidebar brand-row surface switcher for `Dashboard`,
    `Playground`, and `Setup`
  - keep bootstrap gating by locking surfaces rather than replacing the shell
- The goal is to converge `dashboard`, `playground`, and `provider-setup` onto
  one lightweight runtime-owned UI foundation while preserving static HTML
  artifacts, existing route behavior, and the current non-SPA runtime model.
- The plan is therefore now in progress: most of the shared shell/manual repair
  contract is in repo, and the runtime-owned page source tree plus emitted
  `public/*.html` build path are now landed, but the deeper page-entry
  modularization work remains unfinished.

## Scope

- In scope:
  - a shared dark runtime shell derived from the current playground visual
    architecture
  - shared design tokens and CSS theme variables for the three runtime-owned surfaces
  - shared runtime fetch and error-handling helpers for same-origin runtime APIs
  - shared provider badge and provider status rendering helpers
  - a shared bootstrap discovery read seam that both dashboard and provider-setup can consume
  - a lightweight Tailwind-based build substrate that still emits static HTML
    artifacts
  - a sidebar brand-row surface switcher for `Dashboard`, `Playground`, and
    `Setup`
  - explicit bootstrap locked-state behavior for `Dashboard` and `Playground`
  - dashboard secondary manual scan and repair entry required by `SPEC-017`
  - additive refactor only; existing runtime routes and bootstrap behavior stay intact
- Out of scope:
  - React migration
  - full SPA rewrite
  - runtime UI expansion into product onboarding
  - `cats` product setup, owner identity, Boss Cat, or suite onboarding
  - provider install orchestration beyond the existing runtime setup surface
  - changing `SPEC-017`, ADRs, or inventing a generic settings surface
  - not adding a generic settings page; the third surface in this plan is `provider-setup`

## Current Gaps

- Shared shell/navigation, setup-state reuse, and dashboard manual repair now
  exist, and `src/http/ui/pages/*.html` now acts as the canonical source tree
  for emitted `public/*.html` artifacts, but the three pages still keep
  substantial page-local markup and scripting instead of narrower shared entry
  modules.
- `src/http/ui/pages/provider-setup.html` still carries significant page-local
  behavior
  even though it now sits inside the shared runtime shell and consumes the
  shared setup read model.
- `src/http/ui/pages/index.html` and
  `src/http/ui/pages/playground.html` both reuse shared CatsUI
  helpers, but they still retain duplicated page-local orchestration code that
  has not yet been pulled into narrower shared modules.
- `build:ui` now gives the repo one shared Tailwind build path and emits the
  final `public/*.html` artifacts from a runtime-owned source tree, but it does
  not yet bundle page-owned entry modules.
- Playground's current visual direction is the strongest baseline, but it is
  implemented as an isolated page rather than the canonical runtime shell.
- `BootstrapService` already persists both `provider-scan.json` and
  `provider-manual-scan.json`, and the UI layer now exposes a shared read seam
  through `GET /setup-state`; the remaining gap is consolidating more of the
  page-local rendering logic around that seam.
- The shared read seam still has room to tighten how dashboard and
  provider-setup reuse the same render helpers instead of maintaining two
  parallel page-local renderers.

## Recommended Direction

- Converge on one shared runtime UI foundation with the current playground
  surface as the canonical shell baseline.
- Use one shared sidebar-led shell across the three runtime-owned surfaces:
  - brand row with runtime surface switcher
  - consistent sidebar width/chrome
  - consistent page header/action row structure
  - consistent modal/form/button hierarchy
- Converge on four reusable layers:
  - shared Tailwind-backed theme tokens and shell primitives
  - shared runtime API and fetch helpers
  - shared provider badge and provider-status rendering helpers
  - shared bootstrap discovery read-model helper
- Keep page ownership local:
  - dashboard keeps its session-centric layout and behavior
  - playground keeps its same-origin direct API orchestration model
  - provider-setup keeps bootstrap-first selection and apply flow
- Introduce a lightweight build step that includes build-time Tailwind support.
  Recommended first choice: `esbuild` plus Tailwind CLI or equivalent
  post-processing.
  - bundle page-owned entry modules plus shared helpers
  - emit static HTML artifacts for `public/index.html`, `public/playground.html`, and `public/provider-setup.html`
  - prefer self-contained emitted HTML in the first slice so the runtime can keep serving static artifacts without needing a broad new static asset router
  - allow a narrowly scoped emitted asset directory only if bundle size or maintainability makes inline output too costly
- Reuse the `cats` suite switcher interaction model only as navigation
  inspiration:
  - use the sidebar brand-row switcher pattern
  - do not copy the `cats` suite palette
- Bootstrap shell direction:
  - keep the same surface switcher visible during bootstrap
  - mark `Dashboard` and `Playground` as locked/disabled until setup completes
  - keep `Setup` active during bootstrap
- Use the existing setup surface as the canonical read seam rather than inventing a second runtime bootstrap API.
  - recommended first slice: evolve `GET /setup-state` into the shared runtime-owned read model for setup state, latest auto-scan snapshot, latest manual-scan snapshot, and operator-facing action metadata
  - the provider-setup page and dashboard should consume the same shape
- Dashboard manual scan and repair first-slice recommendation:
  - add a dashboard repair card or secondary operator panel
  - trigger `POST /setup-scan` with `{"manual": true}` directly from the dashboard
  - render the resulting shared snapshot inline on the dashboard
  - do not rely on deep-linking alone for the first slice, because the current provider-setup surface is bootstrap-rooted and a deep-link by itself does not close the post-bootstrap `manual_only` repair gap
  - a richer always-available provider-setup page route can remain an additive follow-up decision if the inline dashboard repair surface proves insufficient

## Implementation Phases

### Phase 1: Shared UI Foundation Contract

- [x] Define the shared shell contract using playground as the canonical layout/visual baseline.
- [x] Define the shared Tailwind token/component contract for dashboard, playground, and provider-setup.
- [x] Define the shared runtime fetch/error helper contract for same-origin runtime APIs and optional bearer token use.
- [x] Define the shared provider badge and provider-status rendering helpers.
- [x] Define the shared bootstrap scan snapshot read model, centered on `GET /setup-state`.
- [x] Define the runtime-owned UI source layout separately from emitted `public/*.html` artifacts.
- [x] Define the sidebar brand-row surface switcher contract, including bootstrap locked-state behavior.
- [x] Keep bootstrap logic in runtime-owned services and thin HTTP/UI adapters only.

Deliverables:

- A shared CSS/theme contract for runtime-owned pages
- A shared JS helper contract for runtime API access and error normalization
- A shared provider badge/provider-status rendering contract
- A canonical setup read-model contract centered on `GET /setup-state`
- A locked-state navigation contract for bootstrap vs non-bootstrap
- Clear page-entry ownership boundaries for dashboard, playground, and provider-setup

### Phase 2: Lightweight Static Build Substrate

- [x] Add a lightweight build pipeline, preferably `esbuild`, for runtime UI sources.
- [x] Add build-time Tailwind support for the shared runtime shell and page entries.
- [ ] Bundle page-specific entry modules against the shared UI foundation without introducing a framework runtime or client router.
- [x] Emit static HTML artifacts that remain directly serveable by the runtime and packagable in npm/Electron flows.
- [x] Wire the packaging/build lifecycle so runtime UI artifacts are generated before release packaging.

Deliverables:

- Build strategy for static runtime pages
- Generated `public/index.html`
- Generated `public/playground.html`
- Generated `public/provider-setup.html`
- A decision on inline bundled HTML versus a narrowly scoped emitted asset folder
- A shared runtime Tailwind build path instead of page-local CSS / Tailwind CDN divergence
- Planned script/package touchpoints such as `package.json` build hooks

### Phase 3: Migrate Provider Setup onto the Shared Foundation

- [x] Migrate provider-setup first as the thinnest UI adapter over bootstrap services.
- [x] Move provider-setup into the shared sidebar shell instead of a standalone centered page.
- [x] Replace page-local fetch logic with shared runtime fetch helpers.
- [x] Replace page-local badge/status rendering with shared provider-status helpers.
- [x] Stop forcing an auto-scan just to render existing scan results.
- [x] Render persisted auto-scan and manual-scan snapshots from the shared setup read model.
- [x] Keep bootstrap-mode availability and `POST /setup-apply` behavior unchanged.
- [x] Render bootstrap locked-state navigation for dashboard/playground from the shared switcher.

Deliverables:

- Provider-setup page using the shared CSS/theme layer
- Provider-setup page using the shared runtime fetch/helper layer
- Provider-setup status badges rendered through shared provider-status helpers
- Shared bootstrap read model visible in the provider-setup page
- Static provider-setup HTML artifact emitted from the shared build

### Phase 4: Migrate Dashboard and Add Manual Scan / Repair Entry

- [x] Move dashboard onto the shared shell primitives without rewriting the session UI into components.
- [x] Add a secondary manual scan and repair entry in the dashboard.
- [x] Use the shared setup read model so the dashboard can show latest scan state, latest manual scan state, and next repair action without owning bootstrap logic.
- [x] Implement the first slice as a direct manual scan trigger plus inline result rendering.
- [x] Keep `/dashboard` always available in both bootstrap and non-bootstrap modes.

Deliverables:

- Dashboard usage of the shared CSS/theme layer
- Dashboard usage of shared provider badge/status helpers where applicable
- Dashboard manual scan entry that calls `POST /setup-scan` with `manual: true`
- Dashboard repair snapshot panel based on the shared setup read model
- A clear dashboard CTA for repair follow-through without requiring manual YAML edits

### Phase 5: Migrate Playground onto the Same Foundation

- [x] Preserve playground behavior as a same-origin direct runtime API surface.
- [x] Keep the existing `RuntimeClient` and orchestration logic mostly intact; extract only the shared pieces that reduce duplication safely.
- [x] Replace the current Tailwind CDN dependency with the shared build-time Tailwind path.
- [x] Replace duplicated provider badge styling and ad-hoc runtime fetch/auth seams with shared helpers where that does not destabilize streaming behavior.
- [x] Preserve playground as the canonical shell reference while moving its implementation onto the shared runtime UI foundation.

Deliverables:

- Playground usage of the shared CSS/theme layer
- Playground usage of shared provider badge helpers
- Shared runtime fetch/auth helper adoption for provider catalog and related same-origin reads where appropriate
- Playground static HTML artifact emitted from the shared build
- Preserved same-origin direct API behavior for sessions, messages, and model lookup

### Phase 6: Regression Tests and Docs Follow-Through

- [x] Add focused regression coverage for route behavior, setup flows, dashboard repair behavior, and shared helpers.
- [x] Add emitted HTML smoke checks so the runtime does not accidentally stop shipping static artifacts.
- [x] Update runtime docs affected by the implementation once the code change lands.

Deliverables:

- Route and bootstrap regression tests
- Shared helper unit tests
- DOM or emitted-HTML smoke checks for the three runtime-owned surfaces
- Follow-through doc updates for `docs/api.md`, `docs/architecture.md`, and related runtime docs if implementation changes those contracts

## Files / Areas Likely to Change Later

- Runtime-served artifacts and page shells:
  - `cats-runtime/public/index.html`
  - `cats-runtime/public/playground.html`
  - `cats-runtime/public/provider-setup.html`
- Canonical runtime UI page sources:
  - `cats-runtime/src/http/ui/pages/index.html`
  - `cats-runtime/src/http/ui/pages/playground.html`
  - `cats-runtime/src/http/ui/pages/provider-setup.html`
- HTTP serving and route wiring:
  - `cats-runtime/src/http/app.ts`
  - `cats-runtime/src/http/routes/setup.ts`
- Bootstrap service and shared read seam:
  - `cats-runtime/src/core/bootstrap/BootstrapService.ts`
  - a likely new runtime UI read-model/helper area under `cats-runtime/src/http/` or `cats-runtime/src/core/bootstrap/`
- New runtime UI source/build areas:
  - a likely new shared UI source directory under `cats-runtime/src/http/`
  - a likely build script area such as `cats-runtime/scripts/`
  - `cats-runtime/package.json`
- Tests:
  - `cats-runtime/tests/bootstrap.test.ts`
  - `cats-runtime/tests/runtime-server.test.ts`
  - `cats-runtime/tests/dashboard-health-overlay.test.ts`
  - likely new shared-helper or emitted-HTML smoke tests
- Docs to update during implementation, not in this planning task:
  - `cats-runtime/docs/api.md`
  - `cats-runtime/docs/architecture.md`
  - `cats-runtime/docs/setup-guide.md`

## Compatibility Constraints

- Runtime upgrade must be additive first; existing operators should not lose access to current runtime surfaces while the UI foundation is being refactored.
- Route paths must remain stable for:
  - `GET /`
  - `GET /dashboard`
  - `GET /playground`
  - `GET /setup`
  - `GET /setup-state`
  - `POST /setup-scan`
  - `POST /setup-apply`
- Root behavior must remain mode-sensitive:
  - bootstrap mode serves provider-setup at `/`
  - non-bootstrap mode serves dashboard at `/`
- `/dashboard` must remain always accessible regardless of bootstrap mode.
- `playground` must keep its same-origin direct API behavior and optional bearer-token flow.
- Provider-setup must remain usable during bootstrap mode and must not depend on a product host or a heavy frontend runtime.
- Bootstrap mode must preserve the shared shell and surface switcher while
  locking `Dashboard` and `Playground`.
- Static-served runtime artifacts must remain shippable in `public/`.
- Existing API contracts must not be broken by the UI refactor; any added read-model fields should be additive.

## Testing Strategy

- Bootstrap mode route behavior:
  - verify `GET /` still switches between provider-setup and dashboard correctly
  - verify `GET /dashboard` remains accessible in bootstrap mode
  - verify `GET /playground` remains accessible and unchanged in bootstrap mode
  - verify the shared surface switcher shows `Dashboard` and `Playground` as
    locked during bootstrap
- Provider-setup flow coverage:
  - verify `GET /setup-state` exposes the shared snapshot fields needed for UI rendering
  - verify persisted auto-scan and manual-scan snapshots can be rendered without forcing a new scan
  - verify `POST /setup-scan` still supports explicit manual scans
  - verify `POST /setup-apply` still writes config and exits bootstrap mode only when reload succeeds
- Dashboard repair coverage:
  - verify the dashboard exposes a secondary manual scan and repair affordance
  - verify the dashboard manual scan action triggers the intended request path
  - verify the dashboard can render latest manual scan and repair state from the shared read model
- Shared helper regression coverage:
  - unit tests for auth-header injection and same-origin runtime fetch behavior
  - unit tests for shared JSON/error normalization helpers
  - unit tests for provider badge and provider-status rendering helpers
  - unit tests for setup read-model selection logic between latest scan and latest manual scan
- Visual and DOM smoke coverage:
  - confirm emitted HTML artifacts still include the expected shared entry markers
  - confirm dashboard, playground, and provider-setup still expose expected IDs and route-linked controls
  - confirm the shared surface switcher renders consistent navigation affordances
  - confirm build output no longer relies on Tailwind CDN while still exposing
    the required shell/layout hooks

## Risks / Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Shared UI foundation drifts into a full SPA rewrite | High | Keep page-owned entry modules, no client router, no framework runtime, and no shared global app state beyond thin helpers. |
| Playground behavior gets destabilized by an overly aggressive refactor | High | Migrate playground last, extract only low-risk shared seams first, and preserve `RuntimeClient` plus existing streaming flow. |
| Bootstrap-specific logic becomes scattered across page scripts and routes | High | Center the bootstrap read seam in runtime-owned services and keep pages as thin adapters. |
| Dashboard repair UX depends on a provider-setup route that is not stable outside bootstrap mode | Medium | Use a direct dashboard manual scan action and inline repair snapshot for the first slice, not deep-link-only behavior. |
| Shared runtime UI work leaks into `cats` product UI concerns | Medium | Keep the source under `cats-runtime`, use runtime terminology only, and exclude product onboarding concerns from scope. |
| A lightweight build step breaks static artifact packaging | High | Treat emitted `public/*.html` artifacts as a hard compatibility requirement and wire generation into the release build path. |

## Decision Gates / Open Questions

- `esbuild` adoption:
  - Recommendation: yes.
  - Gate: confirm that `esbuild` plus a small HTML emit step is sufficient before considering heavier tooling.
- Shared helper placement:
  - Recommendation: keep source modules near `src/http/` so the HTTP layer owns runtime UI delivery.
  - Gate: decide whether the setup read model belongs directly in `src/http/routes/setup.ts`, an HTTP-specific helper module, or a bootstrap read-model projection under `src/core/bootstrap/`.
- CSS strategy:
  - Recommendation: shared tokens and base primitives plus page-owned layers.
  - Gate: avoid both extremes of one monolithic stylesheet and three isolated page-local token copies.
- Dashboard manual scan UX first slice:
  - Recommendation: direct dashboard manual scan trigger plus inline shared repair snapshot.
  - Gate: decide later whether to also add an always-available provider-setup page route for richer repair workflows.
- Shared scan snapshot seam:
  - Recommendation: evolve `GET /setup-state` into the shared read model consumed by provider-setup and dashboard.
  - Gate: if that route becomes too broad, extract an internal read-model service first before inventing a second public endpoint.
- Static artifact emission strategy:
  - Recommendation: self-contained emitted HTML first.
  - Gate: only add a dedicated emitted asset directory if inline bundles materially hurt maintainability or payload size.

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-25 | Plan created for the `SPEC-017` runtime UI foundation follow-through gap. |
| 2026-04-04 | Status audit aligned the plan with repo reality: the shared shell, shared CatsUI helpers, build-time Tailwind path, provider-setup shared read seam, dashboard repair panel, playground helper adoption, and regression coverage are landed; the remaining open work is the deeper page-source and emitted-HTML convergence track from Phase 2. |
| 2026-04-07 | `build:ui` now emits `public/index.html`, `public/playground.html`, and `public/provider-setup.html` from canonical `src/http/ui/pages/*.html` sources, and regression coverage now fails if those generated artifacts drift after a build. |

## Execution Checklist

- [x] Plan created
- [x] Phase 1 complete: shared UI foundation contract agreed
- [ ] Phase 2 complete: lightweight static build substrate in place
- [x] Phase 3 complete: provider-setup migrated to shared foundation
- [x] Phase 4 complete: dashboard migrated and manual scan/repair entry added
- [x] Phase 5 complete: playground migrated onto shared foundation
- [x] Phase 6 complete: regression tests and doc follow-through landed

## Notes for Implementation Team

- Treat this plan as a runtime-owned refactor and convergence task, not a product onboarding initiative.
- Keep the implementation additive and route-stable.
- Do not introduce a generic settings page while executing this plan.

---

- Created: 2026-03-25
- Author: Codex
- Last updated: 2026-04-07
