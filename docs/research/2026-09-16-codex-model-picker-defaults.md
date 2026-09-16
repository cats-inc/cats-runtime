# Codex 0.154.0 picker and selection defaults

Observed: 2026-09-16. Mode: refresh. Interaction policy: confirm uncertainty.
Scope: Codex catalogs and directly required Runtime/Playground/Desktop default
metadata and selection behavior. No other provider catalog was refreshed.

## Evidence and confirmations

Source: operator-pasted authenticated `/model` and every model's reasoning picker,
including all four `More reasoning…` screens, reporting Codex 0.154.0.
[Redacted capture](./fixtures/codex-0.154.0/model-picker.success.redacted.txt).
No identifiers needed redaction. Account identity, other accounts' entitlements,
and the capture platform were not independently checked. No paid/model probe or
authentication action was performed.

The operator confirmed:

1. The five rows are the complete visible model list; remove gpt-5.4,
   gpt-5.4-mini, and gpt-5.3-codex-spark from Cats' visible catalogs.
2. Keep reasoning values in a single Cats list, with each model's availability
   and default. The CLI's navigation/grouping and usage warning remain in the
   capture rather than becoming a new Cats submenu.
3. Synchronize only the Codex block in the local
   `~/.cats/runtime/config/curated-model-catalogs.yaml` override with the
   confirmed 0.154.0 catalog. Preserve every other provider's data.
4. Preserve the display-name casing from the current picker in Playground and
   Desktop. Remove the older GPT-style label overrides instead of inventing
   capitalization in static mappings.

`(default)` is explicit evidence of the model/option default. `(current)` on
gpt-5.5 describes the selected session model only. The newer explicit Astra
default supersedes the older Sol default. The ordered observation tree and
decision artifact were normalized and assessed with the maintenance skill helper;
all supplied capture paths were present and all final changes were ready.

| Model | Model default | Reasoning default | Available levels |
|---|---|---|---|
| gpt-6-astra | Yes | Medium | Low, Medium, High, Extra high, Max, Ultra |
| gpt-5.6-sol | No | Low | Low, Medium, High, Extra high, Max, Ultra |
| gpt-5.6-terra | No | Medium | Low, Medium, High, Extra high, Max, Ultra |
| gpt-5.6-luna | No | Medium | Low, Medium, High, Extra high, Max |
| gpt-5.5 | No | Medium | Low, Medium, High, Extra high |

The existing Codex normalizer proves Extra high -> `xhigh`, Max -> `max`, and
Ultra -> `ultra`. The new raw model id is accepted by the curated id normalizer.
The flat projection does not generalize Ultra to Luna or Max to GPT-5.5.

The five display names now use the exact lowercase ids shown by the current
picker. The four pre-existing 272,000-token context values remain from the
2026-08-26 Codex 0.149.1 enumeration; they were not re-observed.
Astra's context/output limits are unknown and omitted. Hidden/legacy model
entitlements are unverified; the CLI explicitly advertises manual legacy model
selection, so removing visible rows does not reject legacy ids at execution.

## Implementation

- Refresh the Codex section of the bundled curated YAML, its id normalizer,
  runtime fallback model/effort catalogs, and Playground/Desktop fallback rows.
- Add optional advanced `entries[].controlDefaults`, copying the final curated
  or manifest defaults already used in execution resolution.
- Keep shared enum tokens unique and let selectors label defaults in the selected
  model's context. Explicit persisted controls override the model's defaults.
- Wait for Desktop catalogs before seeding a blank provider selection, preventing
  a temporary offline choice from overriding the loaded default.
- Update focused catalog, selection, UI, and normalization regression tests and
  API/architecture documentation in the owning repositories.

The local override was synchronized after checking that its contents had not
changed since the preview. The original was backed up in the system temporary
directory, and the replacement was applied atomically. Read-back confirmed
version 0.154.0, exactly the five model ids above, Astra as the default model,
and unchanged data outside the Codex block.

## Changed files

Paths are relative to each owning repository.

### cats-runtime

- Catalog data and resolution: `config/curated-model-catalogs.yaml.example`,
  `src/core/models/curatedModelCatalogNormalization.ts`,
  `src/core/models/providerModelCatalog.ts`,
  `src/core/models/providerAdvancedCatalog.ts`, and
  `src/core/models/providerAdvancedKnowledge.ts`.
- Playground: `src/http/ui/shared.ts`, `src/http/ui/pages/playground.html`,
  and generated `public/playground.html`.
- Tests: `src/core/models/codexCatalogDefaults.test.ts`,
  `src/core/models/curatedModelCatalog.test.ts`,
  `src/core/models/curatedModelCatalogNormalization.test.ts`,
  `src/core/models/providerAdvancedKnowledge.test.ts`,
  `src/core/models/providerModelCatalog.test.ts`,
  `src/http/ui/shared.playground.test.ts`, and `tests/runtime-server.test.ts`.
- Documentation and evidence: `docs/README.md`, `docs/api.md`,
  `docs/architecture.md`, `docs/research/README.md`, this note, and the
  linked redacted capture.

### cats-platform

- Catalog data and metadata: `src/shared/providerCatalogData.ts` and
  `src/shared/providerCatalog.ts`.
- Desktop selection and labels:
  `src/design/components/providerModelFieldsSupport.ts` and
  `src/design/components/useProviderTargetReconciliation.ts`.
- Tests: `tests/provider-model-defaults.test.tsx`,
  `tests/provider-model-fields.test.tsx`,
  `tests/provider-model-fields-label-persist.test.tsx`, and
  `tests/provider-selection.test.js`.
- API documentation: `docs/api.md`.

## Validation

- Runtime: 83 tests passed across seven focused catalog, normalization,
  selection-resolution, and Playground test files. The bundled catalog and
  missing-bundle fallback both produce the exact five models, per-model
  defaults, and supported reasoning levels.
- Runtime HTTP: 27 model-catalog endpoint tests passed; 46 unrelated tests in
  the same file were excluded by the test-name filter. Assertions include
  per-entry defaults for a non-default model and unchanged provider contracts
  apart from the additive metadata.
- Runtime: `npm run typecheck` passed, including `npm run build:ui`. All three
  source/public HTML pairs were compared byte-for-byte and matched. The generated
  UI artifact test also passed in the subsequent full-suite run after staging
  the generated page.
- Runtime full `npm test`: 2,152 passed, 10 skipped, and nine tests timed out in
  four unchanged package/worktree/bootstrap test files. One timeout also left a
  Windows temporary-directory cleanup permission error. All four files passed
  when rerun without the concurrent Desktop build. That repeat also covered
  the full runtime-server test file and both refreshed catalog tests: seven
  files and 122 tests passed, including exact source-cased Codex display names.
- Desktop: 17 provider-selection tests and 39 UI tests passed. UI tests used
  `npm run build:test-ui` and the repository's Node test runner. Mounted tests
  cover waiting for catalogs when switching providers, model-specific default
  labels and values, resetting defaults when switching models, and preserving
  an explicit saved reasoning choice when reopening.
- Desktop: application and test TypeScript checks passed; `npm run build:server`
  and `npm run build:test-ui` passed.
- Both repositories passed `git diff --check`. Independent read-only review
  found no remaining production correctness issues after the selector-test and
  reconciliation dependency corrections.
- The maintenance helper found no missing observation paths and permitted all
  confirmed changes. The local override was read back and compared structurally
  to verify that non-Codex data was unchanged.

The first Desktop full run exposed a failure in the new mounted picker test;
the same test passed with all UI test modules loaded and only that case selected.
Its full-suite follow-up is tracked in the companion Desktop PR. A packaged
Desktop smoke test was not performed. The read-only request to the local Runtime
on port 3110 could not connect, so the running-service response was not verified.
The local catalog data is updated; UI and API code changes require running the
updated source or rebuilding the installed application.
