# SPEC-004: Provider Model Catalog and Discovery

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Approved |
| **Owner** | Codex |
| **Reviewer** | User-approved via discussion |

## Summary

`cats-runtime` should expose a runtime-owned provider model catalog so product
surfaces such as `cats` can render provider/model selection from runtime-fed
data instead of renderer-maintained hardcoded lists.

The first slice should introduce a generic, provider-instance-aware model
catalog endpoint with lazy discovery, TTL caching, and explicit fallback rules.
It should reuse runtime configuration and backend knowledge instead of creating
another discovery layer in `cats`.

## Goals

- Make `cats-runtime` the authoritative owner of provider model availability
- Replace renderer-owned hardcoded model catalogs with runtime-fed data
- Support dynamic discovery where a backend or provider can expose it safely
- Preserve useful static or config-derived fallback where dynamic discovery is
  missing or unreliable
- Keep the `cats` product boundary intact by letting product APIs consume
  the runtime catalog server-side

## Non-Goals

- Add background polling or scheduler-driven catalog refresh
- Remove all provider-specific compatibility routes in the first slice
- Make raw vendor `/models` responses the authoritative UI contract
- Solve provider health probes, approval ownership, or broader runtime
  observability in the same feature
- Require direct renderer-to-runtime HTTP calls from `cats`

## User Stories

- As a `cats` product server, I want to ask `cats-runtime` for the model
  choices of a configured provider target so the UI can render accurate
  dropdowns.
- As a runtime operator, I want dynamic model discovery when a provider or
  backend supports it, without continuous polling overhead.
- As a runtime maintainer, I want one generic catalog API instead of adding a
  new provider-specific route every time model discovery is needed.
- As a UI developer, I want the response to tell me which model is configured by
  default and whether the list came from dynamic discovery or fallback data.

## Requirements

### Functional Requirements

1. The runtime shall expose a generic route:
   `GET /providers/{provider}/models`.
2. The route shall accept optional `?instance=<instance-id>` and resolve it
   using the same provider-instance/default-target rules already used elsewhere
   in `cats-runtime`.
3. The response shall identify the resolved provider family, backend kind,
   instance id, and configured default model for that target.
4. The response shall return a list of model entries with at least `id` and
   `label`.
5. The response shall indicate the discovery origin as one of:
   `dynamic`, `config`, or `static`.
6. The response shall include cache metadata for discovered results, including
   at least `cachedAt`, `ttlSec`, and whether the result was served from cache.
7. The runtime shall use lazy, on-demand discovery. No background polling shall
   be required for the first slice.
8. The runtime shall support provider-specific discovery strategies behind a
   backend-neutral service boundary.
9. When dynamic discovery fails, the runtime shall fall back to config-derived
   or static data when such fallback exists, and may include warnings in the
   response.
10. Unknown providers or invalid instance ids shall return a client error rather
    than an empty success response.
11. The first implementation slice shall support:
    - dynamic discovery for `ollama`
    - dynamic discovery for `agent_sdk_bridge` targets where the adapter already
      exposes `listModels()`
    - static compatibility for the current `kiro` model table
    - config or static fallback for the remaining configured providers
12. The runtime may keep provider-specific compatibility routes such as
    `GET /kiro/models`, but new consumers shall target the generic route.
13. The first slice shall not require an aggregate `GET /providers/models`
    endpoint.
14. The first slice shall not require an explicit refresh route. Manual refresh
    may be added later as an additive endpoint.
15. `cats` shall be able to consume the catalog through its server-side
    runtime client and expose it to the renderer through product APIs.

### Non-Functional Requirements

- **Performance**: cache hits should be memory-fast; discovery misses should
  reuse existing backend/provider timeout constraints instead of introducing an
  unbounded probe path
- **Boundary ownership**: backend, auth, transport, and runtime-specific model
  discovery logic shall stay inside `cats-runtime`
- **Extensibility**: new providers should plug in through discovery strategies
  or fallback sources without changing the public response contract
- **Compatibility**: the feature shall not break `GET /providers/config` or
  existing provider-management flows

## Design Overview

### Public Route

First-slice route:

```text
GET /providers/{provider}/models?instance={id}
```

Illustrative response shape:

```json
{
  "provider": "ollama",
  "backend": "local",
  "instance": "local",
  "defaultModel": "qwen2.5-coder:7b",
  "source": "dynamic",
  "cache": {
    "servedFromCache": true,
    "cachedAt": "2026-03-19T12:00:00.000Z",
    "ttlSec": 60
  },
  "models": [
    { "id": "qwen2.5-coder:7b", "label": "qwen2.5-coder:7b", "default": true },
    { "id": "deepseek-r1:14b", "label": "deepseek-r1:14b" }
  ],
  "warnings": []
}
```

Notes:

- `source` describes the authoritative discovery origin, not merely whether the
  response was cached.
- The configured/default model should remain visible even if the dynamic source
  did not explicitly mark it as default.
- `warnings` is additive and optional, useful when dynamic discovery failed and
  fallback was used.

### Internal Service Shape

The runtime should centralize this behind a model-catalog service rather than
adding route-local logic:

```ts
interface ProviderModelCatalogEntry {
  id: string;
  label: string;
  default?: boolean;
}

interface ProviderModelCatalogResult {
  provider: string;
  backend: 'cli' | 'api' | 'local' | 'agent';
  instance: string;
  defaultModel: string | null;
  source: 'dynamic' | 'config' | 'static';
  cache?: {
    servedFromCache: boolean;
    cachedAt: string;
    ttlSec: number;
  };
  models: ProviderModelCatalogEntry[];
  warnings?: string[];
}
```

Suggested internal composition:

- `ProviderModelCatalogService`
- strategy layer for dynamic discovery where available
- config-derived fallback layer from resolved provider instances
- static fallback layer for known providers that still need curated lists

### Discovery Strategy Guidance

The service should prefer this order:

1. `dynamic` discovery when the resolved target can support it
2. `config` fallback from resolved provider-instance metadata
3. `static` fallback where a curated list already exists

The initial strategy set should be deliberately small:

- `ollama`: use the local model-runtime API
- `agent_sdk_bridge`: call the adapter's existing `listModels()`
- `kiro`: fold the current static table into the generic service
- others: use config/static fallback until a dedicated strategy exists

Future strategies may include:

- CLI probes such as `pi --list-models` or `opencode models`
- remote vendor model listing where the runtime decides that the provider,
  transport, and instance semantics make that useful

### Cache Semantics

- Use in-memory TTL caching keyed by resolved provider target plus discovery
  context
- Default TTL for discovery-backed results should be short-lived, with `60s` as
  the initial baseline for subprocess or remote model-list probes
- Do not add scheduler-driven background refresh in this slice
- A future explicit refresh endpoint is allowed, but not required

### `cats` Consumption

`cats` should stop treating renderer-side hardcoded model tables as the
authoritative source.

Recommended consumption path:

1. `cats` server calls `cats-runtime`
2. `cats` product API returns the resolved model catalog to the renderer
3. the renderer uses runtime-fed model options for dropdowns

This keeps the direct product API boundary intact and avoids requiring the
renderer to know runtime auth/base-url details.

Product flows that need more than one provider list, such as setup or
onboarding screens, can compose multiple per-provider runtime calls inside the
`cats` server. A runtime-level aggregate endpoint is still optional follow-on
work, not a prerequisite for first product integration.

## Dependencies

- provider-instance resolution from `config/providers.yaml`
- existing backend-neutral provider catalog logic
- existing Kiro compatibility route/data
- existing agent-adapter `listModels()` hook where available

## Open Questions

- [ ] Should the runtime add an aggregate `GET /providers/models` endpoint after
      the per-provider route is stable?
- [ ] Which API-backed providers should eventually support dynamic listing
      beyond `ollama` and `agent_sdk_bridge`?
- [ ] Should config-derived fallback be able to expose more than the configured
      default model when a provider family has a well-known curated set?
- [ ] Should the cache key include additional auth- or environment-derived
      fields for CLI discovery targets?

## References

- [ADR 008: Keep Provider Model Catalog Discovery Runtime-Owned](../decisions/008-runtime-owned-provider-model-catalog.md)
- [ADR 003: Move provider execution topology into file-based provider instances](../decisions/003-provider-instance-config.md)
- [ADR 006: Introduce an agent backend and shared runtime contracts](../decisions/006-agent-backend-and-shared-runtime-contracts.md)
- [API](../api.md)
- [cats ADR-008: Expose cats-runtime via Direct API and MCP Facade](../../../cats/docs/decisions/008-expose-cats-runtime-via-direct-api-and-mcp-facade.md)

---

*Created: 2026-03-19*
*Author: Codex*
*Related Plan: [PLAN-005](../plans/PLAN-005-provider-model-catalog-and-discovery.md)*

