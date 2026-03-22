# PLAN-005: Provider Model Catalog and Discovery

> Implementation plan for delivering the runtime-owned model catalog defined in
> `SPEC-004` without introducing background polling or moving catalog ownership
> back into product code.

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Assigned To** | Codex |
| **Reviewer** | Claude / user follow-up |

## Related Spec

[SPEC-004: Provider Model Catalog and Discovery](../specs/SPEC-004-provider-model-catalog-and-discovery.md)

## Overview

`cats-runtime` already owns provider topology, backend routing, target
resolution, and the auth/runtime details needed to discover models. The missing
piece is a generic model-catalog service and route that can answer
"what models are available for this configured target?" without relying on
renderer-maintained hardcoded tables.

The implementation should stay deliberately small:

- one per-provider, instance-aware runtime route
- lazy discovery with in-memory TTL cache
- clear fallback ordering: `dynamic -> config -> static`
- no background polling
- no aggregate endpoint requirement for the first slice

The result should be a stable runtime contract that `cats` can consume
server-side while keeping renderer code out of provider-specific discovery
logic.

## Scope

### In Scope

- add a backend-neutral provider model catalog service
- add a first generic route: `GET /providers/{provider}/models`
- resolve configured provider targets using existing instance/default rules
- support dynamic discovery for `ollama`
- support dynamic discovery for `agent` adapters that already expose
  `listModels()`
- fold the current Kiro compatibility table into the generic catalog service
- provide config or static fallback for providers without dynamic listing
- document cache semantics, response shape, and fallback behavior
- add tests for service and route behavior

### Out of Scope

- background polling or scheduler-driven refresh
- a first-slice aggregate `GET /providers/models` route
- a required refresh endpoint in the first slice
- changing `cats` renderer code in this plan
- treating raw vendor `/models` endpoints as the authoritative UI contract

## Implementation Phases

### Phase 1: Core Catalog Contract and Target Resolution

- [ ] Add shared model catalog types under `src/core`
- [ ] Introduce a `ProviderModelCatalogService` that resolves provider family,
      backend kind, instance id, and default model using existing catalog and
      config plumbing
- [ ] Define the internal cache key and result shape used by both service and
      route layers
- [ ] Normalize response semantics for `source`, `cache`, `models`, and
      optional `warnings`

**Deliverables**: one backend-neutral service contract that can answer model
catalog lookups for a resolved runtime target.

### Phase 2: Discovery Strategies and Fallbacks

- [ ] Implement dynamic discovery for `ollama`
- [ ] Integrate `agent` adapter `listModels()` where available
- [ ] Reuse or fold the current Kiro static model table into the generic
      fallback layer
- [ ] Add config-derived fallback for configured providers that do not expose a
      dynamic listing
- [ ] Add curated static fallback where config-only output is too thin to be
      useful

**Deliverables**: working `dynamic -> config -> static` discovery flow with a
small initial strategy set.

### Phase 3: Cache Semantics and HTTP Surface

- [ ] Add in-memory TTL caching keyed by resolved provider target
- [ ] Use a short default TTL for discovery-backed results, with `60s` as the
      initial baseline
- [ ] Add `GET /providers/{provider}/models?instance=...`
- [ ] Return client errors for unknown providers or invalid instance ids
- [ ] Keep provider-specific compatibility routes working while steering new
      consumers toward the generic route

**Deliverables**: one documented runtime endpoint with stable cache and error
semantics.

### Phase 4: Documentation and Verification

- [ ] Update `docs/api.md` with the new route and response contract
- [ ] Update `docs/architecture.md` if the catalog service changes the runtime
      layering in a meaningful way
- [ ] Add service and route tests for dynamic discovery, fallback behavior, and
      cache hits
- [ ] Record any provider-specific limitations or warnings discovered during
      implementation

**Deliverables**: docs and tests aligned with the shipped contract.

### Phase 5: Deferred Follow-Ons

- [ ] Revisit whether a runtime aggregate endpoint is still useful after
      `cats` server integration is real
- [ ] Revisit whether an explicit refresh endpoint is needed after cache
      behavior is exercised
- [ ] Add explicit timeout and abort handling for discovery-backed HTTP fetches
      such as `ollama` model listing so partial hangs degrade into fallback
      warnings instead of long-lived requests
- [ ] Expand dynamic discovery to more CLI or API-backed providers only when
      they have clear, stable listing semantics
      Candidates to evaluate first: `pi`, `opencode`, and `cursor`

**Deliverables**: a bounded follow-on list instead of scope creep in the first
slice.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/core/models/*` | Create | Shared model catalog types, service, and strategy helpers |
| `src/core/providerCatalog.ts` | Modify | Reuse target resolution or expose helpers needed by the catalog service |
| `src/http/routes/providers.ts` | Modify | Add the generic per-provider model-catalog route |
| `src/http/routes/kiro.ts` | Modify | Keep compatibility while routing shared logic through the generic service |
| `tests/*` | Modify/Create | Service, cache, and route regression coverage |
| `docs/api.md` | Modify | Document `GET /providers/{provider}/models` |
| `docs/architecture.md` | Modify | Document the new catalog service boundary if needed |

## Technical Decisions

- The first public route is per-provider and instance-aware.
- The discovery precedence is `dynamic -> config -> static`.
- In-memory TTL cache is enough for the first slice; no scheduler is needed.
- Aggregate catalog APIs are a product-integration optimization, not a runtime
  prerequisite.
- The catalog response should expose configured default model metadata even when
  discovery finds a larger dynamic set.

## Testing Strategy

- **Unit Tests**:
  - target resolution and cache-key behavior
  - config fallback generation
  - static fallback selection
  - `ollama` and `agent` strategy adapters
- **Integration Tests**:
  - route tests for valid and invalid provider/instance combinations
  - cache-hit versus cache-miss behavior
  - Kiro compatibility behavior through the shared service
- **Manual Testing**:
  - query a configured `ollama` target with changing local models
  - query a target that only has config or static fallback
  - verify `cats` can consume the per-provider route without needing an
    aggregate runtime endpoint

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Vendor-specific model listing semantics leak into the public contract | High | Keep the public response target-aware and config-scoped, not vendor-account scoped |
| Dynamic discovery becomes expensive or flaky | Medium | Use short TTL caching and clear fallback rules |
| Discovery-backed HTTP calls hang instead of failing quickly | Medium | Add explicit timeout/abort handling for remote discovery fetches and rely on fallback ordering when probes fail |
| Product work starts depending on a runtime aggregate endpoint too early | Medium | Document that multi-provider product flows should compose per-provider calls server-side first |
| Kiro compatibility logic forks from the generic route again | Medium | Move Kiro model data behind the shared service rather than maintaining two sources of truth |

## Progress Log

| Date | Update |
|------|--------|
| 2026-03-19 | Plan created after `SPEC-004` approval and follow-up review feedback |

---

*Created: 2026-03-19*
*Author: Codex*

