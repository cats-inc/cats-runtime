# ADR-011: Add a Runtime-Owned Browser and Preview Subsystem with Pluggable Drivers

> Keep browser lifecycle and preview delivery inside `cats-runtime` while
> allowing multiple browser automation drivers behind one runtime-owned contract.

## Status

Proposed

## Date

2026-03-19

## Context

`cats-inc` is converging on three related product surfaces: `Cats Chat`,
`Cats Work`, and `Cats Code`. Across those surfaces, an important user outcome
is no longer just "agent can use a browser". The stronger requirement is:

- a coding or work-focused Cat can deploy something locally
- the resulting local app or page can be opened and observed reliably
- the product can show that preview in a dedicated canvas/pane instead of
  depending on whichever tab, window, or hidden Chromium instance an upstream
  provider chooses to open
- browser-backed testing and preview can remain associated with the room/run
  that produced them

Current runtime and product decisions already define part of the required
boundary:

- `cats-runtime` is the only runtime boundary for upper-layer products
- product services use direct runtime APIs while orchestrator-style agents may
  use an MCP facade
- preview should be modeled as runtime-reported surfaces rather than
  provider-returned iframe markup
- product-owned `mcpProfile` / tool intent should be translated into
  runtime-owned tool delivery and lazy activation

Those decisions still leave one unresolved architectural gap:

- browser automation today can be provided by provider-native tools,
  CLI-specific browser-use features, MCP tools, or external browser services
- none of those sources alone guarantee product-owned preview persistence,
  stable page/session identity, or a single browser lifecycle model across
  providers
- treating browser actions as just another stateless local tool is too weak for
  long-lived preview sessions, deploy-and-show flows, and future operator
  takeover
- introducing a new product-facing `rpa-runtime` boundary immediately would
  compete with the already accepted `cats-runtime` boundary before the contract
  is stabilized

The project needs an explicit decision for where browser lifecycle, preview
surface normalization, and pluggable browser-driver integration should live.

## Decision

`cats-runtime` will introduce a runtime-owned browser and preview subsystem as
an internal capability of the existing runtime boundary, with pluggable browser
drivers behind a stable runtime contract.

This decision includes:

1. `cats-runtime` remains the only runtime boundary exposed to `cats-inc` and
   other upper layers. A separate product-facing `rpa-runtime` is not created in
   the first phase.
2. Browser lifecycle becomes a first-class runtime concern.
   - browser sessions
   - page/session identity
   - optional profile/auth state
   - lifecycle for preview-oriented runs
3. Preview delivery becomes a first-class runtime concern.
   - runtime-managed services, browser pages, and previewable artifacts should
     map into normalized preview surfaces
   - preview surfaces remain runtime-reported; rendering policy remains
     product-owned
4. Browser execution uses pluggable drivers behind one runtime-owned contract.
   Candidate driver families may include:
   - local browser automation adapters
   - MCP-backed browser drivers
   - external browser automation services
   - provider-specific browser agents when they can be normalized behind the
     same contract
5. `cats-inc` continues to own product intent and rendering behavior.
   - which Cat/room/transport gets browser capability
   - whether a preview surface appears inline, externally, or as a fallback
   - how Chat/Work/Code canvases present the surface
6. `cats-runtime` owns executable browser delivery.
   - translating tool intent into driver activation
   - browser/session lifecycle
   - preview-surface registration
   - observability and warnings about unsupported driver capabilities
7. The first implementation target is the deploy-preview-and-observe workflow.
   The subsystem should support a Cat starting a local service or generating a
   previewable output, then exposing that result through a stable runtime-owned
   preview surface.
8. This subsystem is browser-first, not general desktop RPA in phase one.
   Full desktop automation, arbitrary GUI control, and non-browser computer-use
   concerns remain out of scope unless later requirements force expansion.
9. Driver choice must remain replaceable. No single external browser project is
   treated as the permanent architectural base for the Cats product stack.

## Rationale

- preserves the already accepted `cats-runtime` boundary instead of adding a
  second competing runtime surface too early
- solves the product requirement that previews be visible and controllable from
  Cats surfaces rather than from provider-owned windows/tabs
- leaves room for multiple browser drivers without coupling product behavior to
  one vendor or one browser UX shell
- fits the existing split where `cats-inc` owns tool intent and rendering while
  `cats-runtime` owns executable delivery
- creates a path from today's browser automation experiments to a future
  preview-canvas experience without forcing a custom browser product fork into
  the center of the stack

## Consequences

### Positive

- Browser-backed preview becomes a runtime-owned concept instead of an accident
  of whichever provider/browser tool happened to run.
- `cats-inc` can build a stable preview canvas for Chat, Work, and Code against
  normalized runtime surfaces.
- Browser drivers stay replaceable, which lowers lock-in risk.
- Deploy-preview-test flows can keep room/run affinity and observability.

### Negative

- `cats-runtime` grows a new lifecycle subsystem that is more stateful than the
  current local tool set.
- The project must define runtime contracts for browser session identity,
  preview registration, and cleanup.
- Some providers/drivers will only support partial capability in the first
  phase, so the runtime must surface capability gaps clearly.

### Neutral

- This decision does not require every provider to expose browser capability.
- This decision does not require immediate extraction into a standalone
  browser-specific service.
- This decision does not require the first release to support user takeover or
  live bidirectional browser control.

## Alternatives Considered

### Alternative 1: Rely only on provider-native browser-use features

- **Pros**: Lowest implementation effort inside `cats-runtime`
- **Cons**: Browser lifecycle, tab/window behavior, and preview persistence stay
  provider-specific and product-unreliable
- **Why rejected**: it does not satisfy the product requirement for a stable,
  product-visible preview canvas and deploy-and-show workflow

### Alternative 2: Treat browser automation as only another stateless local tool

- **Pros**: Reuses the existing `src/core/tools` mental model
- **Cons**: Too weak for long-lived preview sessions, page identity, service
  bindings, and richer browser observability
- **Why rejected**: browser preview introduces lifecycle and surfaced-state
  requirements beyond the first local tool runtime slice

### Alternative 3: Introduce a standalone product-facing `rpa-runtime` now

- **Pros**: Hard separation for browser automation and future expansion toward
  wider RPA use cases
- **Cons**: Creates a second runtime boundary before the browser/preview
  contract is even stabilized; increases product integration complexity
- **Why rejected**: the accepted architecture already has `cats-runtime` as the
  only runtime boundary and should absorb this capability first

### Alternative 4: Build the stack around one external browser project as the
permanent foundation

- **Pros**: Faster initial momentum if one project already offers browser UX,
  automation, and agent integrations
- **Cons**: Risks coupling Cats product semantics to an external browser shell,
  lifecycle model, license posture, or UI assumptions
- **Why rejected**: Cats needs a runtime-owned contract with pluggable drivers,
  not a permanent dependency on one browser product's architecture

## References

- [cats-runtime Architecture](../architecture.md)
- [ADR 005: Introduce a backend-neutral runtime facade for CLI and API backends](./005-backend-neutral-runtime-and-api-backend.md)
- [ADR 006: Introduce an agent backend and shared runtime contracts](./006-agent-backend-and-shared-runtime-contracts.md)
- [ADR 009: Keep `cats-runtime` separately packageable with app-managed local startup](./009-keep-cats-runtime-separately-packageable-with-app-managed-local-startup.md)
- [cats-inc ADR-008: Expose `cats-runtime` via direct API and MCP facade](../../../cats-inc/docs/decisions/008-expose-cats-runtime-via-direct-api-and-mcp-facade.md)
- [cats-inc ADR-019: Normalize runtime previews as surfaces, not provider iframes](../../../cats-inc/docs/decisions/019-normalize-runtime-previews-as-surfaces-not-provider-iframes.md)
- [cats-inc ADR-020: Own MCP intent in product and tool delivery in runtime](../../../cats-inc/docs/decisions/020-own-mcp-intent-in-product-and-tool-delivery-in-runtime.md)
- [cats-inc SPEC-020: Embedded preview surfaces for runtime artifacts and services](../../../cats-inc/docs/specs/SPEC-020-embedded-preview-surfaces-for-runtime-artifacts-and-services.md)
- [cats-inc SPEC-021: Contextual MCP profiles and lazy tool activation](../../../cats-inc/docs/specs/SPEC-021-contextual-mcp-profiles-and-lazy-tool-activation.md)

---

*Decision made: 2026-03-19*
*Decision makers: Proposed by Codex from user direction*
