# PLAN-019: Shared Runtime UI Foundation for Dashboard, Playground, and Provider Setup

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft (UI Follow-Through Not Started) |
| **Owner** | Codex |
| **Assigned To** | TBD |
| **Reviewer** | User / runtime setup workstream |

## Related Spec

- [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)

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
- The remaining gap is that the runtime-owned UI is still three mostly isolated static pages with duplicated CSS/JS, inconsistent visual language, and no shared bootstrap discovery read seam.
- The goal is to converge `dashboard`, `playground`, and `provider-setup` onto one lightweight runtime-owned UI foundation while preserving static HTML artifacts, existing route behavior, and the current non-SPA runtime model.
- The plan is still intentionally not started: runtime-owned bootstrap/setup read
  seams are already in place, so the remaining work here is primarily shared
  UI/build-layer follow-through rather than missing runtime core substrate.

## Scope

- In scope:
  - shared design tokens and CSS theme variables for the three runtime-owned surfaces
  - shared runtime fetch and error-handling helpers for same-origin runtime APIs
  - shared provider badge and provider status rendering helpers
  - a shared bootstrap discovery read seam that both dashboard and provider-setup can consume
  - a lightweight build substrate that still emits static HTML artifacts
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

- `public/index.html` and `public/provider-setup.html` each define their own theme tokens and component styling inline.
- `public/playground.html` uses a separate Tailwind CDN-driven styling path and a different visual language from the dashboard and provider-setup page.
- Provider badge and provider color logic are duplicated between dashboard and playground, while provider-setup uses a third status-badge style with different semantics.
- Runtime fetch/auth/error handling is duplicated:
  - dashboard uses `headers()` plus direct `fetch`
  - playground uses `RuntimeClient` plus separate ad-hoc fetches for provider catalog and models
  - provider-setup uses raw `fetch` calls with page-local error handling
- There is no shared lightweight build substrate today; `src/http/app.ts` serves handwritten static HTML files directly from `public/`.
- `BootstrapService` already persists both `provider-scan.json` and `provider-manual-scan.json`, but the UI layer does not expose one shared runtime-owned read model over those snapshots.
- `GET /setup-state` returns only a summary of the latest scan, so `public/provider-setup.html` currently re-triggers `POST /setup-scan` on load to obtain full scan data instead of reusing persisted scan snapshots.
- Dashboard currently lacks the secondary manual scan and repair entry called out by `SPEC-017`.
- There is no runtime-owned repair affordance after bootstrap other than editing config or re-entering setup manually.

## Recommended Direction

- Converge on one shared runtime UI foundation with four reusable layers:
  - shared theme tokens and base CSS primitives
  - shared runtime API and fetch helpers
  - shared provider badge and provider-status rendering helpers
  - shared bootstrap discovery read-model helper
- Keep page ownership local:
  - dashboard keeps its session-centric layout and behavior
  - playground keeps its same-origin direct API orchestration model
  - provider-setup keeps bootstrap-first selection and apply flow
- Introduce a lightweight build step. Recommended first choice: `esbuild`.
  - bundle page-owned entry modules plus shared helpers
  - emit static HTML artifacts for `public/index.html`, `public/playground.html`, and `public/provider-setup.html`
  - prefer self-contained emitted HTML in the first slice so the runtime can keep serving static artifacts without needing a broad new static asset router
  - allow a narrowly scoped emitted asset directory only if bundle size or maintainability makes inline output too costly
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

- [ ] Define the shared CSS/theme token contract for dashboard, playground, and provider-setup.
- [ ] Define the shared runtime fetch/error helper contract for same-origin runtime APIs and optional bearer token use.
- [ ] Define the shared provider badge and provider-status rendering helpers.
- [ ] Define the shared bootstrap scan snapshot read model, centered on `GET /setup-state`.
- [ ] Define the runtime-owned UI source layout separately from emitted `public/*.html` artifacts.
- [ ] Keep bootstrap logic in runtime-owned services and thin HTTP/UI adapters only.

Deliverables:

- A shared CSS/theme contract for runtime-owned pages
- A shared JS helper contract for runtime API access and error normalization
- A shared provider badge/provider-status rendering contract
- A canonical setup read-model contract centered on `GET /setup-state`
- Clear page-entry ownership boundaries for dashboard, playground, and provider-setup

### Phase 2: Lightweight Static Build Substrate

- [ ] Add a lightweight build pipeline, preferably `esbuild`, for runtime UI sources.
- [ ] Bundle page-specific entry modules against the shared UI foundation without introducing a framework runtime or client router.
- [ ] Emit static HTML artifacts that remain directly serveable by the runtime and packagable in npm/Electron flows.
- [ ] Wire the packaging/build lifecycle so runtime UI artifacts are generated before release packaging.

Deliverables:

- Build strategy for static runtime pages
- Generated `public/index.html`
- Generated `public/playground.html`
- Generated `public/provider-setup.html`
- A decision on inline bundled HTML versus a narrowly scoped emitted asset folder
- Planned script/package touchpoints such as `package.json` build hooks

### Phase 3: Migrate Provider Setup onto the Shared Foundation

- [ ] Migrate provider-setup first as the thinnest UI adapter over bootstrap services.
- [ ] Replace page-local fetch logic with shared runtime fetch helpers.
- [ ] Replace page-local badge/status rendering with shared provider-status helpers.
- [ ] Stop forcing an auto-scan just to render existing scan results.
- [ ] Render persisted auto-scan and manual-scan snapshots from the shared setup read model.
- [ ] Keep bootstrap-mode availability and `POST /setup-apply` behavior unchanged.

Deliverables:

- Provider-setup page using the shared CSS/theme layer
- Provider-setup page using the shared runtime fetch/helper layer
- Provider-setup status badges rendered through shared provider-status helpers
- Shared bootstrap read model visible in the provider-setup page
- Static provider-setup HTML artifact emitted from the shared build

### Phase 4: Migrate Dashboard and Add Manual Scan / Repair Entry

- [ ] Move dashboard theme usage onto the shared token layer without rewriting the session UI into components.
- [ ] Add a secondary manual scan and repair entry in the dashboard.
- [ ] Use the shared setup read model so the dashboard can show latest scan state, latest manual scan state, and next repair action without owning bootstrap logic.
- [ ] Implement the first slice as a direct manual scan trigger plus inline result rendering.
- [ ] Keep `/dashboard` always available in both bootstrap and non-bootstrap modes.

Deliverables:

- Dashboard usage of the shared CSS/theme layer
- Dashboard usage of shared provider badge/status helpers where applicable
- Dashboard manual scan entry that calls `POST /setup-scan` with `manual: true`
- Dashboard repair snapshot panel based on the shared setup read model
- A clear dashboard CTA for repair follow-through without requiring manual YAML edits

### Phase 5: Migrate Playground onto the Same Foundation

- [ ] Preserve playground behavior as a same-origin direct runtime API surface.
- [ ] Keep the existing `RuntimeClient` and orchestration logic mostly intact; extract only the shared pieces that reduce duplication safely.
- [ ] Replace duplicated provider badge styling and ad-hoc runtime fetch/auth seams with shared helpers where that does not destabilize streaming behavior.
- [ ] Align playground visual tokens with the shared runtime UI foundation without collapsing it into the dashboard layout.

Deliverables:

- Playground usage of the shared CSS/theme layer
- Playground usage of shared provider badge helpers
- Shared runtime fetch/auth helper adoption for provider catalog and related same-origin reads where appropriate
- Playground static HTML artifact emitted from the shared build
- Preserved same-origin direct API behavior for sessions, messages, and model lookup

### Phase 6: Regression Tests and Docs Follow-Through

- [ ] Add focused regression coverage for route behavior, setup flows, dashboard repair behavior, and shared helpers.
- [ ] Add emitted HTML smoke checks so the runtime does not accidentally stop shipping static artifacts.
- [ ] Update runtime docs affected by the implementation once the code change lands.

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
  - `GET /setup-state`
  - `POST /setup-scan`
  - `POST /setup-apply`
- Root behavior must remain mode-sensitive:
  - bootstrap mode serves provider-setup at `/`
  - non-bootstrap mode serves dashboard at `/`
- `/dashboard` must remain always accessible regardless of bootstrap mode.
- `playground` must keep its same-origin direct API behavior and optional bearer-token flow.
- Provider-setup must remain usable during bootstrap mode and must not depend on a product host or a heavy frontend runtime.
- Static-served runtime artifacts must remain shippable in `public/`.
- Existing API contracts must not be broken by the UI refactor; any added read-model fields should be additive.

## Testing Strategy

- Bootstrap mode route behavior:
  - verify `GET /` still switches between provider-setup and dashboard correctly
  - verify `GET /dashboard` remains accessible in bootstrap mode
  - verify `GET /playground` remains accessible and unchanged in bootstrap mode
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
  - if the build stops using Tailwind CDN on playground, add smoke coverage that the generated output still renders required classes or extracted CSS hooks

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

## Execution Checklist

- [x] Plan created
- [ ] Phase 1 complete: shared UI foundation contract agreed
- [ ] Phase 2 complete: lightweight static build substrate in place
- [ ] Phase 3 complete: provider-setup migrated to shared foundation
- [ ] Phase 4 complete: dashboard migrated and manual scan/repair entry added
- [ ] Phase 5 complete: playground migrated onto shared foundation
- [ ] Phase 6 complete: regression tests and doc follow-through landed

## Notes for Implementation Team

- Treat this plan as a runtime-owned refactor and convergence task, not a product onboarding initiative.
- Keep the implementation additive and route-stable.
- Do not introduce a generic settings page while executing this plan.

---

- Created: 2026-03-25
- Author: Codex
