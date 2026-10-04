# Antigravity (agy) Catalog Refresh

Last updated: 2026-10-04

Use this path for agy model-picker and per-model effort evidence. Current model names, option sets,
and counts belong in catalog data and evidence, not this guide. The retained procedures come from
`docs/research/2026-09-16-antigravity-model-picker-refresh.md` and
`docs/research/2026-09-25-antigravity-model-catalog-refresh.md` in cats-runtime.

## Separate picker evidence from execution evidence

1. Use a complete supplied `/model` paste and per-model effort screens without launching the CLI
   just to repeat them. Follow [paste intake](../paste-intake.md) once and reuse prior answers.
2. Record each slider's ordered selectable values under its own model. A model with explicitly no
   adjustable effort has no effort control; words such as `(Thinking)` or `(Medium)` in its model
   label do not prove an adjustable option. Preserve those labels exactly.
3. A picker family and its executable model ids are separate facts. Inspect retained `agy models`
   enumeration and `execution.variants` in the canonical factory for existing mappings. Keep the
   enumeration's original version/date when newer picker evidence changes labels/options; do not
   imply raw ids were re-enumerated or live execution was verified on the new version.
4. Reuse proven mappings for unchanged combinations. A new family/effort combination without a
   proven raw id is an evidence gap, not permission to derive an id from its label or suffix.
   Obtain only the missing evidence within the operator's authorized scope.

The curated source is `config/curated-model-catalogs.yaml.example`. Compare the effective local
Antigravity override early; it can mask bundled changes. Prepare that delta alongside the tracked
one, reuse explicit local-sync authorization if present, and back up before writing only that
provider block. Follow the shared evidence/scope rules for any missing authorization.


## Schema-2 execution data

Use `antigravity.effort` controls and exhaustive `execution.variants` mapping each evidenced effort tuple to its exact `model`. The family entry is its first evidenced execution ID. Never manufacture `--effort` or suffixes.

Apply the [shared data workflow](../catalog-surfaces.md) and [local patch workflow](../local-soft-patch.md).
Ordinary refreshes edit the authorized factory/override scope, evidence and generated JSON only.
There are no independent Runtime, Playground or Desktop model tables to update. Existing generic
bindings require no repeated implementation authorization; a new unsupported binding is a separate
code change. Validate labels, ordered values, defaults, custom input, and actual emitted bindings.
Discovery tests must explicitly use a `selection_mode: discovery` scope before constructing the
service. `catalogs: []` inherits factory; `models: []` empties a full/shortlist scope.

## Execution environment and UI automation boundaries

1. **Windows desktop object isolation**: Under an Antigravity agent CLI session on Windows, subprocess execution runs inside an isolated sandbox Desktop (`exebox-...`), not the interactive user desktop (`WinSta0\default`). As a result:
   - UI Automation (`UIAutomationClient`) queries see 0 top-level windows.
   - Calling `Start-WindowsUiTerminal` will fail to detect window appearance and will hang waiting for the window.
   - Agents executing inside this CLI sandbox MUST NOT attempt to operate the interactive picker via `desktop-ui-automation` without a host-level executor outside that desktop boundary.
2. **Machine-readable enumeration (`agy models`)**:
   - `agy models` runs without launching a graphical terminal and outputs the current executable mapping (`<id>\t<label>`) for the installed CLI. Derive its size from the result; do not retain a fixed count in this procedure.
   - Prefer `agy models` for verifying execution IDs and model availability. Pair with operator-supplied `/model` pastes when verifying interactive UI layout and slider labels.

## Bounded Windows picker capture

The 1.2.16 picker exposes every effort label on a single slider while its model row is
highlighted. Read the visible slider; cycling each level adds no evidence when all labels are
already visible. Use [Capture-AntigravityPicker.ps1](../../scripts/Capture-AntigravityPicker.ps1)
with the platform helper, unique window title, empty output directory, actual settings path and
complete ordered `-ModelLabels` observed on the first screen. Start on its first row with empty
search. It checks every expected row, footer, focus and settings digest, records UTF-8 picker
regions using Up/Down only, then returns to the first row. It neither selects a model nor toggles
effort. Stop on a truncated/new layout; the passed labels do not establish completeness by themselves.

Use Windows PowerShell 5.1 and pass labels as an array from a wrapper script. Capture and inspect
one initial screenshot to verify text correspondence; the helper itself saves text only and
omits the account banner. Normalize the text with `normalize-picker-paste.mjs` before retention.
Hash settings before CLI startup as well as before traversal: a new workspace trust choice can
write CLI settings before the picker opens. Record that separately, and never claim startup
preservation from a traversal-only digest or restore over a concurrent writer.

Offline guard test: `powershell.exe -NoProfile -File
skills/maintain-provider-model-catalogs/tests/Test-AntigravityPicker.ps1`.
