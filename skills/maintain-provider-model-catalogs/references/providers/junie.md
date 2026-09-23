# Junie catalog refresh

Current choices and evidence belong in the
[Junie research note](../../../../docs/research/2026-09-23-junie-shortlist.md).

## Bounded evidence

Use supplied literal names first. Only when needed, `junie --skip-update-check --help` and
`--version` are informational. Do not guess model-list commands that may become prompts.
For spelling gaps, inspect bounded `ModelOption$Specific.class` strings in the installed JAR;
static strings are a possible superset, not entitlement or menu-default evidence.


## Schema-2 execution data

Keep literal model names, spaces and case in `execution.model`. Put approved effort in `execution.fixed_controls.junie.reasoning_effort`; it is sent separately as `--effort`. New/resumed runs share this serializer; custom IDs have no inferred effort.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
