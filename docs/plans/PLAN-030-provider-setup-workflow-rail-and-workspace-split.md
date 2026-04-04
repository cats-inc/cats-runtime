# PLAN-030: Provider Setup Workflow Rail and Workspace Split

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Completed |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | User / runtime UI workstream |

## Related Spec

- [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [PLAN-019](./PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md)
- [ADR-027](../decisions/027-adopt-a-playground-derived-dark-runtime-ui-shell-with-sidebar-surface-switching.md)

## Related Context

- `cats-runtime/public/provider-setup.html`
- `cats-runtime/docs/api.md`
- `cats-runtime/docs/architecture.md`

## Overview

- This plan is a focused follow-through slice under `PLAN-019`, not a new
  runtime product branch.
- The current `provider-setup` page now shares the dark runtime shell, but its
  information architecture is still weak:
  - the sidebar spends space on static prose instead of live setup context
  - `Runtime Setup State` and `Configured Target Capabilities` are rendered as
    two equal cards even though they are different workspaces
  - scan/apply flow and configured-target inspection compete for the same page
    hierarchy instead of being modeled as separate operator tasks
- The approved direction is:
  - keep checkbox selection out of the sidebar
  - replace prose-heavy sidebar sections with a workflow rail
  - model setup as two workspaces, `Providers` and `Configured Targets`
  - keep `Auth` and `Runtime Health` as persistent footer context
- The goal is to make `Setup` a workflow-driven runtime surface without turning
  it into a linear wizard or a generic settings page.

## Scope

- In scope:
  - replacing `Bootstrap Mode` and `Operator Notes` sidebar prose with a
    workflow rail
  - defining two setup workspaces:
    - `Providers`
    - `Configured Targets`
  - consolidating readiness review and provider selection/apply into one
    `Providers` workspace
  - extracting configured-target inspection into a distinct workspace rather
    than a second equal-weight card on the same canvas
  - preserving the current setup route and public API contracts
  - updating runtime docs and HTML smoke coverage to reflect the new setup IA
- Out of scope:
  - changing `/setup-state`, `/setup-scan`, or `/setup-apply` response shapes
  - rewriting setup into a React/SPA flow
  - introducing a strict step-by-step wizard with irreversible sequencing
  - adding provider-specific config forms, diff views, or dependency planners
  - changing bootstrap policy, repair semantics, or configured-target data
    sources

## Current Problem Statement

- The sidebar currently uses prime navigation real estate for explanatory copy
  instead of live operator context.
- The page body currently implies that setup readiness and configured-target
  inspection are the same task by stacking them as two peer cards.
- In practice, the page is serving two different read models:
  - provider scan/readiness plus selection/apply intent
  - configured provider targets and their runtime-owned capability inspection
- The current layout therefore makes the setup surface feel both wordy and
  fragmented.

## Target Information Architecture

### Sidebar

- Keep the shared runtime surface switcher at the top.
- Replace prose sections with a compact workflow rail:
  - `Providers`
  - `Configured Targets`
- Each rail item should show state summary only, for example:
  - `Not scanned`
  - `3 ready, 2 blocked`
  - `2 selected`
  - `1 configured`
- Keep `Auth` and `Runtime Health` pinned in the sidebar footer.

### Workspace 1: Providers

- This is the default active workspace during bootstrap.
- It owns:
  - `Scan Providers`
  - provider readiness list
  - remediation details
  - provider checkbox selection
  - `Apply Selected`
  - selected/ready/blocked summary
- It intentionally merges readiness review and selection because both operate
  on the same scan snapshot and provider list.

### Workspace 2: Configured Targets

- This is a dedicated inspection workspace for runtime-effective configured
  targets.
- It owns:
  - configured provider selector
  - configured instance selector
  - capability summary
  - transport / continuity / tooling / observability details
- It should not own scan or selection behavior.

## Recommended Interaction Rules

- `Scan Providers` updates the `Providers` workspace and workflow summaries.
- `Apply Selected` reads from the checked provider list in `Providers`.
- Successful apply refreshes configured-target data and may switch focus to
  `Configured Targets`, but should not force a permanent step progression.
- `Configured Targets` should render a truthful empty state when nothing is yet
  configured, rather than competing with setup readiness content on first load.

## Implementation Phases

### Phase 1: Formalize Setup IA Contract

- [x] Replace page-local prose framing with the workflow-rail vocabulary.
- [x] Define the rail entry contract and the active-workspace state model.
- [x] Define the empty, loading, ready, and blocked state copy for both
  workspaces.
- [x] Confirm which current actions remain page-header level versus
  workspace-local actions.

Deliverables:

- One documented setup IA contract
- Stable vocabulary for `Providers` and `Configured Targets`
- Clear ownership boundaries for rail state versus workspace content

### Phase 2: Refactor Shell Layout Around the Workflow Rail

- [x] Remove `Bootstrap Mode` and `Operator Notes` from the setup sidebar.
- [x] Add a workflow rail with active-state styling and status summaries.
- [x] Keep `Auth` and `Runtime Health` in the persistent footer.
- [x] Convert the page body to render one active workspace at a time instead of
  two peer setup cards.

Deliverables:

- Setup sidebar aligned with runtime shell conventions
- Active workspace switching without changing routes
- Setup shell hierarchy that matches the approved IA

### Phase 3: Consolidate Providers Workspace

- [x] Move scan/readiness UI and provider selection into one `Providers`
  workspace.
- [x] Reuse current scan/readiness rendering and selection logic where possible.
- [x] Add a sticky or anchored apply summary/action area inside the workspace.
- [x] Keep remediation details visible in context with each provider row.

Deliverables:

- One coherent provider scan/select/apply workspace
- No provider checkbox interaction inside the sidebar
- Clear operator action path from scan to apply

### Phase 4: Extract Configured Targets as a Distinct Workspace

- [x] Lift `Configured Target Capabilities` out of the stacked-card model.
- [x] Preserve configured provider/instance selectors and capability detail
  rendering.
- [x] Add a truthful empty state for zero configured targets.
- [x] Refresh this workspace after successful apply without coupling it to
  scan-only actions.

Deliverables:

- One dedicated configured-target inspection workspace
- Preserved configured-target route and fetch behavior
- Empty-state behavior that matches actual configured runtime state

### Phase 5: Regression Coverage and Documentation Follow-Through

- [x] Update emitted-HTML smoke tests and route tests that assert setup-page
  copy or structure.
- [x] Add focused UI smoke assertions for workflow rail labels and the absence
  of old sidebar prose.
- [x] Update runtime docs that describe the setup surface and operator flow.
- [x] Record implementation progress back into this plan once work lands.

Deliverables:

- Updated setup surface smoke coverage
- Synchronized docs for setup IA and operator flow
- Progress trail for future follow-through

## Files / Areas Likely to Change

- Runtime-served setup UI:
  - `cats-runtime/public/provider-setup.html`
- Runtime UI shell helpers and possible shared setup helpers:
  - `cats-runtime/src/http/ui/*`
  - `cats-runtime/src/http/dashboardScanPanel.ts`
- Setup route and read-model verification:
  - `cats-runtime/tests/runtime-server.test.ts`
  - `cats-runtime/tests/bootstrap.test.ts`
  - `cats-runtime/tests/package-contract.test.ts`
  - `cats-runtime/tests/dashboard-scan-panel.test.ts`
- Runtime docs:
  - `cats-runtime/docs/architecture.md`
  - `cats-runtime/docs/api.md`
  - `cats-runtime/docs/plans/README.md`
  - `cats-runtime/docs/README.md`

## Technical Decisions Captured by This Plan

- Treat the setup sidebar as workflow context, not as a selection form.
- Keep provider checkbox selection in the main workspace, not in the rail.
- Model setup as a repeatable workflow surface, not as a one-pass wizard.
- Merge readiness and selection into one `Providers` workspace because they
  share one scan snapshot and one operator list model.
- Keep configured-target inspection separate because it is a different
  runtime-owned read model.

## Testing Strategy

- HTML smoke coverage:
  - setup page renders `Providers` and `Configured Targets`
  - old sidebar prose labels are removed
- Route regression coverage:
  - `/setup-state`, `/setup-scan`, and `/setup-apply` contract remains intact
- Manual validation:
  - initial bootstrap load defaults to `Providers`
  - scan updates provider readiness in place
  - apply refreshes configured-target inspection
  - configured-target workspace renders a truthful empty state before apply
  - auth-required flows still block both workspaces correctly

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Rail/workspace split becomes cosmetic only, leaving page logic tangled | Medium | Refactor active workspace ownership and local state explicitly instead of only restyling markup |
| Providers workspace becomes overcrowded after merging readiness and selection | Medium | Use anchored summary/actions and preserve concise row structure rather than adding more global chrome |
| Existing HTML smoke tests become brittle during copy changes | Low | Update tests to assert the new IA labels and role boundaries rather than transient prose |
| Future provider-specific config complexity outgrows the merged `Providers` workspace | Medium | Keep this plan scoped to current selection behavior; split later only if config diff/forms become real features |

## Progress Log

| Date | Update |
|------|--------|
| 2026-04-04 | Plan created to formalize the approved setup workflow-rail and workspace split direction. |
| 2026-04-04 | Workflow rail, Providers / Configured Targets workspaces, setup smoke tests, and setup-flow doc updates landed. |

---

*Created: 2026-04-04*
*Author: Codex*
