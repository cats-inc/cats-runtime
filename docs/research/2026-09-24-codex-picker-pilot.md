# Codex 0.156.1 desktop picker pilot

## Result and scope

The operator requested a live Codex `/model` pilot, then authorized completion of the catalog and
canonical skill updates. Mode: refresh; interaction policy: confirm uncertainty. The existing
approval to flatten Codex's advanced reasoning submenu remains applicable. No removals, personal
override changes, execution/schema changes, version bumps or publication are part of this refresh.

All seven visible models, seven reasoning menus and six advanced menus were observed on
2026-09-24 in a native Windows 11/RDP session using Windows Terminal and Codex CLI 0.156.1.
Visible UI Automation text was checked against window screenshots and `codex debug models`.
Scope is this CLI account; availability on other accounts and platforms was not tested.

| Display label | Execution ID | Efforts in order | Explicit effort default |
| --- | --- | --- | --- |
| GPT-6-Astra | gpt-6-astra | low, medium, high, xhigh, max, ultra | medium |
| GPT-6-Sol | gpt-6-sol | low, medium, high, xhigh, max, ultra | medium |
| GPT-6-Luna | gpt-6-luna | low, medium, high, xhigh, max | medium |
| GPT-5.6-Sol | gpt-5.6-sol | low, medium, high, xhigh, max, ultra | low |
| GPT-5.6-Terra | gpt-5.6-terra | low, medium, high, xhigh, max, ultra | medium |
| GPT-5.6-Luna | gpt-5.6-luna | low, medium, high, xhigh, max | medium |
| GPT-5.5 | gpt-5.5 | low, medium, high, xhigh | medium |

Astra is explicitly the default model. The seven visible labels now use the casing above;
there is no invented title-case mapping in product code. New Sol/Luna entries and refreshed
labels/descriptions/limits live in the sole schema-2 YAML factory and generated JSON. Each model
retains its own options. Cats adds the standard lowercase `(default)` status suffix where explicit.

## Evidence and interpretation

- [Picker excerpts](fixtures/codex-0.156.1/picker.redacted.txt) preserve all 14 menu paths, order,
  default/current markers, footer actions, per-model More reasoning branches and usage warnings.
- [Machine catalog projection](fixtures/codex-0.156.1/machine-catalog.redacted.json) retains only
  catalog fields. Seven `visibility=list` entries match the picker. `gpt-reserve` and
  `codex-auto-review` are hidden and do not become Cats rows.
- Machine effort tokens/defaults agree with the menus. All seven CLI context values are 272000;
  these do not establish OpenAI API limits. Advanced menu descriptions differ from machine
  descriptions; display data uses the actual picker wording.
- Existing capability tags and migration `source_names` retain earlier provenance. New models
  receive no guessed capability tags. Frozen schema-1 conversion evidence stays unchanged.
- Normalized observation/decision artifacts report 58 observed paths, no missing expected paths,
  four ready change groups and no confirmation gates. No model row was removed.

## Native capture lessons

The current model marker masks the default marker on the same row. Starting a separate invocation
with `--model gpt-6-sol` exposed `GPT-6-Astra (default)` while preserving the saved configuration.
The first alternate model tried displayed a retirement notice whose Escape key meant confirm;
its documented Ctrl+C quit action was used instead. No final effort was confirmed, and no inference
prompt was submitted. The actual config hash matched before launch and after final cleanup.

Startup can create ordinary CLI session/cache records. No claim is made that the entire profile
was untouched. Cleanup closed only owned pilot windows; the shared Windows Terminal process remained.

The exploratory stage saved 44 images and the initial reusable-helper traversal saved 28, all
1129 × 635 window captures (not the 2560 × 1306 desktop). This was setup/debug overhead, not a
routine collection requirement. The final helper defaults to 14 key-menu images for this observed
seven-model flow, with intermediate text captures and an optional text-only mode. Stored image
counts do not measure images supplied to an agent or subscription/token usage.

## Reusable workflow and validation

Runtime owns the [capture procedure](../../skills/maintain-provider-model-catalogs/references/interactive-capture.md)
and Codex traversal helper. Platform owns [native window/pane/input handling](../../../cats-platform/skills/desktop-ui-automation/references/windows.md).
Both canonical packages are synchronized into local agent discovery mirrors; they are not product
runtime skills or an automatic scheduled refresh job.

- `catalog:generate` and `catalog:check`: passed, including code/data boundary checks.
- Catalog data/runtime suites: 48 tests passed. The frozen migration test now compares frozen
  mappings instead of the changing current factory, so a refresh does not rewrite legacy choices.
- Paste normalizer: six tests passed with `--test-isolation=none`; default test-runner child spawning
  was blocked by this Windows sandbox. Vitest used the authorized executor because esbuild needed
  a child process. Tests use isolated fixtures, not personal Runtime settings.
- Windows input guards: six simulated cases passed, including valid input and no injection on
  split panes, lost focus, replaced surfaces or changed selected rows.
- Capture fixture: five cases passed for key/all/no screenshot policies, rejection of a config
  change at final verification and preservation of a nonempty evidence directory. No final effort
  confirmation or native input is allowed by that fixture.
- The initial helper completed a native full traversal. Revised pane guards also completed the
  real exit sequence. Capture modes and config-failure handling are fixture-tested separately.
  Partial native-input cleanup is reviewed best-effort code, not an induced native or fixture
  failure. The completed collection is not repeated simply to edit YAML or documentation.
- The two affected basic/advanced HTTP tests and `tsc --noEmit -p tsconfig.json` passed.
- Both skill packages passed the official `quick_validate.py` check. Its PyYAML dependency was
  isolated in the private task directory, not added to product/global dependencies. Repository
  mirrors and parent workspace Codex/Claude mirrors were synchronized; the workspace content and
  ownership check passed. Independent review found the catalog consistent with both fixtures.

This is source/data and helper validation, not a new installed Desktop/Playground acceptance run.
