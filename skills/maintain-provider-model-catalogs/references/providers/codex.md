# Codex Catalog Refresh

Last updated: 2026-09-16

Use this path for Codex catalog maintenance with supplied `/model` and reasoning-picker evidence.
Current versions, model ids, defaults, and option sets belong in evidence/catalog data, not here.

## Start with the supplied capture

1. Reuse the operator's version, model list, per-model reasoning screens, and prior answers. Follow
   [paste intake](../paste-intake.md) once, including the observation tree and decision `assess`.
   Do not invoke Codex, authenticate, or research models when the supplied evidence is sufficient.
2. Record `(default)` in the exact model/effort context where it appears. `(current)`, a highlighted
   row, and first-row position do not establish a default. Keep defaults separate from saved user
   selections; an explicit saved selection must survive reopening a form.
3. Treat `More reasoning…` and `Advanced Reasoning` as navigation/grouping, not selectable effort
   values. Retain their hierarchy and usage warnings in the raw evidence. For an authorized flat
   Cats list, project only selectable values under the model where they were observed; do not copy
   one model's advanced values to others. Reuse the operator's approval for the same projection;
   a new dependency or unapproved loss still requires the normal scope/projection decision.
4. Use the existing normalizer to prove label-to-token mappings such as `Extra high` to `xhigh`.
   Preserve model display text exactly, including case. If only the raw id is displayed, omit a
   conflicting `label` override instead of inventing a prettified name. Check fallback rows too.
5. Establish completeness before removing rows or advancing freshness. A legacy-model launch hint
   is not evidence that those models remain visible picker entries. Keep unobserved limits with
   their prior provenance; omit unknown limits for new models.

## Decide the implementation scope early

The curated source is `config/curated-model-catalogs.yaml.example`; `providers.yaml.example`
configures provider execution and is not the model catalog. Check the effective local curated path
early (normally `~/.cats/runtime/config/curated-model-catalogs.yaml`): an override can hide changes to
the bundled example. Read only the in-scope block for comparison. Prepare its diff alongside the
repository delta, and reuse explicit local-sync authorization when present. Writing the private
file still needs that scope; back it up, preserve other providers, and keep it out of Git.

First read the relevant rows/functions below, then search affected ids and the exact bundled
filename for other consumers. Do not rediscover every provider or trace unrelated adapters.

| Surface | Existing implementation to reuse |
|---|---|
| Curated parsing | `src/core/models/curatedModelCatalog.ts`, `curatedModelCatalogNormalization.ts` |
| Runtime fallback models | `src/core/models/providerModelCatalog.ts`: `STATIC_PROVIDER_MODELS` |
| Reasoning availability/defaults | `src/core/models/providerAdvancedKnowledge.ts`: `buildCodexCliControls`, per-entry defaults |
| Public defaults | `src/core/models/providerAdvancedCatalog.ts`: `entries[].controlDefaults` |
| Execution resolution | `src/core/models/providerSelectionResolution.ts` |
| Playground labels/defaults | `src/http/ui/shared.ts`: `getAdvancedEntryControlDefaults`, `formatAdvancedDefaultLabel` |
| Playground fallback models | `src/http/ui/pages/playground.html`: `PROVIDER_MODELS`; regenerate `public/playground.html` |
| Desktop fallback/normalization | `cats-platform/src/shared/providerCatalogData.ts`, `providerCatalog.ts` |
| Desktop default selection | `cats-platform/src/design/components/providerModelFieldsSupport.ts`: `resolveEntryControlDefaults`; `useProviderTargetReconciliation.ts` waits for catalog loading |

Existing consumers already expose model-specific `controlDefaults`, mark matching options with
`(default)`, and select them when switching provider/model. Ordinary model/effort updates should
reuse this contract. Update affected data, fallback values, evidence, and regressions together;
do not rebuild the schema/UI simply because the model list changed. Expand implementation only
for a demonstrated gap or a newly observed option/dependency within authorized scope.

## Focused validation

Run commands from the owning checkout and read its instructions before changing it. Verify the
listed scripts/paths still exist; adapt if renamed instead of exploring unrelated test runners.
These are iteration checks, not replacements for required final repository/CI gates.

### Runtime

Run the four catalog tests in [catalog surfaces](../catalog-surfaces.md), plus:

```text
npx vitest run src/core/models/codexCatalogDefaults.test.ts --pool=threads --poolOptions.threads.singleThread
```

That regression table represents current picker evidence: update it for supported values,
per-model defaults, exact labels, bundled catalogs, fallback behavior, and execution resolution.
Keep unrelated inline fixtures independent of the current public model list.

When selection or Playground behavior changes, add the relevant tests:

```text
npx vitest run src/core/models/providerSelectionResolution.test.ts src/http/ui/shared.playground.test.ts --pool=threads --poolOptions.threads.singleThread
```

Use `npm run typecheck` when TypeScript/tests changed and `npm run build:ui` when editing Playground
sources. Review generated HTML with the source diff. The generated-output check inspects unstaged
HTML changes: stage reviewed output only when committing is authorized, before the final gate;
do not mistake expected uncommitted output for a generator defect or claim that check passed.

### Desktop, only when its fallback or consumer behavior changes

For catalog/selection logic, build the server once and run the focused test:
`tests/provider-selection.test.js`. For labels, also check non-selector consumers; use the shared
[Desktop iteration guidance](../catalog-surfaces.md#desktop-iteration-only-when-its-consumers-change)
for builds, mounted selector tests, label consumers, and bundle invalidation.

Run heavy cross-repository gates serially and preserve their logs. Report whether validation used
source/tests, a running development UI, or an installed Desktop build; these are distinct claims.
When publishing is authorized, distinguish enabling auto-merge from observing a completed merge.
Wait for completion when the requested outcome includes merge, branch cleanup, or updating main;
do not add that waiting phase to a request that only asks to open a PR and enable auto-merge.
