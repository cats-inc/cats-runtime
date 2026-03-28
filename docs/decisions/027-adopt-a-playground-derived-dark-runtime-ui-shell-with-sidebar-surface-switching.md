# ADR-027: Adopt a Playground-Derived Dark Runtime UI Shell with Sidebar Surface Switching

> Use the current playground surface as the canonical visual shell for
> `cats-runtime`, while keeping dashboard, playground, and setup as distinct
> workflow pages inside one runtime-owned UI system.

## Status

Accepted

## Date

2026-03-29

## Context

`cats-runtime` now exposes three runtime-owned pages:

- dashboard
- playground
- provider setup

They already share runtime APIs and some injected helper code, but they do not
read as one coherent product shell:

- dashboard and provider-setup still use page-local handwritten CSS
- playground uses a separate Tailwind CDN path and a different layout language
- navigation between surfaces appears in different places and with different
  visual weight
- sidebar widths, header structure, button hierarchy, and modal treatment are
  inconsistent

The user direction for the next UI follow-through is now explicit:

- keep the overall runtime visual tone dark
- treat the current playground visual architecture as the strongest baseline
- do not copy the `cats` suite palette or brand styling directly
- make the three runtime pages feel like one assembled runtime shell rather
  than three unrelated operator screens

The runtime also has a bootstrap constraint that the suite host does not have:

- during bootstrap, setup is the only workflow the operator should be able to
  use
- after bootstrap, dashboard and playground should become available without the
  entire navigation model changing shape

That means the UI direction is no longer just a page-by-page styling cleanup.
It is a durable shell/navigation decision that will affect build tooling,
layout primitives, route affordances, and bootstrap behavior.

## Decision

`cats-runtime` will adopt one shared runtime UI shell with the following rules:

1. The current playground surface is the canonical visual/layout baseline for
   runtime-owned pages.
   - This means the shared shell should inherit the playground's dark visual
     posture, split-pane sensibility, and utility-first component rhythm.
   - It does **not** mean copying playground page content into dashboard or
     setup.
2. Dashboard, playground, and provider-setup remain three distinct workflow
   surfaces, but they should live inside one shared shell.
3. The runtime UI's target styling path is build-time Tailwind rather than a
   permanent mix of:
   - handwritten per-page CSS
   - injected token fragments only
   - Tailwind CDN on just one page
4. The runtime shell should expose one surface switcher in the sidebar brand
   row, analogous to the product/surface switcher pattern used by `cats`.
   - The runtime switcher options are `Dashboard`, `Playground`, and `Setup`.
   - This switcher is the canonical cross-surface navigation affordance.
5. Bootstrap mode should preserve the same switcher shape, but `Dashboard` and
   `Playground` must be shown as locked/disabled until setup completes.
   - The locked state should be explicit rather than silently hiding those
     surfaces.
6. The current route contract remains intact:
   - `/` stays mode-sensitive
   - `/dashboard`, `/playground`, and `/setup` stay stable
7. Shared shell elements should converge across the three pages, including:
   - sidebar width and chrome
   - top-level page header/action row treatment
   - button hierarchy
   - form controls
   - modal treatment
   - empty states
   - status/provider badges where appropriate
8. Each surface may keep workflow-specific layout inside the shared shell:
   - dashboard remains session-centric
   - playground remains multi-agent chat-centric
   - setup remains provider-first and repair-oriented

## Consequences

### Positive

- the runtime UI gets one clear navigation model instead of three unrelated
  page-level link patterns
- bootstrap and post-bootstrap navigation remain understandable without
  changing shell shape
- later UI follow-through can target one canonical shell rather than arguing
  page-by-page from scratch
- Tailwind becomes a shared implementation path instead of playground-only

### Negative

- the current provider-setup and dashboard pages will need real layout
  migration, not just token cleanup
- the build path becomes more opinionated because build-time Tailwind support
  must exist
- playground's current CDN-based Tailwind usage becomes transitional rather
  than acceptable long-term

### Neutral

- this ADR does not require React or a SPA rewrite
- this ADR does not require reusing the `cats` light palette or its exact
  product branding
- this ADR does not collapse the three runtime surfaces into one single page

## Alternatives Considered

### Alternative 1: Keep the current three-page visual split and only share a few tokens

- **Pros**: smallest immediate implementation effort
- **Cons**: preserves the current "assembled from different tools" feel and
  does not solve inconsistent shell/navigation
- **Why rejected**: the user requirement is specifically to make the runtime
  feel coherent, not merely less duplicated

### Alternative 2: Put the main surface switcher in a global top header

- **Pros**: familiar tab-like navigation model
- **Cons**: weaker alignment with the playground-led shell direction and
  duplicates page-level heading/navigation pressure in already dense operator
  screens
- **Why rejected**: the sidebar brand-row switcher better matches the desired
  shell hierarchy and keeps cross-surface navigation in one stable place

### Alternative 3: Copy the `cats` suite shell directly, including palette and product styling

- **Pros**: fastest conceptual reuse
- **Cons**: `cats-runtime` is a runtime/operator surface, not the suite product,
  and the user explicitly does not want the `cats` palette copied
- **Why rejected**: only the switching interaction model is being reused, not
  the suite's visual identity

### Alternative 4: Rewrite the runtime UI as a full SPA first

- **Pros**: strongest shared-client architecture
- **Cons**: too large a diversion from the current static runtime-owned page
  model
- **Why rejected**: current direction is additive refactor over the existing
  non-SPA runtime UI substrate

## References

- [SPEC-017](../specs/SPEC-017-standalone-provider-bootstrap-and-generated-config.md)
- [PLAN-019](../plans/PLAN-019-shared-runtime-ui-foundation-for-dashboard-playground-and-provider-setup.md)
- [ADR-014](./014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [cats SuiteSurfaceSwitcher](../../../cats/src/design/components/SuiteSurfaceSwitcher.tsx)

---

*Accepted: 2026-03-29*
*Decision makers: user + Codex*
