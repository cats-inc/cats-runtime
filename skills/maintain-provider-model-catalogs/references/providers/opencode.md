# OpenCode Catalog Refresh

Use sufficient supplied labels and retained ID mappings first. Current selected models and their
evidence belong in `docs/research/2026-09-18-opencode-shortlist.md`, not in this reference.

## Resolve missing provider-qualified IDs

- Cats executes OpenCode models as `provider/model`. A display name alone does not identify the
  provider namespace; identical names can appear under both `opencode` and `opencode-go`.
- When a mapping is missing, inspect installed `opencode models --help`. In the verified 1.18.31
  capture, `opencode models --verbose --pure` returned an ID line followed by a JSON metadata
  object containing `name` and `providerID`. Use a bounded, read-only invocation with
  `OPENCODE_DISABLE_AUTOUPDATE=true`; no prompt, session, login or inference is needed.
- Parse the current output shape and retain only relevant public ID/name/provider fields. This
  is not one JSON document; do not pass the entire output directly to `JSON.parse`. Stop once
  the selected rows are mapped. The normal listing helper intentionally exposes raw IDs as labels;
  it does not replace the operator's display-name evidence.
- If multiple providers expose the same selected name, ask only which namespace to use for that
  row. Do not pick the first result or infer it from neighboring rows. A matching name/ID does
  not establish model options, defaults or entitlements on another machine.


## Schema-2 execution data

Use the observed provider-qualified token in `id` and `execution.model`, exact display name in `label`. Matching names in two namespaces require an explicit choice. A model-only list establishes no effort/default metadata.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
