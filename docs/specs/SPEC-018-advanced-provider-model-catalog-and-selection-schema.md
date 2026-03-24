# SPEC-018: Advanced Provider Model Catalog and Selection Schema

## Metadata

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Owner** | Codex |
| **Reviewer** | User |

## Summary

`cats-runtime` currently exposes a thin provider model catalog and a thin
execution contract: callers can choose a provider, instance, and model string,
but many real provider choices do not fit cleanly into that shape.

Examples include:

- model sub-variants encoded directly in the model id
- per-request parameters such as reasoning effort or thinking budget
- session-level defaults such as preferred reasoning profile

Providers express these choices differently. Some treat them as distinct model
ids, some as request payload fields, and some as CLI flags or runtime defaults.
`cats-runtime` should not force a fake universal parameter model, but `cats`
also should not be forced to understand every provider's raw knobs.

This spec defines a hybrid contract:

- concrete executable model entries stay runtime-owned
- a small normalized preset layer captures common user intent
- provider-specific advanced controls are exposed through a schema-driven
  contract that upper-layer UIs can render without hardcoding provider logic

## Goals

- keep advanced model-selection ownership in `cats-runtime`
- support provider differences without collapsing them into a fake universal
  "thinking" or "effort" API
- let `cats` render advanced model selection through runtime-fed schema instead
  of provider-specific renderer conditionals
- distinguish clearly between:
  - concrete executable entries
  - normalized presets
  - provider-specific advanced controls
- introduce a structured selection contract that can survive session creation,
  persistence, and future per-turn overrides

## Non-Goals

- replace every current `/providers/{provider}/models` consumer in one change
- guarantee that every provider supports presets or advanced controls
- make `cats` the owner of provider-specific option semantics
- expose raw vendor payload shapes directly as the product/UI contract
- solve provider-install, readiness, or setup UX work in the same slice

## User Stories

- As a `cats` UI surface, I want a schema-driven advanced model-selection
  contract so I can render provider/model/preset/advanced options without
  knowing provider-specific wire details.
- As a runtime maintainer, I want concrete model sub-variants to stay runtime
  facts even when one provider expresses them as model ids and another uses
  request parameters.
- As an operator or end user, I want simple presets such as `fast`,
  `balanced`, `deep_reasoning`, or `long_context` when the target can support
  them, plus an advanced drawer for provider-specific overrides.

## Requirements

### Functional Requirements

1. `cats-runtime` shall keep the current `GET /providers/{provider}/models`
   contract stable as the lightweight compatibility catalog.
2. `cats-runtime` shall add an additive advanced catalog route:
   `GET /providers/{provider}/models/advanced`.
3. The advanced route shall accept optional `?instance=<instance-id>` and use
   the same target-resolution rules as the current provider-model route.
4. The advanced route shall identify the resolved provider family, backend, and
   instance id.
5. The advanced route shall return concrete executable entries. Each entry shall
   represent a runtime-resolvable execution choice, including model
   sub-variants when those sub-variants materially change runtime behavior.
6. Advanced catalog entries shall support richer metadata than the current
   lightweight catalog, including additive fields such as:
   - capability tags
   - status / availability hints
   - limits such as context-window or output-budget facts when the runtime can
     provide them with confidence
   - additive warnings or notes
7. `cats-runtime` shall expose a small normalized preset layer for common user
   intents. The first preset vocabulary should stay intentionally small and may
   include values such as:
   - `fast`
   - `balanced`
   - `deep_reasoning`
   - `long_context`
8. Presets shall be optional per target. Unsupported presets shall be omitted
   or explicitly marked unavailable; the runtime shall not pretend every
   provider supports the same intent layer.
9. `cats-runtime` shall expose provider-specific advanced controls through a
   schema-driven contract rather than raw vendor payload templates.
10. Advanced control identifiers shall be runtime-owned stable keys. When a
    control is provider-specific, its key should be provider-namespaced rather
    than pretending to be universal.
11. Advanced control definitions shall describe at least:
    - key
    - label
    - description when useful
    - value kind (`enum`, `boolean`, `number`, `string`)
    - allowed values or bounds when applicable
    - scope (`session_default`, `request`, or `both`)
    - optional semantic tags when the runtime can safely expose them
12. `cats-runtime` shall introduce a structured selection contract for advanced
    model choice. The selection contract shall be able to represent:
    - the chosen concrete entry
    - an optional preset
    - zero or more advanced control values
13. Session creation shall be able to persist a session-level advanced model
    selection, rather than only a single `model` string.
14. Turn/message execution may later support additive per-turn advanced
    selection overrides, but the session-level structured selection is the first
    requirement.
15. The existing `model` string may remain in session views and compatibility
    APIs as a resolved snapshot during migration, but it shall no longer be the
    only authoritative representation once the structured selection contract is
    introduced.
16. The runtime shall own resolution from:
    - concrete entry
    - optional preset
    - provider-specific control values
    into backend-specific spawn args, request payload fields, or other runtime
    execution details.
17. `cats` and other upper-layer hosts shall consume the advanced catalog
    through server-side product APIs. Renderers shall not be required to learn
    provider-specific runtime mappings.
18. The advanced catalog contract shall support additive migration from the
    current v1 model catalog. Existing lightweight consumers shall continue to
    work until upgraded.

### Non-Functional Requirements

- **Boundary ownership**: provider-specific execution mapping stays in
  `cats-runtime`; upper layers own user intent and UI only
- **Compatibility**: existing v1 provider/model selectors shall keep working
  during migration
- **Extensibility**: new providers or new advanced controls should plug in
  through runtime catalog/resolution layers without requiring `cats` renderer
  conditionals
- **Truthfulness**: the runtime shall not falsely normalize incompatible
  provider semantics into one universal "thinking" API

## Design Overview

### Mental Model

Advanced model selection should be split into three layers:

1. **Concrete entries**
   - runtime-resolvable executable choices
   - may include model sub-variants when the provider expresses them as
     different model ids or materially different runtime modes
2. **Normalized presets**
   - a deliberately small intent vocabulary such as `fast` or
     `deep_reasoning`
   - optional per provider target
3. **Provider-specific controls**
   - schema-driven advanced knobs
   - runtime-owned and provider-aware
   - renderer-readable without becoming vendor-specific logic

### Illustrative Advanced Catalog Shape

```json
{
  "provider": "codex",
  "backend": "cli",
  "instance": "default",
  "entries": [
    {
      "id": "gpt-5.4",
      "label": "gpt-5.4",
      "default": true,
      "capabilityTags": ["reasoning", "tool_use"],
      "limits": {
        "contextWindowTokens": 200000
      }
    }
  ],
  "presets": [
    {
      "id": "balanced",
      "label": "Balanced",
      "availability": "supported"
    },
    {
      "id": "deep_reasoning",
      "label": "Deep reasoning",
      "availability": "supported"
    }
  ],
  "controls": [
    {
      "key": "openai.reasoning_effort",
      "label": "Reasoning effort",
      "kind": "enum",
      "scope": "session_default",
      "values": ["low", "medium", "high"],
      "semanticTags": ["reasoning_intensity"]
    }
  ],
  "defaultSelection": {
    "entryId": "gpt-5.4",
    "presetId": "balanced",
    "controls": {
      "openai.reasoning_effort": "medium"
    }
  },
  "warnings": []
}
```

### Illustrative Selection Shape

```json
{
  "entryId": "gpt-5.4",
  "presetId": "deep_reasoning",
  "controls": {
    "openai.reasoning_effort": "high"
  }
}
```

### Resolution Rules

- Concrete entries are the runtime's execution facts.
- If a provider encodes a meaningful sub-variant into the model id, that
  sub-variant should surface as its own concrete entry rather than being
  re-expressed as a fake universal control.
- Presets are intent shortcuts, not provider wire formats.
- Controls carry runtime-owned schema keys. They may map to:
  - request payload fields
  - CLI flags
  - environment-bound runtime choices
  - or entry-selection adjustments

### `cats` Consumption Direction

`cats` should eventually consume two provider-model layers:

1. lightweight v1 provider/model list for compatibility and fallback
2. advanced catalog for schema-driven setup, settings, and session-level model
   preferences

That lets `cats` render:

- provider
- instance
- concrete model entry
- optional preset
- optional advanced drawer

without hardcoding per-provider logic in the renderer.

## Dependencies

- [SPEC-004: Provider Model Catalog and Discovery](./SPEC-004-provider-model-catalog-and-discovery.md)
- [ADR 008: Keep Provider Model Catalog Discovery Runtime-Owned](../decisions/008-runtime-owned-provider-model-catalog.md)
- existing session create/message contracts in `src/core/types.ts`
- future product-side catalog consumption follow-through in `cats`

## Follow-Through Document Updates

These existing documents should be updated in follow-on passes so they stay
aligned once this direction is ratified or implemented:

- `cats-runtime/docs/specs/SPEC-004-provider-model-catalog-and-discovery.md`
- `cats-runtime/docs/decisions/008-runtime-owned-provider-model-catalog.md`
- `cats-runtime/docs/api.md`
- `cats-runtime/docs/architecture.md`
- `cats/docs/specs/SPEC-013-provider-catalog-consumption-and-ui-seam.md`
- `cats/docs/api.md`
- `cats/docs/architecture.md`

## Open Questions

- [ ] Should the first additive advanced route be
      `GET /providers/{provider}/models/advanced`, or should the runtime use a
      different additive path/versioning strategy?
- [ ] Which preset vocabulary should be considered stable enough for v1 beyond
      `fast`, `balanced`, `deep_reasoning`, and `long_context`?
- [ ] Should per-turn structured overrides land in the first implementation, or
      only session-level structured selection plus resolved-session snapshots?
- [ ] Which limit facts can the runtime expose with enough confidence to be UI
      guidance rather than misleading hints?

## References

- [ADR 008: Keep Provider Model Catalog Discovery Runtime-Owned](../decisions/008-runtime-owned-provider-model-catalog.md)
- [cats SPEC-013: Provider Catalog Consumption and UI Seam](../../../cats/docs/specs/SPEC-013-provider-catalog-consumption-and-ui-seam.md)
- [API](../api.md)
- [Architecture](../architecture.md)

---

*Created: 2026-03-25*
*Author: Codex*
*Related Plan: TBD*
