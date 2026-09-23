# Kilo Catalog Evidence

Distinguish two different artifacts:

- the interactive picker, which includes Kilo routing/virtual rows and is account-facing;
- `kilo models` (and its verbose form), which enumerates the broader gateway catalog.

The gateway list is valid evidence for the runtime dynamic discovery seam, but it is not proof that
every entry appears in the interactive picker. Do not replace a picker-scoped curated section with
the gateway list unless the operator explicitly changes that catalog's scope and provenance.

Read `src/backends/cli/kilo/models.ts` and its tests before relying on parsed ids. Preserve gateway
ids separately from picker-visible labels. `--refresh` changes acquisition behavior, not evidence
priority, and may require account/network access; obtain authorization before a credentialed or
quota-bearing live call.

## Fixed variants and native execution

For an operator-selected shortlist, use gateway metadata only to fill missing ID/variant mappings.
A selected subset does not re-scope the menu to the full gateway. Preserve exact names and explicit
operator suffixes separately from raw IDs. Do not publish other discovered efforts or defaults.

- Check installed help before acquiring evidence. A bounded `kilo models <provider> --verbose --pure`
  read can expose ID/name pairs and each model's variants; retain only the relevant public fields.
- `kilo run --thinking` displays thinking blocks. It does not enable a reasoning variant.
  An observed `thinking` variant is an execution choice, separate from the model string.
- Trace the Cats execution path: Kilo uses a native HTTP session service. A CLI flag alone is not
  evidence that Cats sends the option. Verify the installed SDK/request shape; the native prompt
  uses a top-level `variant` body property. Do not start a session to inspect this contract.
- Reuse the typed single-value Variant option and fixed execution defaults for an approved combo.
  Keep those defaults out of public editable controls and provider-default labels. Entries without
  an operator-specified variant leave it unspecified; do not infer that they request thinking off.
- Cover catalog resolution through the provider and final native request body, including both
  specified and unspecified variants. Reuse shared shortlist rollout checks for UI/custom input.


## Schema-2 execution data

Put the observed qualified model in `execution.model`, fixed variant in `execution.fixed_controls.kilo.variant`. Native HTTP prompt uses a top-level `variant`; `run --thinking` only displays thinking and does not choose a variant.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.
