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

## Apply the approved shortlist

Use `selection_mode: shortlist`, raw IDs in `name`, and exact display text in `label`.
Model-list-only evidence adds no option controls or default flags. Reuse the existing verbatim
normalizer, static catalog route and entry-only advanced overlay. `AuggieProvider` already passes
these native IDs through `--model`; verify the current adapter before expanding execution scope.
The availability of a model-list command alone does not authorize adding runtime discovery.

Follow [new shortlist rollout checks](../catalog-surfaces.md#new-shortlist-rollout-checks),
including all Playground custom-input conditions, fallback tables and Desktop selection.
`auggieModelCatalog.test.ts` covers curated/static refresh and actual argument construction;
Playground and mounted Desktop tests cover initial selection, labels and custom availability.
