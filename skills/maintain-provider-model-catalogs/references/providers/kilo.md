# Kilo Catalog Refresh

The scope is the `kilo` gateway list, which the operator chose over the picker on 2026-10-14, as
recorded in `docs/research/2026-10-14-shortlists-to-full.md`; the earlier shortlist is history in
`docs/research/2026-09-18-kilo-shortlist.md`. Changing that basis again needs the operator.

## Membership, labels and order

- Membership and labels: `kilo models kilo --verbose --pure` (the probe's Kilo source), with each
  row's name, release date and variants. Read `src/backends/cli/kilo/models.ts` before relying on
  parsed ids. `--refresh` may need account or network access; obtain authorization first.
- Order and coverage: the `/models` dialog. In 7.8.8 it shows Recent, Recommended (including the
  Auto routing rows) and the gateway section. Recommended rows are removed from the gateway
  section; Recent rows stay in it. Recommended plus gateway was exactly the listed set. The catalog
  uses Recommended then gateway and leaves out Recent, which is per user.
- The gateway section is not sorted by release date like OpenCode's, so use the captured order.
- A temporary promotion such as `(50% off)` can appear in a name in the picker and the list. Keep
  the name without it and acknowledge the observed label with `observed` pinned.

## Walk the picker on Windows

[`Capture-KiloPicker.ps1`](../../scripts/Capture-KiloPicker.ps1) walks an open, inspected `/models`
dialog in a maximized, uniquely titled Windows Terminal window. Launch hygiene follows
[interactive capture](../interactive-capture.md); start Kilo through `node <npm prefix>/node_modules/@kilocode/cli/bin/kilo`
because Windows Terminal cannot start the `.cmd` shim, and set `MSYS_NO_PATHCONV=1` when typing
`/models` from Git Bash.

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/scripts/Capture-KiloPicker.ps1 `
  -UiHelperPath $desktopUiHelper -WindowTitle $captureWindowTitle `
  -OutputDirectory $newEmptyEvidenceDirectory -StatePath "$env:USERPROFILE\.local\state\kilo\model.json"
```

- The dialog marks the highlighted row only in its detail panel. The walk presses Up until the
  list jumps to its bottom, Down once to wrap to the first row, then Down until the list jumps back
  to the top, stitching each scroll position's lines into one list and checking every row against
  the panel's name. It sends only Up and Down and leaves the dialog on its first row.
- `rows.json` has each row's section, label, badges (`May train`) and the current-model dot;
  `summary.json` has section counts and labels that appear in several sections.
- The model state file must keep its pre-capture SHA-256 before every key.
- Offline test: `powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-KiloPicker.ps1`.

## Variant

`/variants` opens `Select variant`: `Default` and then the model's variants under their raw names
(7.8.8: `Default`, `instant`, `thinking`). Each row with variants gets a `kilo.variant` control with
Default first and no default claim. The native HTTP prompt takes a top-level `variant`; the adapter
sends nothing for `default`. `kilo run --thinking` only displays thinking and does not choose a
variant.

## Build the scope

```text
node skills/maintain-provider-model-catalogs/scripts/catalog-scope-entries.mjs --snapshot <probe snapshot> \
  --provider kilo --order <capture>/rows.json [--alias '<picker label>=<listed name>'] --write <yaml>
```

It orders the listed rows by the captured Recommended and gateway sections, fails if any row is
missing or extra, and adds the Variant controls.

## Schema-2 execution data

Put the observed qualified model in `id` and `execution.model` and the listed name in `label`.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Validate labels,
ordered values, defaults, custom input, and actual emitted bindings. Discovery tests must
explicitly use a `selection_mode: discovery` scope before constructing the service.
`catalogs: []` inherits factory; `models: []` empties a full scope.
