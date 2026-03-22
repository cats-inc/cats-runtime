# ADR 008: Keep Provider Model Catalog Discovery Runtime-Owned

## Status

Accepted

## Date

2026-03-19

## Context

`cats-runtime` already owns provider topology, instance resolution, backend
routing, and the execution-specific auth/runtime details needed to talk to model
providers. It already exposes:

- `GET /providers/config` for configured provider-instance topology
- `GET /kiro/models` as a provider-specific model-listing exception
- optional `listModels()` capability on agent adapters

At the same time, `cats` still carries renderer-side hardcoded provider
model lists for execution-target dropdowns. That makes the UI the de facto owner
of model availability even though the renderer does not know:

- which configured instance is being targeted
- which backend is active for that provider family
- which auth/runtime environment is valid for discovery
- whether a target can support dynamic discovery at all

The result is the wrong ownership boundary. Model availability is a runtime
concern, not a renderer concern.

Another design choice is still open: should the runtime keep model lists fresh
with background polling, or discover them only when a caller asks?

## Decision

`cats-runtime` will own provider model catalog discovery and expose it through a
direct runtime API.

This decision includes:

1. The authoritative model catalog lives in `cats-runtime`, not in `cats`
   renderer code.
2. Discovery is **lazy and on-demand**, backed by an in-memory TTL cache.
3. `cats-runtime` will **not** add background polling or scheduler-driven model
   refresh in the first design.
4. Catalog lookup is **instance-aware** and **config-scoped**:
   callers ask for a configured provider family plus optional instance, and the
   runtime resolves discovery using the configured backend, transport, auth, and
   runtime environment for that target.
5. The configured/default model for an instance remains important runtime
   metadata and must remain visible in the returned catalog even when discovery
   finds additional choices.
6. Dynamic discovery is used where the target genuinely supports it. Static or
   config-derived fallback remains valid for providers that do not.
7. The first public surface is a **per-provider** model-catalog endpoint.
   Aggregate endpoints and explicit refresh endpoints may be added later.
8. `cats` should consume this catalog through its server-side product API
   layer. The renderer should not be required to call `cats-runtime` directly.

## Rationale

- keeps provider/backend/auth/runtime knowledge in the runtime boundary that
  already owns it
- removes renderer-maintained model lists as the source of truth
- avoids continuous subprocess spawning or remote probing when no UI or caller
  is asking for model data
- aligns with existing optional `listModels()` adapter capabilities instead of
  inventing a second discovery subsystem
- preserves the `cats` direct-product-API boundary from `cats`
  ADR-008

## Consequences

### Positive

- one owner for provider model availability
- the UI can render provider/model dropdowns from runtime-fed data instead of
  stale hardcoded tables
- discovery logic can vary by backend without leaking those details into
  product or renderer code
- expensive CLI or remote discovery only runs when there is an actual caller

### Negative

- `cats-runtime` HTTP surface grows with another catalog-oriented endpoint
- the runtime now needs cache semantics, fallback rules, and partial-failure
  behavior for model discovery
- some providers will still need static or config fallback, so "available
  models" will not mean the same thing for every target

### Neutral

- provider-specific compatibility routes such as `GET /kiro/models` may remain
  temporarily, but new consumers should prefer the generic model-catalog route
- future aggregate or refresh endpoints remain additive, not required for the
  first slice

## Alternatives Considered

### Alternative 1: Background Polling in `cats-runtime`

- **Pros**: callers always get a pre-warmed cache
- **Cons**: wastes subprocess/network work when nobody is looking at the UI and
  adds scheduler behavior to a path that does not need it
- **Why rejected**: on-demand discovery with TTL cache matches the actual usage
  pattern better and keeps the first implementation simpler

### Alternative 2: Keep the Catalog in `cats` Renderer Code

- **Pros**: fast to keep shipping with the current dropdown implementation
- **Cons**: duplicates runtime knowledge in the wrong layer and becomes stale as
  provider targets change
- **Why rejected**: the renderer does not own backend, instance, auth, or
  discovery semantics

### Alternative 3: Treat Vendor `/models` Endpoints as the UI's Authoritative List

- **Pros**: can expose a large dynamic catalog for some API providers
- **Cons**: ignores configured instance boundaries and overfits the design to
  providers that happen to expose broad listing APIs
- **Why rejected**: the runtime must resolve model availability in the context
  of a configured target, not as a raw vendor-account capability dump

## References

- [ADR 003: Move provider execution topology into file-based provider instances](./003-provider-instance-config.md)
- [ADR 005: Introduce a backend-neutral runtime facade for CLI and API backends](./005-backend-neutral-runtime-and-api-backend.md)
- [ADR 006: Introduce an agent backend and shared runtime contracts](./006-agent-backend-and-shared-runtime-contracts.md)
- [SPEC-004: Provider Model Catalog and Discovery](../specs/SPEC-004-provider-model-catalog-and-discovery.md)
- [cats ADR-008: Expose cats-runtime via Direct API and MCP Facade](../../../cats/docs/decisions/008-expose-cats-runtime-via-direct-api-and-mcp-facade.md)

---

*Decision made: 2026-03-19*
*Decision makers: Codex + user direction*

