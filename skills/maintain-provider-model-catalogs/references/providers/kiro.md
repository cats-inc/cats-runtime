# Kiro Catalog Evidence

## Supplied shortlist fast path

An operator-selected list of exact model IDs can supply both IDs and display text. Preserve the
strings and order, label the version as operator-reported, and use the established six-plus-custom
policy. A complete desired shortlist does not claim a complete upstream/account catalog. Do not
launch Kiro or request another capture merely to corroborate unambiguous supplied IDs.

Use `selection_mode: shortlist` with exact IDs. No model allowlist belongs in code.

When fresh account evidence is actually needed, use authenticated `kiro-cli model list` output if
it succeeds. Logged-out or account-gated output proves only the gate; a newer `--version` does not
refresh the model list.

## Options and execution

`kiro-cli chat --effort` exposes an effort control, but a help-declared value range alone does not
prove picker visibility, per-model applicability, or the current default. Capture option behavior in
the selected model context before projecting it, and do not promote a CLI-wide flag declaration into
shared YAML when models may differ. A model-only shortlist adds no effort/default claim and leaves
the existing adapter's `--model <id>` invocation intact. Later effort support needs its own evidence
and scope if it changes execution.

For entry-only Kiro metadata, `defaultSelection: null` is valid. Verify that the UI initializes and
submits the first entry; do not invent a provider default or a new advanced manifest to make a
first-row test pass. Keep arbitrary custom strings verbatim through saved-value reconciliation and
execution, without inferred controls.


## Schema-2 execution data

Use exact raw IDs in `id`, `label`, and `execution.model`, with entry-only metadata unless options are evidenced and supported by the installed binding registry. Native and WSL share this CLI scope; that does not establish equal account entitlement.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
