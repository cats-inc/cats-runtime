# OpenCode Catalog Refresh

The scope is the full `opencode-go` channel, as recorded in
`docs/research/2026-10-14-shortlists-to-full.md`; the earlier shortlist is history in
`docs/research/2026-09-18-opencode-shortlist.md`. Other OpenCode providers stay custom strings.

## Membership, labels and order

- The probe's `opencode models <basis channel> --verbose --pure` source is the channel's complete
  list, with each row's name, status, release date and variants. Run it with
  `OPENCODE_DISABLE_AUTOUPDATE=true`; no prompt, session, login or inference is needed.
- Cats executes OpenCode models as `provider/model`. A display name alone does not identify the
  provider namespace; identical names can appear under both `opencode` and `opencode-go`. If a
  name maps to two namespaces, ask which one to use. A matching name does not establish options,
  defaults or entitlements on another machine.
- The model dialog (installed 1.19.0, read from the binary) hides `deprecated` rows and orders a
  provider section by release date, newest first, then by title. Without a search it moves
  Favorites and Recent rows out of their provider section, so a picker reading must include those
  sections. The listing command is unaffected.

## Variant

After a model with variants is chosen, the dialog asks `Select variant`: `Default`, which sends no
variant, then the model's variants under their raw names. The catalog mirrors it as an
`opencode.variant` control with Default first and no default claim; models without variants have
no control. The adapter sends the value as the native prompt's top-level `variant` and sends
nothing for `default`.

## Build the scope

`scripts/catalog-scope-entries.mjs --snapshot <probe snapshot> --provider opencode --write <yaml>`
builds the rows in the dialog's order with their Variant controls and keeps existing tags and
spellings.

## Project the verbose output

`scripts/project-opencode-models.mjs` parses the ID-line-plus-object pairs from a file or stdin,
starts no CLI, and prints only `id`, `name` and `providerID`:

```text
OPENCODE_DISABLE_AUTOUPDATE=true opencode models --verbose --pure > verbose.txt
node scripts/project-opencode-models.mjs --input verbose.txt --ids opencode-go/a,opencode-go/b --match <text>
```

`--ids` reports each row as found or `missing: true`; without it every row is printed. `--match`
lists rows whose ID or name contains the text, which is how to check that a missing row was
withdrawn rather than renamed. Keep `verbose.txt` private: it is raw output. Commit only projected
rows to a `.redacted.json` fixture. The output is not one JSON document; do not pass it whole to
`JSON.parse`.

## Schema-2 execution data

Use the observed provider-qualified token in `id` and `execution.model`, the exact listed name in
`label`, and the `opencode.variant` control for variants.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Validate labels,
ordered values, defaults, custom input, and actual emitted bindings. Discovery tests must
explicitly use a `selection_mode: discovery` scope before constructing the service.
`catalogs: []` inherits factory; `models: []` empties a full scope.
