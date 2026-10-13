# Cline / ClinePass Catalog Refresh

The scope is the full `cline-pass` channel, as recorded in
`docs/research/2026-10-14-shortlists-to-full.md`; the earlier shortlist is history in the
[Cline evidence note](../../../../docs/research/2026-09-18-cline-shortlist.md).

## Membership

- The observed CLI has no model-list command; do not guess a subcommand that could become a
  prompt, and never execute Cline to inspect it (informational flags once started npm updates).
- The probe reads the bundled `@cline/llms` `dist/models.js` `cline-pass` block as text. The
  operator accepted that build-time list as the channel list. The picker fetches the same list from
  Cline's recommended-models service, so the live picker can differ; record both versions.
- The block also appends `cline-free/*` models. The picker lists them under `Free` with "Try with
  limited usage, separate from ClinePass quota."; they are outside the channel and stay out.
- Minified files can put megabytes on one line. Find filenames with `rg -l`, then return bounded
  excerpts or selected fields. The repository's TypeScript parser can read the object literal
  without executing the bundle. Do not dump the package tree, user provider settings or sessions.
- A raw-ID-looking name may be the upstream label itself. Keep it unless an explicit display
  projection is authorized (Qwen3.8 Max is one); keep the execution ID unchanged.

## Thinking level

The picker ignores `reasoningOptions`: every reasoning model gets the same dialog, Off, Low, Medium,
High, Extra High, preselecting Medium. Each row carries that `cline.reasoning_effort` control with
default `medium`. Execution passes `--provider cline-pass --model <id> --thinking <level>`; Cline
then moves the level to the nearest effort the model advertises, so do not copy `reasoningOptions`
into the control.

## Build the scope

`scripts/catalog-scope-entries.mjs --snapshot <probe snapshot> --provider cline --label <id>=<approved name> --write <yaml>`
keeps the subscribed `cline-pass/` rows in source order with the thinking control.

## Schema-2 execution data

Set `execution.provider: cline-pass`, preserve the full observed `execution.model`, and put the
thinking level in the `cline.reasoning_effort` control. The adapter sends separate `--provider`,
`--model` and `--thinking` arguments.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Validate labels,
ordered values, defaults, custom input, and actual emitted bindings. Discovery tests must
explicitly use a `selection_mode: discovery` scope before constructing the service.
`catalogs: []` inherits factory; `models: []` empties a full scope.
