# Antigravity (agy) Catalog Refresh

Last updated: 2026-09-17

Use this path for agy model-picker and per-model effort evidence. Current model names, option sets,
and counts belong in catalog data and evidence, not this guide. The retained procedure comes from
`docs/research/2026-09-16-antigravity-model-picker-refresh.md` in cats-runtime.

## Separate picker evidence from execution evidence

1. Use a complete supplied `/model` paste and per-model effort screens without launching the CLI
   just to repeat them. Follow [paste intake](../paste-intake.md) once and reuse prior answers.
2. Record each slider's ordered selectable values under its own model. A model with explicitly no
   adjustable effort has no effort control; words such as `(Thinking)` or `(Medium)` in its model
   label do not prove an adjustable option. Preserve those labels exactly.
3. A picker family and its executable model ids are separate facts. Inspect retained `agy models`
   enumeration and `src/core/models/antigravityModelCatalog.ts` for existing mappings. Keep the
   enumeration's original version/date when newer picker evidence changes labels/options; do not
   imply raw ids were re-enumerated or live execution was verified on the new version.
4. Reuse proven mappings for unchanged combinations. A new family/effort combination without a
   proven raw id is an evidence gap, not permission to derive an id from its label or suffix.
   Obtain only the missing evidence within the operator's authorized scope.

The curated source is `config/curated-model-catalogs.yaml.example`. Compare the effective local
Antigravity override early; it can mask bundled changes. Prepare that delta alongside the tracked
one, reuse explicit local-sync authorization if present, and back up before writing only that
provider block. Follow the shared evidence/scope rules for any missing authorization.

## Reuse the existing model/effort implementation

Cats already represents picker families as entries and effort as `antigravity.effort`. The entry
id is the family's first evidenced executable id; Runtime resolves entry plus effort to the actual
execution model. Do not flatten the menu back into every execution combination, invent a family
id, or add an `--effort` flag based only on the picker.

| Concern | Existing surface to inspect |
|---|---|
| Family fallback and explicit execution-id mapping | `src/core/models/antigravityModelCatalog.ts`, imported by `providerModelCatalog.ts` |
| Curated effort/applicability and fallback controls | `src/core/models/providerAdvancedKnowledge.ts` |
| Omitted effort, request overrides, unsupported combinations | `src/core/models/providerSelectionResolution.ts` |
| Playground initialization, labels, and saved selection | `src/http/ui/shared.ts`, `src/http/ui/pages/playground.html` |
| Desktop fallback and initial effort | `cats-platform/src/shared/providerCatalogData.ts`, `src/design/components/providerModelFieldsSupport.ts` |
| Desktop effort menu | `cats-platform/src/design/components/ProviderModelFieldControls.tsx` |
| Desktop session payload | `cats-platform/src/runtime/client.ts` |

When the evidence declares no default and the operator requests first-item initialization, keep
that behavior separate from provider defaults: no curated `default`, exported `controlDefaults`,
synthetic Default option, or `(default)` suffix should be invented. Switching models initializes
the first applicable effort; reopening preserves an explicit saved selection. Revisit this only
when new evidence or operator instructions change the requirement.

Check the transport boundary when changing selection semantics. Desktop sends structured
`modelSelection` and omits the legacy top-level `model` when agy effort is explicit. Otherwise a
family entry id can conflict with the different execution id chosen by Runtime. Raw-model-only
selection and independent custom/empty curated overlays must retain their own behavior; do not
inject known-family controls/defaults into unrelated entries.

## Validate the affected path once

Use [catalog surfaces](../catalog-surfaces.md) for proportional checks and Desktop build commands.
Start with its focused catalog tests; add only the paths changed by this refresh:

- `src/core/models/antigravityModelCatalog.test.ts`: preserve every evidenced executable
  combination, resolve it to an exact recorded id, reject unsupported efforts, and check adapter
  argv construction without spawning the CLI. This does not prove live provider acceptance.
- `providerSelectionResolution.test.ts` and `src/http/ui/shared.playground.test.ts`: omitted effort,
  request overrides, first-item initialization, switching, saved values, and no default decoration.
- In `tests/runtime-server.test.ts`, select the affected Playground and
  `/providers/antigravity/models` tests (including the independent curated fixture) with `-t`
  instead of rerunning the whole HTTP suite. Regenerate UI assets when their sources changed.
- For Desktop changes, include `tests/runtime-client.test.js` for structured-selection payloads,
  plus the affected selector/default tests. Follow the shared reconciliation-wait guidance before
  simulating interactions.

Search exact former labels/ids before the final check. Desktop fallback data also feeds execution
labels, audience participants, chat participants, and new-chat drafts. Update consumers of that
fallback, while leaving independent historical/sentinel fixtures intact. A broad replacement of
`antigravity-default` would change unrelated test scenarios.

Report separately what source tests, the development Playground, an installed Desktop build, and
live CLI execution actually verified. Preserve results across commit/PR steps; do not rerun a
passing build or full suite merely because the next step is publication or branch cleanup.
