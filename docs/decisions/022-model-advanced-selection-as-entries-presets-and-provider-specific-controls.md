# ADR 022: Model Advanced Selection as Entries, Presets, and Provider-Specific Controls

## Status

Accepted

## Date

2026-03-25

## Context

`cats-runtime` already owns provider topology, provider-instance resolution, and
runtime-facing model-catalog discovery. That ownership is correct, but the
current public contract is still too thin for real model-selection needs.

Today the runtime mostly exposes:

- concrete provider / instance topology
- a lightweight model catalog
- a session contract centered on a single `model` string

That is enough for basic provider/model dropdowns, but not enough for richer
provider choices such as:

- model sub-variants encoded as different model ids
- per-request parameters such as reasoning effort or thinking budget
- session-level defaults for advanced model behavior

These concepts do not line up cleanly across providers. Some are model ids.
Some are request-body parameters. Some are CLI flags or runtime defaults. If
the runtime tries to normalize all of them into one fake universal "thinking"
API, it will hide real differences and produce misleading contracts. If it does
no normalization at all, upper-layer products such as `cats` will be forced to
learn raw provider-specific wire details.

## Decision

`cats-runtime` will use a hybrid advanced model-selection contract built from
three layers:

1. **Concrete entries**
   - runtime-resolvable executable model choices
   - includes model sub-variants when those sub-variants materially affect
     execution behavior
2. **Normalized presets**
   - a deliberately small cross-provider intent vocabulary such as `fast`,
     `balanced`, `deep_reasoning`, and `long_context`
   - optional per provider target
3. **Provider-specific controls**
   - schema-driven advanced controls that stay runtime-owned
   - exposed as stable runtime keys rather than raw vendor payload templates

This decision includes:

1. `cats-runtime` remains the owner of advanced model-selection knowledge.
2. Concrete sub-variants should remain concrete entries when they are true
   runtime facts, even if a provider happens to encode them into a model id.
3. The runtime may normalize a small preset layer for common user intent, but
   shall not pretend that all provider-specific advanced controls share the same
   semantics.
4. Provider-specific advanced controls shall be exposed through a schema-driven
   contract. When a control is provider-specific, its key should be
   provider-namespaced rather than falsely universalized.
5. The runtime shall resolve the structured selection into actual backend
   execution details such as model ids, request-body fields, CLI flags, or
   other provider-specific mechanics.
6. The existing lightweight `/providers/{provider}/models` contract may remain
   as a compatibility surface while an additive advanced-catalog surface is
   introduced.
7. The session contract shall evolve from a single `model` string toward a
   structured advanced model-selection payload, with the legacy `model` field
   allowed to remain as a resolved compatibility snapshot during migration.
8. Upper-layer products such as `cats` should render advanced selection from
   runtime-fed schema and should not hardcode provider-specific model-option
   logic in renderer code.

## Consequences

### Positive

- keeps provider-specific advanced selection semantics inside the runtime
  boundary that already owns provider topology and execution mapping
- gives `cats` a path to render advanced model selection without understanding
  raw provider payloads
- avoids lying about incompatible provider semantics through a fake universal
  parameter API
- supports both concrete model sub-variants and provider-specific request
  controls in one coherent contract

### Negative

- the runtime public contract becomes broader than a simple `id/label/default`
  model list
- migration requires additive read contracts plus a structured selection field
  in session APIs
- some users may expect presets to exist everywhere even though they will remain
  optional per provider target

### Neutral

- the current lightweight provider-model catalog remains useful as a migration
  and fallback surface
- provider-specific advanced controls can still expose optional semantic tags
  when the runtime can do so honestly

## Alternatives Considered

### Alternative 1: Fully Normalize All Advanced Controls

- **Pros**: upper-layer UIs would receive one supposedly uniform control model
- **Cons**: hides real differences between model ids, payload parameters, and
  provider-specific execution semantics
- **Why rejected**: the resulting contract would be misleading and hard to keep
  truthful as providers evolve

### Alternative 2: Pure Pass-Through of Raw Provider Parameters

- **Pros**: minimal runtime abstraction; preserves provider detail exactly
- **Cons**: leaks provider internals into `cats`, forces renderer logic to
  become provider-specific, and weakens the runtime boundary
- **Why rejected**: upper layers should express user intent and render schema,
  not own provider wire details

### Alternative 3: Keep Only a Single `model` String

- **Pros**: lowest short-term implementation effort
- **Cons**: cannot represent many real provider choices cleanly and encourages
  stuffing advanced behavior into opaque model ids
- **Why rejected**: the current shape is already too thin for the advanced model
  selection the suite needs

## References

- [SPEC-018: Advanced Provider Model Catalog and Selection Schema](../specs/SPEC-018-advanced-provider-model-catalog-and-selection-schema.md)
- [SPEC-004: Provider Model Catalog and Discovery](../specs/SPEC-004-provider-model-catalog-and-discovery.md)
- [ADR 008: Keep Provider Model Catalog Discovery Runtime-Owned](./008-runtime-owned-provider-model-catalog.md)
- [cats SPEC-013: Provider Catalog Consumption and UI Seam](../../../cats/docs/specs/SPEC-013-provider-catalog-consumption-and-ui-seam.md)

---

*Decision made: 2026-03-25*
*Decision makers: Codex + user direction*
