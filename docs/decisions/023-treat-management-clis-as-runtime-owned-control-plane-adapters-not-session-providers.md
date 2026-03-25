# ADR 023: Treat Management CLIs as Runtime-Owned Control-Plane Adapters, Not Session Providers

## Status

Proposed

## Date

2026-03-25

## Context

`cats-runtime` already owns several different runtime concerns:

- session execution backends for CLI, API/local, and agent runtimes
- runtime-owned delivery primitives for repo and artifact finalization
- runtime-owned preview and browser surfaces
- runtime-managed skills and an additive MCP facade

The next requirement is to integrate management-type tools such as GitHub CLI
and Zeabur CLI so products, skills, and orchestrators can drive actions such as
pull-request creation, review-check waiting, deployment triggering, and preview
registration.

There is an obvious but wrong shortcut:

- add `gh` and `zeabur` to the CLI runtime provider list
- model them like `claude`, `codex`, `gemini`, or `pi`
- treat management commands like another chat/session runtime

That shortcut conflicts with the actual runtime model:

- session providers assume turn-based execution, streamed output, and often
  `resume` / `fork` behavior
- management CLIs are command-oriented control-plane tools
- they operate on repos, PRs, environments, and deployments rather than
  conversational sessions
- forcing them into provider routing would pollute `providers.yaml` with tools
  that are not model providers

At the same time, pushing `gh` / `zeabur` usage fully into runtime-managed
skills, MCP-only helpers, or upper-layer product code would also be the wrong
boundary. The runtime should own executable integration; skills and MCP should
remain orchestration and exposure surfaces.

The project needs a clear architectural decision for where management-type CLI
integrations belong.

## Decision

Management-type CLIs will be integrated into `cats-runtime` as runtime-owned
control-plane adapters, not as session providers.

This decision includes:

1. Tools such as `gh` and `zeabur` are not added to the session-provider
   families under `src/backends/cli/providers` or `providers.yaml`
   provider-routing topology.
2. `cats-runtime` will expose runtime-owned management action contracts for
   domains such as:
   - review / forge
   - deployment / preview
3. Management adapters may be implemented with local CLIs, vendor APIs, or
   hybrid transports, but the public contract stays runtime-owned and
   machine-readable.
4. Runtime-managed skills may request management actions, but they do not own
   the underlying vendor execution logic.
5. MCP tools may expose management actions externally, but MCP remains an
   additive access surface rather than the architectural home of those
   integrations.
6. Management diagnostics, install guidance, and auth/readiness reporting
   should remain separate from AI provider-model catalogs and provider-routing
   concerns.
7. Deployment and preview outputs produced through management adapters should
   reuse existing runtime preview-surface contracts instead of inventing a
   second preview schema.
8. Product governance remains above runtime. `cats-runtime` executes approved
   management actions and reports blocked or degraded states; it does not infer
   whether GitHub, Zeabur, or any other control-plane vendor is required for a
   given workspace.
9. Authorization inputs for management actions must remain product-neutral.
   - the runtime may accept generic caller classification or opaque approval
     references
   - the runtime should not require product-specific persona or role names in
     its public contract
   - higher-level approval policy remains product-owned even when runtime
     mutations require authorization metadata

## Consequences

### Positive

- keeps the session-provider model truthful and focused on actual AI runtimes
- gives `cats-runtime` a reusable home for forge and deployment execution
  primitives
- lets skills, dashboard flows, and MCP all share one underlying management
  integration layer
- keeps vendor choice replaceable behind runtime-owned contracts
- aligns naturally with the existing runtime split between execution ownership
  and product policy ownership

### Negative

- introduces another runtime subsystem that needs contracts, diagnostics, and
  adapter management
- requires a new config/catalog seam because provider routing is no longer the
  right home for these tools
- review and deployment flows may have longer-running status models than the
  current repo commit/push primitives, which increases contract complexity

### Neutral

- this decision does not require every management integration to start with a
  CLI implementation forever
- this decision does not require management adapters to become visible in every
  product surface immediately
- this decision does not prevent some simple one-off vendor operations from
  remaining outside runtime when they are clearly product-only concerns

## Alternatives Considered

### Alternative 1: Model Management CLIs as Normal Session Providers

- **Pros**: reuses some existing CLI runtime machinery at first glance
- **Cons**: fakes a session model for tools that are not session-oriented,
  pollutes provider routing, and weakens the provider/runtime boundary
- **Why rejected**: management CLIs are control-plane adapters, not
  conversational runtimes

### Alternative 2: Keep Management Integrations Mostly in Skills

- **Pros**: maximum short-term flexibility and low runtime code churn
- **Cons**: execution logic becomes prompt-level and ad hoc, with weaker
  observability and portability across products
- **Why rejected**: skills should orchestrate runtime capabilities, not become
  the canonical owner of vendor execution semantics

### Alternative 3: Expose Management Behavior Only Through MCP Helpers

- **Pros**: external orchestrators get a clean tool surface
- **Cons**: MCP becomes the de facto architecture instead of an additive
  transport, and direct product/runtime APIs would still lack the same
  capability
- **Why rejected**: the runtime should own the capability first; MCP can expose
  it second

### Alternative 4: Let Product Hosts Shell Out to `gh` / `zeabur` Directly

- **Pros**: no runtime changes required in the short term
- **Cons**: duplicates execution logic across hosts, hides capability gaps from
  runtime diagnostics, and weakens the `cats-runtime` execution boundary
- **Why rejected**: executable integration belongs behind reusable runtime
  seams

## References

- [SPEC-019: Runtime-Owned Management Adapters for Forge and Deployment Control
  Planes](../specs/SPEC-019-runtime-owned-management-adapters-for-forge-and-deployment-control-planes.md)
- [SPEC-009: Executable Delivery and Governance
  Primitives](../specs/SPEC-009-executable-delivery-and-governance-primitives.md)
- [SPEC-005: Runtime-Managed Skills v0](../specs/SPEC-005-runtime-managed-skills-v0.md)
- [ADR-014: Keep lightweight provider setup and diagnostics in
  `cats-runtime`](./014-keep-lightweight-provider-setup-and-diagnostics-in-cats-runtime.md)
- [ADR-016: Own executable delivery primitives, not delivery
  policy](./016-own-executable-delivery-primitives-not-delivery-policy.md)
- [Architecture](../architecture.md)

---

*Decision made: 2026-03-25*
*Decision makers: Proposed by Codex from user direction*
