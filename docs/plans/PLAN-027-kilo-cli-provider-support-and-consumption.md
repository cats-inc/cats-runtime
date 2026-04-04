# PLAN-027: Independent Kilo CLI Provider Support and Product Consumption

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User |

## Related Artifacts

- [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [SPEC-018](../specs/SPEC-018-advanced-provider-model-catalog-and-selection-schema.md)
- [SPEC-023](../specs/SPEC-023-verified-advanced-provider-catalogs-and-manual-refresh-discovery.md)
- [PLAN-019](./PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md)
- [PLAN-025](./PLAN-025-executable-packaging-and-publish-follow-through.md)
- [cats-platform PLAN-030](../../../cats-platform/docs/plans/PLAN-030-packaged-setup-wizard-and-provider-installation.md)
- [cats-platform SPEC-045](../../../cats-platform/docs/specs/SPEC-045-cross-layer-bootstrap-and-onboarding-diagnostics.md)

## Overview

This plan tracked the rollout of `kilo` as an independent CLI-backed provider
across `cats-runtime` and `cats-platform`.

That rollout is now landed. `kilo` is treated as its own provider family rather
than an OpenCode alias:

- `kilo` has its own provider id, config keys, native adapter, routes, and
  tests in `cats-runtime`
- `kilo` appears immediately after `opencode` in runtime/provider/product order
- `kilo` has runtime-owned install/check metadata, compatibility knowledge,
  event-capability truth, and model-catalog support
- `kilo` is surfaced through bootstrap/setup/diagnostics and through the
  packaged Windows node CLI pack in `cats-platform`

The implementation reused OpenCode selectively as an accelerator, but the
public/runtime contract stayed Kilo-specific.

## Extraction Truth

This plan intersects the submodule-derived extraction work in only one place:

- `environment-bootstrap` was a useful source for npm-package/install/check
  truth such as `@kilocode/cli`, `kilo --version`, and the npm-global tool-pack
  grouping
- `project-bootstrap` had no Kilo-specific artifacts to extract, so there was
  no Kilo-specific collaboration/workspace rewrite track to carry in
  `cats-runtime`

That means Kilo follow-through belongs under runtime-owned provider
install/compatibility/bootstrap surfaces, not under the repo-owned
`project-bootstrap` collaboration extraction work from [PLAN-023](./PLAN-023-a2a-layering-and-collaboration-artifact-alignment.md).

## Landed Scope

### `cats-runtime`

- provider registration and ordering now include `kilo` immediately after
  `opencode`
- `config/providers.yaml.example` and CLI config parsing now expose Kilo command
  plus server host/port/startup-timeout fields
- Kilo has its own native adapter area under `src/backends/cli/kilo/` and its
  own provider binding in `src/backends/cli/providers/kilo.ts`
- Kilo native session inspection/discovery/create/delete surfaces are exposed
  through dedicated runtime routes and shared session flows
- runtime-owned install/check metadata, compatibility knowledge, event
  capability truth, setup diagnostics visibility, and model-catalog support are
  all in-repo

### `cats-platform`

- packaged Windows node CLI pack includes `@kilocode/cli`
- packaged readiness/setup truth and packaging notes treat Kilo as part of the
  shipped local-provider baseline
- shared product provider catalog includes Kilo in the same order as
  `cats-runtime`

## Phase Closeout

### Phase 1: Capture Kilo CLI Evidence and Freeze the First Slice

- [x] Verified that Kilo should ship as an independent provider rather than an
      OpenCode alias
- [x] Chose the full runtime slice instead of a catalog-only fallback:
  - dedicated config keys
  - dedicated native session service
  - dedicated route/service names
  - runtime-owned setup/install/compatibility truth

### Phase 2: Add Kilo to Runtime Provider Registration and Config

- [x] `KNOWN_PROVIDERS` includes `kilo`
- [x] runtime provider ordering places `kilo` immediately after `opencode`
- [x] `src/backends/cli/config.ts` exposes Kilo command/runtime fields
- [x] `config/providers.yaml.example` includes Kilo routing and CLI config
- [x] config/order coverage exists in the runtime test suite

Implementation evidence:

- [config/providers.yaml.example](../../config/providers.yaml.example)
- [src/backends/cli/providers/types.ts](../../src/backends/cli/providers/types.ts)
- [src/backends/cli/config.ts](../../src/backends/cli/config.ts)
- [src/core/providerCatalog.ts](../../src/core/providerCatalog.ts)
- [src/core/providerCatalog.test.ts](../../src/core/providerCatalog.test.ts)

### Phase 3: Land the Runtime Adapter Slice

- [x] dedicated Kilo adapter code lives under `src/backends/cli/kilo/`
- [x] `src/backends/cli/providers/kilo.ts` exists
- [x] WorkerPool/session routing resolves Kilo independently
- [x] Kilo native session service and dedicated routes are live
- [x] MCP/runtime provider surfaces treat Kilo as its own provider family

Implementation evidence:

- [src/backends/cli/kilo/KiloNativeSessionService.ts](../../src/backends/cli/kilo/KiloNativeSessionService.ts)
- [src/backends/cli/providers/kilo.ts](../../src/backends/cli/providers/kilo.ts)
- [src/http/routes/kilo.ts](../../src/http/routes/kilo.ts)
- [src/http/kiloManagement.test.ts](../../src/http/kiloManagement.test.ts)

### Phase 4: Add Kilo Catalog, Compatibility, Setup, and Diagnostics Truth

- [x] runtime install metadata uses `@kilocode/cli`
- [x] runtime compatibility knowledge includes Kilo-native profiles
- [x] Kilo event-capability truth is modeled explicitly
- [x] model catalog includes Kilo fallback entries plus discovery support
- [x] bootstrap/setup/provider diagnostics consume Kilo through the normal
      runtime-owned provider catalog flow

Implementation evidence:

- [src/core/provider-install/knowledge.ts](../../src/core/provider-install/knowledge.ts)
- [src/core/compatibility/knowledge.ts](../../src/core/compatibility/knowledge.ts)
- [src/core/providerEventCapabilities.ts](../../src/core/providerEventCapabilities.ts)
- [src/core/models/providerModelCatalog.ts](../../src/core/models/providerModelCatalog.ts)
- [src/http/providerDiagnostics.test.ts](../../src/http/providerDiagnostics.test.ts)

### Phase 5: Update Runtime Dashboard, Playground, and Setup Ordering

- [x] shared runtime ordering includes Kilo immediately after OpenCode
- [x] bootstrap guard/runtime UI shell recognize Kilo routes and badge treatment
- [x] no separate hardcoded Kilo-only product fallback path is required

Implementation evidence:

- [src/http/routes/bootstrapGuard.ts](../../src/http/routes/bootstrapGuard.ts)
- [src/http/ui/shared.ts](../../src/http/ui/shared.ts)
- [src/http/app.ts](../../src/http/app.ts)

### Phase 6: Update Packaged Windows Setup and Electron Onboard Paths

- [x] packaged Windows node CLI pack includes `@kilocode/cli`
- [x] packaged readiness/installer smoke tests cover Kilo
- [x] packaged setup and packaging notes treat Kilo as part of the shipped
      local-provider rollout

Implementation evidence:

- [cats-platform Install-NodeCliPack.ps1](../../../cats-platform/scripts/windows/Install-NodeCliPack.ps1)
- [cats-platform packaging.ts](../../../cats-platform/electron/packaging.ts)
- [cats-platform desktop-node-cli-pack.test.js](../../../cats-platform/tests/desktop-node-cli-pack.test.js)
- [cats-platform desktop-setup-readiness.test.js](../../../cats-platform/tests/desktop-setup-readiness.test.js)

### Phase 7: Make `cats-platform` Consume Kilo Cleanly

- [x] shared product provider catalog includes Kilo immediately after OpenCode
- [x] product fallback models exist for Kilo
- [x] product/provider setup surfaces can render Kilo through shared catalog
      helpers

Implementation evidence:

- [cats-platform providerCatalog.ts](../../../cats-platform/src/shared/providerCatalog.ts)

### Phase 8: Verification and Follow-Through

- [x] runtime tests cover Kilo config/order/native-session/diagnostic behavior
- [x] product tests cover shared provider catalog and packaged node CLI pack
- [x] docs now reflect shipped Kilo truth instead of the original draft plan

Representative coverage:

- [src/backends/cli/providers/kilo.test.ts](../../src/backends/cli/providers/kilo.test.ts)
- [src/backends/cli/kilo/models.test.ts](../../src/backends/cli/kilo/models.test.ts)
- [src/http/kiloManagement.test.ts](../../src/http/kiloManagement.test.ts)
- [src/http/providerDiagnostics.test.ts](../../src/http/providerDiagnostics.test.ts)
- [cats-platform desktop-packaging.test.js](../../../cats-platform/tests/desktop-packaging.test.js)

## Remaining Boundaries

This plan is complete for the current Kilo rollout. Future work should not
reopen a dedicated Kilo launch plan unless Kilo-specific CLI drift creates a
new unique contract problem.

Normal follow-through now belongs to the generic tracks that already own those
surfaces:

- bootstrap/setup shell and provider-first repair flow under
  [PLAN-019](./PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md)
- packaging/publish follow-through under
  [PLAN-025](./PLAN-025-executable-packaging-and-publish-follow-through.md)
- compatibility/install/remediation drift under
  [PLAN-029](./PLAN-029-provider-compatibility-and-evidence-engine.md)

## Risks / Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Future Kilo CLI drift diverges from the current native/session seam | Medium | Treat new drift under the generic compatibility/evidence track rather than re-collapsing Kilo into OpenCode. |
| Setup or packaged docs forget that Kilo is already shipped | Medium | Keep Kilo aligned through shared provider catalogs, packaged helper tests, and plan/status truth updates. |
| Later agents assume `project-bootstrap` needs a Kilo rewrite | Low | This plan now records that `project-bootstrap` had no Kilo source artifacts and is not the relevant extraction line. |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-31 | Plan created for adding `kilo` as an independent provider while using OpenCode as the first implementation reference where the CLI seam actually matches. |
| 2026-04-04 | Closed the plan against shipped repo reality: runtime config, native adapter/routes, setup/install/compatibility truth, packaged Windows node CLI rollout, and `cats-platform` provider consumption are all landed. |
| 2026-04-04 | Recorded the submodule-extraction truth explicitly: `environment-bootstrap` informed install/check metadata, while `project-bootstrap` had no Kilo-specific source artifacts to port. |

## Execution Checklist

- [x] Plan created
- [x] Phase 1 complete: Kilo seam comparison captured
- [x] Phase 2 complete: runtime config and provider registration landed
- [x] Phase 3 complete: runtime adapter slice landed
- [x] Phase 4 complete: catalog/setup/diagnostics truth landed
- [x] Phase 5 complete: runtime UI ordering landed
- [x] Phase 6 complete: packaged setup/onboard support landed
- [x] Phase 7 complete: `cats-platform` consumption landed
- [x] Phase 8 complete: regression coverage and doc follow-through landed

---

*Created: 2026-03-31*
*Last updated: 2026-04-04*
*Author: Codex*
