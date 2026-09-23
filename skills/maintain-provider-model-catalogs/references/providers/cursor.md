# Cursor Catalog Refresh

Use this reference for Cursor picker families, parameterized models, and fixed-combination
shortlists. Current model values and chosen combinations belong in the curated catalog and
evidence, not this skill. The initial implementation and capture are recorded in
`docs/research/2026-09-17-cursor-fixed-presets.md` in cats-runtime.

## Resolve the intended menu before editing

- Use the operator's latest explicit choice: adjustable model parameters or fixed combinations.
  A fixed-combination choice supersedes an earlier proposal for individual controls. Only ask
  about settings still unspecified; do not ask the operator to repeat already resolved choices.
- Keep model spelling/case and each parameter's display label. For fixed combinations, record
  the approved label composition separately from the source model label. Selection markers and
  internal variant-default metadata do not authorize a Cats `(default)` marker.
- Inspect the actual consumer path before proposing UI work. Desktop and Playground can render
  generic controls, but that does not prove Cursor execution supports those controls. Conversely,
  Desktop custom input does not prove that a particular Playground form has a custom-input action.

## Obtain exact execution expressions efficiently

1. Reuse sufficient supplied picker evidence and retained mappings first. Inspect local override
   version/count early so it cannot silently hide the bundled update.
2. When execution identifiers are missing, read installed CLI help and its read-only model list.
   A legacy slug or list label can imply a different context than the parameterized picker.
   Do not derive family ids or parameter tokens from display text or copy one model's tokens to
   another: visible Effort/Reasoning can map to different parameter keys.
3. Prefer account-resolved parameterized model metadata. Match the complete approved parameter
   tuple against a returned variant, then retain its exact `variantStringRepresentation`.
   Retain the supporting `parameterDefinitions` and `parameterValues` in redacted evidence.
   Do not treat a legacy slug as proof of a particular context window.
4. If public output omits metadata the CLI already fetched, first inspect the current listing
   implementation. A bounded, process-local, read-only output capture can expose that reply;
   preserve installed files and CLI-owned authentication. Do not add paid inference, login flows,
   credential extraction, or a separate authentication implementation. Check the hook matches
   current source and fail closed when it does not. Chunk names and offsets are version-specific,
   not reusable contracts. Prefer an explicit redacted output file: the CLI can suppress console
   logging. Stop collecting once the selected combinations are mapped.


## Schema-2 execution data

Store the exact observed `variantStringRepresentation` in `execution.model`. Fixed Context/Effort/Thinking/Fast combinations are single choices. Their approved display composition is `label`; punctuation supplied to separate fields is not necessarily display text.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
