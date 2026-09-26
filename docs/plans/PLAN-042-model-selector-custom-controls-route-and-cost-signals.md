# PLAN-042: Model Selector Custom Controls, Route Display and Cost Signals

## Metadata

| Field | Value |
|-------|-------|
| **Status** | On Hold — not approved; waiting for SPEC-032 approval |
| **Owner** | Runtime catalog workstream |
| **Assigned To** | Unassigned until approval |
| **Reviewer** | User |

This plan is not authorized for implementation. Nothing below should start until the
user approves [SPEC-032](../specs/SPEC-032-model-selector-custom-controls-route-and-cost-signals.md)
and resolves its open questions. The version bump and release are also separate, and
need their own authorization.

## Related Spec

[SPEC-032: Model Selector Custom Controls, Route Display and Cost Signals](../specs/SPEC-032-model-selector-custom-controls-route-and-cost-signals.md)

## Overview

- **Order:** the runtime data contract lands first, and both selectors then consume it.
- **Delivery:** each phase is a separate PR on the owning repository. Platform work
  follows its own `AGENTS.md` and PR rules.
- **Scope:** changes are additive except one. The custom-model path that forces empty
  controls is replaced in place, following the runtime's pre-release policy.

## Implementation Phases

### Phase 0: Approval Gate

- [ ] 0.1 The user approves SPEC-032, including the FR-5 per-CLI assignment.
- [ ] 0.2 Resolve the open questions: field names, custom value lists and the release
      boundary (Runtime 0.4.0, or additive within 0.3.x).
- [x] 0.2a The Pi channel is decided: controls via `pi.thinking` / `--thinking`
      (operator, 2026-09-26).
- [ ] 0.3 Update the SPEC-032 and PLAN-042 status and the indexes. Assign an owner.

**Deliverables**: an approved spec with resolved names and a recorded version boundary.

### Phase 1: Runtime Catalog Contract

- [ ] 1.1 Add the optional scope declaration: `mode`, hint, examples and controls.
      Add the route label data and the capability-tag vocabulary to
      `src/catalogs/types.ts`.
- [ ] 1.2 Validate them in `src/catalogs/schema.ts`:
      - reject `syntax` together with controls (FR-4);
      - reject unknown modes;
      - reuse `CatalogControl` validation.
- [ ] 1.3 Project `customModel` and each entry's `route` into the advanced catalog:
      `src/core/models/providerAdvancedCatalog.ts` and `providerAdvancedKnowledge.ts`.
- [ ] 1.4 Author the factory data in `config/curated-model-catalogs.yaml.example`:
      - FR-5 declarations;
      - route labels for Goose, Pi, Cline, OpenCode and Kilo;
      - cost and data-use tags on the Cursor fast rows, Grok `grok-4.7-build-fast` and
        the Muse `-contributor` rows.
      Then run `npm run catalog:generate`.
- [ ] 1.5 Update the catalog maintenance skill's field guidance, so later refreshes keep
      the declarations and tags.

**Deliverables**: the catalog schema, the generated catalog and the API projection, with
no behaviour change for existing selections.

### Phase 2: Runtime Session Acceptance

- [ ] 2.1 Replace the custom branch in `resolveRequestedSessionModelState`
      (`src/http/routes/sessions.ts:500-513`). A custom entry may carry controls when the
      scope declares `mode: controls`. Record the resolution as custom and add an
      "unverified combination" warning.
- [ ] 2.2 Add a validation helper next to `resolveProviderSelection` that checks
      declared keys, kinds and values. Unset controls stay absent (FR-2).
- [ ] 2.3 Confirm the fork and resume paths that reuse `legacyModel`
      (`sessions.ts:2803-2806`, `4511-4516`) carry custom controls consistently.
- [ ] 2.4 Adapters need no change for keys they already read. OpenCode joins
      `mode: controls` only after its `variant` wiring lands. That work is tracked from
      the research note, not here.

**Deliverables**: a custom model plus declared controls reaches the adapter as
`modelControls`. Undeclared input is rejected.

### Phase 3: Playground Selector

- [ ] 3.1 When Custom is chosen, render either the syntax hint and examples or the
      declared controls, with a "CLI default" empty option. Never render both.
- [ ] 3.2 Render the route line and the cost and data-use badges.
- [ ] 3.3 Hide `.agent-mode-group` when no preset applies (`syncAgentPresetField`).
- [ ] 3.4 Run `npm run build:ui` and commit the regenerated `public/*.html` and
      `src/http/ui/generated/runtimeTailwind.ts`.

**Deliverables**: Playground parity with SPEC-032 FR-2, FR-6, FR-7 and FR-8.

### Phase 4: Desktop Selector (cats-platform)

- [ ] 4.1 Extend `src/shared/providerCatalog.ts` to read `customModel` and entry
      `route`. Both are optional.
- [ ] 4.2 In `providerModelFieldsSupport.ts` and `ProviderModelFields.tsx`, give custom
      targets hint or controls, not the unconditional empty list at line 893.
      `ProviderModelFieldControls.tsx` needs a "CLI default" choice for custom controls.
- [ ] 4.3 Render the route line and the badges. Hide Mode when no preset applies. Add
      i18n keys for the new strings.
- [ ] 4.4 Persist custom controls through the existing selection plumbing: target state,
      drafts and cat records. The Phase 2 request shape must round-trip.
- [ ] 4.5 Check that the informational local catalog projection
      (`src/platform/runtime/localCatalogProjection.ts`) tolerates the new scope keys
      through the bundled Runtime module.

**Deliverables**: Desktop parity with Playground, delivered in a platform PR against the
matching Runtime version.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/catalogs/types.ts`, `src/catalogs/schema.ts` | Modify | Custom-model declaration, route labels, tag vocabulary, validation |
| `src/core/models/providerAdvancedCatalog.ts`, `providerAdvancedKnowledge.ts` | Modify | `customModel` and entry `route` projection |
| `src/core/models/providerSelectionResolution.ts` | Modify | Validation of custom-model controls |
| `src/http/routes/sessions.ts` | Modify | Replace the forced-empty custom path |
| `config/curated-model-catalogs.yaml.example`, `config/curated-model-catalogs.generated.json` | Modify | Factory declarations, route labels, tags |
| `skills/maintain-provider-model-catalogs/` | Modify | Guidance for the new fields |
| `src/http/ui/pages/playground.html`, `src/http/ui/shared.ts` and generated outputs | Modify | Playground selector |
| `docs/api.md` | Modify | Additive catalog and selection fields |
| cats-platform `src/shared/providerCatalog.ts` | Modify | Read the new optional fields |
| cats-platform `src/design/components/ProviderModelFields.tsx`, `providerModelFieldsSupport.ts`, `ProviderModelFieldControls.tsx` | Modify | Desktop selector |
| Tests in both repositories | Create/Modify | See Testing Strategy |

## Technical Decisions

These are proposed and pending approval with SPEC-032.

- **The route comes from catalog data only.** Core never parses provider model strings.
  OpenCode and Kilo prefixes are therefore authored as route data, rather than derived
  in core, which respects the adapter-quirk layering rule.
- **One channel per CLI (FR-4)** instead of merging a suffix with a control, because
  precedence differs per CLI.
- **Custom controls are data, not code.** Adding or removing one is a catalog edit,
  which follows SPEC-031's local-override model.

## Testing Strategy

- **Unit tests:**
  - Catalog schema: valid and invalid declarations, `syntax` plus controls rejected,
    unknown mode rejected.
  - Projection of `customModel` and `route`.
  - Selection validation: declared key accepted, undeclared key or value rejected,
    unset control absent.
- **Integration tests:**
  - Session create, resume and fork with a custom model plus controls. Assert adapter
    args for Claude (`--effort`), Codex (`model_reasoning_effort`), Cline
    (`--thinking`) and Pi (`--thinking`).
  - Pi precedence: `--thinking` set by a control wins over a `:level` suffix, and the
    suffix still applies when the control is left at "CLI default".
  - A `syntax`-mode scope rejects custom controls.
  - Existing catalog selections are unchanged.
- **UI tests:**
  - Playground: `shared.playground.test.ts` and the `runtime-ui-build` drift check.
  - Platform: `provider-model-fields*.test.tsx`, custom-target persistence, and hidden
    Mode when there are no presets.
- **Manual testing:** in Desktop and Playground, check a custom Claude model with effort
  high, a custom Cursor bracket string with its hint shown, a Goose row showing its
  route, and a Muse contributor row showing its badge.
- **Validation scope:** follow AGENTS.md Local Validation Scope for each PR.
  `release-preflight` stays the merge gate.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Older Runtimes reject catalogs using the new keys (strict schema) | Medium | Record the version boundary at Phase 0. Keep new keys optional. Document it in the release notes. |
| Custom controls imply support that a model lacks | Medium | Show an "unverified" warning. Keep "CLI default" as the empty choice. |
| Syntax and controls conflict on the same CLI | Medium | FR-4 validation rejects mixed declarations. |
| Desktop and Runtime version skew | Medium | Platform reads the new fields optionally, and the Phase 4 PR targets the matching Runtime. |
| Tag vocabulary drifts during catalog refreshes | Low | Update the maintenance skill in Phase 1. |

## Progress Log

| Date | Update |
|------|--------|
| 2026-09-26 | Plan drafted from the research note and the operator's UI review. On hold, not approved. |
| 2026-09-26 | The operator moved Pi from `syntax` to `controls` (SPEC-032 FR-5). The plan stays on hold. |

---

*Created: 2026-09-26*
*Author: Claude (agent)*
