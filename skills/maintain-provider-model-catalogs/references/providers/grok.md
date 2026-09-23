# Grok Catalog Refresh

Use this path for Grok model-picker and per-model effort maintenance. Current versions, models,
option sets, and counts belong in catalog data and evidence. The retained implementation evidence
is `docs/research/2026-09-17-grok-model-picker-refresh.md` in cats-runtime.

## Use the supplied picker and retained mappings

- Follow [picker intake](../paste-intake.md) for screenshots/transcription when TUI text cannot be
  copied. Keep each effort menu attached to its confirmed model; `(active)` indicates the session
  selection, not a provider default. Keep the original marker in evidence while excluding it from
  display labels when requested.
- Inspect retained Grok manifest fixtures for model IDs and effort `value`/`label` pairs. Schema-2 `controls[].values` stores separate picker labels and raw tokens. Reuse unchanged proven mappings instead of
  launching the CLI again; retain their original version/date and verify the evidence path exists.
  A new unmapped value remains an evidence gap.
- The CLI takes model and effort separately (`--model` and `--reasoning-effort`). Do not derive
  model IDs from display text or expand per-model menus to the wider flag vocabulary in help.
- When the operator explicitly requests first-item initialization without default claims, remove
  superseded Cats defaults within that authorization. If older manifest evidence declared a
  default, record this as a Cats display/selection policy; absence of a marker in a newer screenshot
  does not prove the upstream default changed. Without that explicit direction, follow the shared
  conflict/default confirmation rules.
- Preserve each model's effort description in its own option notes. Keep per-entry descriptions in `controls[].values[].description`; do not overwrite evidence when
  two models word the same effort differently.

Compare the effective local Grok override early; it can hide the bundled refresh. Prepare the
provider-only replacement, reuse any explicit synchronization authorization, and back up before
writing. Follow [evidence and scope](../evidence-and-scope.md) for unresolved authorization.


## Schema-2 execution data

Use per-model `grok.reasoning_effort` values with exact tokens/labels/descriptions. The adapter sends `--reasoning-effort` separately. Shared token spellings do not merge distinct descriptions across models.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
