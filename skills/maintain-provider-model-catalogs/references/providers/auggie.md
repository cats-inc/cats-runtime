# Auggie Catalog Refresh

Use sufficient supplied labels and retained mappings first. Current selected models and evidence
belong in `docs/research/2026-09-23-auggie-shortlist.md`, not in this procedural reference.

## Resolve missing IDs without a model turn

- Inspect the installed version/help when necessary. In verified 0.36.0, `auggie model list --json`
  returns an envelope with a `models` array whose rows contain `id` and `displayName`.
  Use one bounded read; retain only the selected public fields. No prompt/session or login is
  needed when the installed CLI can already enumerate. If authentication is required, stop and
  report the mapping gap rather than initiating login.
- Match exact supplied names; do not manufacture IDs by lowercasing or replacing punctuation.
  Names can map to opaque tokens (the retained Prism evidence is one example).
- Inspect the current JSON shape before filtering. Account/default envelope fields and the
  presence of global `--reasoning-effort` help do not establish per-model defaults or effort menus.
  An ID mapping also does not prove availability on another account.
- Do not scan the minified package or launch inference once the selected mappings are resolved.
  Preserve a projected-field artifact honestly as a projection, not a verbatim capture.


## Schema-2 execution data

Use exact CLI-observed IDs in `id` and `execution.model`, with exact `label`. No effort/default metadata follows from a model list alone. Opaque IDs are valid.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
