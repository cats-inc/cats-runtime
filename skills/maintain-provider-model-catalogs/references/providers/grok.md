# Grok Catalog Refresh

Use this path for Grok model-picker and per-model effort maintenance. Current versions, models,
option sets, and counts belong in catalog data and evidence. The retained implementation evidence
is `docs/research/2026-09-17-grok-model-picker-refresh.md` in cats-runtime.

## Use the supplied picker and retained mappings

- Follow [picker intake](../paste-intake.md) for screenshots/transcription when TUI text cannot be
  copied. Keep each effort menu attached to its confirmed model; `(active)` indicates the session
  selection, not a provider default. Keep the original marker in evidence while excluding it from
  display labels when requested.
- Inspect retained Grok manifest fixtures for model IDs and effort `value`/`label` pairs. Existing
  `normalizeGrokEffortValue` in `src/core/models/providerAdvancedKnowledge.ts` accepts evidenced
  picker labels and emits separate raw tokens. Reuse unchanged proven mappings instead of
  launching the CLI again; retain their original version/date and verify the evidence path exists.
  A new unmapped value remains an evidence gap.
- The CLI takes model and effort separately (`--model` and `--reasoning-effort`). Do not derive
  model IDs from display text or expand per-model menus to the wider flag vocabulary in help.
- When the operator explicitly requests first-item initialization without default claims, remove
  superseded Cats defaults within that authorization. If older manifest evidence declared a
  default, record this as a Cats display/selection policy; absence of a marker in a newer screenshot
  does not prove the upstream default changed. Without that explicit direction, follow the shared
  conflict/default confirmation rules.
- Preserve each model's effort description in its own option notes. The existing shared enum
  deduplicates raw values and keeps the first description; do not overwrite the source notes when
  two models word the same effort differently.

Compare the effective local Grok override early; it can hide the bundled refresh. Prepare the
provider-only replacement, reuse any explicit synchronization authorization, and back up before
writing. Follow [evidence and scope](../evidence-and-scope.md) for unresolved authorization.

## Inspect the existing consumer path

| Concern | Surface |
|---|---|
| Curated data and static fallback | `config/curated-model-catalogs.yaml.example`, `src/core/models/providerModelCatalog.ts` |
| Effort labels, raw tokens, model applicability | `src/core/models/providerAdvancedKnowledge.ts` |
| Selection and CLI arguments | `src/core/models/providerSelectionResolution.ts`, `src/backends/cli/providers/grok.ts` |
| Playground | `src/http/ui/shared.ts`, `src/http/ui/pages/playground.html` |
| Desktop model fallback | `cats-platform/src/shared/providerCatalogData.ts` |
| Desktop displayed and persisted effort | `cats-platform/src/design/components/providerModelFieldsSupport.ts`, `ProviderModelFieldControls.tsx`, `useProviderModelFieldActions.ts` in the same directory |

For a first-item policy, the initial displayed effort must also reach `modelSelection.controls`
and the adapter argument. Grok can otherwise silently use its own configured effort. Preserve
explicit saved choices, reset on model switches, and keep initialization out of `controlDefaults`
or default-label decoration. Reuse the existing helpers before adding another defaulting path.

## Focused verification

Follow [catalog surfaces](../catalog-surfaces.md) for validation scheduling and Desktop commands.
Use `src/core/models/grokModelCatalog.test.ts` for the bundled labels, per-model token mapping,
supported combinations and adapter argv without spawning a paid turn. Add the affected Playground
helper and Desktop catalog/default-selector tests; assert emitted initial controls as well as DOM
values. Keep independent historical/default fixtures intact. Source tests, a dev Playground check,
an installed Desktop check, and live CLI execution are separate validation claims.
