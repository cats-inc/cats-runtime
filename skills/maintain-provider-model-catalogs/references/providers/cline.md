# Cline / ClinePass Catalog Refresh

Reuse the implemented shortlist and execution path. Current selected models, versions and
operator decisions belong in the
[Cline evidence note](../../../../docs/research/2026-09-18-cline-shortlist.md), not this guide.

## Resolve missing mappings without expanding the menu

- Use the supplied picker and retained mappings first. The observed CLI has no model-list
  command; do not guess a subcommand that could become a prompt. Check installed package/help
  evidence only when a missing mapping or changed invocation requires it.
- For static mapping evidence, locate the installed `cline` package and its bundled
  `@cline/llms` dependency. Record both versions. The observed `dist/models.js` contains a
  provider-keyed catalog; extract only the selected `cline-pass` block's IDs and names using
  bounded text or an AST parser. The repository's TypeScript parser can inspect object literals
  without executing the bundle. This static source may be a superset of account availability.
- Minified files can put megabytes on one line. Find filenames with `rg -l`, then return bounded
  excerpts or selected fields; `rg -n` with a small match count does not bound output size.
  Do not dump the package tree, full catalog, user provider settings or session histories.
- Static model IDs/capability enums do not override the operator's effort choices. In particular,
  a generic or another provider's `reasoningOptions` list does not redefine ClinePass's picker.
- A raw-ID-looking display name may be the upstream label itself. Preserve it until an explicit
  display projection is authorized. Retain the original in evidence and keep the execution ID
  unchanged; one approved friendly name is not permission to prettify other rows.


## Schema-2 execution data

Set `execution.provider: cline-pass`, preserve the full observed `execution.model`, and put approved thinking in `execution.fixed_controls.cline.reasoning_effort`. The adapter sends separate `--provider`, `--model`, `--thinking` arguments.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
