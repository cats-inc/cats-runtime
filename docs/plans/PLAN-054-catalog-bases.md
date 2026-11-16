# PLAN-054: Catalog bases per channel, region and plan

User authorization: 2026-11-16. Implement
[SPEC-045](../specs/SPEC-045-catalog-bases-per-channel-region-and-plan.md)
([ADR-056](../decisions/056-offer-one-basis-selector-over-captured-catalog-bases.md)) in Runtime,
the maintenance skill and Platform. The owner deferred capturing any new basis (SPEC-045 owner
decision 6), so no phase adds one. No release or version bump.

Each phase is one PR in its owning repository, using a worktree and squash auto-merge, with
focused local checks under the repository's Local Validation Scope. Each phase must leave an
existing single-basis catalog, override and saved selection working unchanged (SPEC-045
acceptance scenario 1).

## Phase 1: Runtime catalog contract

Data, resolution and API. No factory data changes; tests build two-basis targets from
overrides and fixtures.

- [ ] Types (`src/catalogs/types.ts`): `CatalogBasis` gains `id?`, `region?: { id, label }` and
      `plan.id?`.
- [ ] Schema (`src/catalogs/schema.ts`):
  - [ ] `validateBasis` accepts the new fields and requires one of channel, region or plan.
  - [ ] `catalogScopeKey` appends the basis id when present. An id-less scope keeps today's key,
        so `origins`, `affectedScopes` and accepted snapshots of single-basis targets do not
        change.
  - [ ] `validateCatalogDocument`: unique keys, unique ids within a target, and an id-less
        scope only as its target's first (FR-2).
- [ ] Resolver (`src/catalogs/resolver.ts`, `store.ts`):
  - [ ] `mergeCatalogDocuments`: an override with an id replaces that basis or appends a new
        one after the factory bases; an id-less override replaces the target's first basis
        whatever its id (FR-3).
  - [ ] `createCatalogSnapshot` and `readAcceptedCatalog` use the per-basis keys, so the
        last-accepted snapshot of a multi-basis document still loads.
  - [ ] `findCatalogScope` takes an optional `basisId` (absent means the first basis); add a
        lister that returns a target's bases in data order. Keep both on the `./catalogs`
        package boundary.
  - [ ] `CatalogStore.reload` reports affected scopes per basis.
- [ ] Capabilities: `catalogCapabilities.catalogBases = true`. Update the pinned sets in
      `tests/fixtures/catalog-soft-patch-smoke.mjs` and `tests/catalog-cli.test.ts`.
- [ ] Advanced catalog (`src/core/models/providerAdvancedKnowledge.ts`,
      `providerModelCatalog.ts`, `providerAdvancedCatalog.ts`):
  - [ ] Thread `basisId` through `getAdvancedCatalog`, `getImmediateAdvancedCatalog`, the
        knowledge builders and `tryManagedCatalog`, so the basic rows and the scope rows that
        `buildProviderAdvancedKnowledge` joins come from the same basis.
  - [ ] The result gains `basisId` and `bases[]` when a target has two or more bases, and
        `capture { cliVersion, lastUpdated }` always. Runtime composes `bases[].label` from the
        channel, region and plan labels joined with ` · `. `detected` is `false` until Phase 2.
  - [ ] `manifestId` includes the basis id.
  - [ ] The basic model list stays on the first basis.
- [ ] HTTP and MCP:
  - [ ] `GET /providers/:provider/models/advanced` accepts `basis`; an unknown id returns 400
        with `code: catalog_basis_unknown` (`src/http/routes/providers.ts`).
  - [ ] The MCP `providerAdvancedModels` tool gains a `basis` input (`src/mcp/tools.ts`, whose
        schema has `additionalProperties: false`).
  - [ ] `docs/api.md` documents both.
- [ ] Selection and sessions (`src/core/models/providerSelectionResolution.ts`,
      `src/http/routes/sessions.ts`):
  - [ ] `ProviderModelSelection` and `ProviderModelResolution` gain `basisId`. Parse,
        canonicalize and compare keep it, so reuse conflicts see a change of basis.
  - [ ] `resolveProviderSelection` resolves entries and controls in the selected basis, or the
        first one; an unknown `basisId` is rejected like an unknown entry, never switched.
  - [ ] The plain-string path (`resolveRequestedSessionModelState`) searches the bases in data
        order and records the matching `basisId`.
  - [ ] Create, reuse, fork and the Cursor native path record `basisId` in the binding; resume
        keeps it (the registry stores bindings without a schema).
- [ ] Tests:
  - [ ] `tests/catalog-data.test.ts`: validation, merge, origins and accepted snapshot for a
        two-basis target.
  - [ ] `tests/catalog-runtime.test.ts`: advanced result with `basis`, unknown basis,
        resolution, plain strings, unchanged spawned arguments for a plan or region basis, and
        Bot/MCP requests without `basisId` on the first basis (scenarios 3, 6 and 8).
  - [ ] `src/core/models/providerSelectionResolution.test.ts`: `basisId` parse and compare.

## Phase 2: Runtime detection, Playground and sign-in report (after Phase 1)

- [ ] Detection: a per-provider detector that reads only CLI output or non-secret markers
      (ADR-038). Initial source: Kimi's `region` file in `KIMI_CODE_HOME`, matched against
      `basis.region.id`. It marks at most one `bases[].detected`. Test that detection still
      reports `global` when `credentials/` cannot be read (scenario 7).
- [ ] Playground (`src/http/ui/shared.ts`, `pages/playground.html`):
  - [ ] Fix `normalizeAdvancedCatalog`, which drops `basis` today, so the live page never shows
        the information icon. Keep `basis`, `basisId`, `bases` and `capture`, and update the
        pinned shape in `tests/ui-shared.test.ts`. The dashboard (`index.html`) shares the
        normalizer.
  - [ ] Key `PROVIDER_ADVANCED_CATALOGS` by provider and basis, and fetch with `basis`.
  - [ ] A "List basis" select before the Model select, shown only for two or more bases. A new
        agent starts on the detected basis, otherwise the first; there is no added option.
  - [ ] `describeCatalogBasis` includes the region; the tooltip adds the CLI version and capture
        date from `capture`; a non-blocking hint when the chosen basis differs from the detected
        one.
  - [ ] `readAgentModelState` sends `basisId`.
  - [ ] Run `npm run build:ui` and commit the regenerated output. Update
        `src/http/ui/shared.playground.test.ts` and the markup pins in
        `tests/runtime-server.test.ts`.
- [ ] `npm run catalog:logins` prints the detected basis id where one is found.

## Phase 3: Platform (cats-platform; after Phase 1, display after Phase 2)

Platform keeps its own copies of these types, and every parse, clone and compare helper copies
only known fields, so `basisId` would be dropped on almost every path.

- [ ] Types (`src/shared/providerSelection.ts`, `src/shared/providerCatalog.ts`):
  - [ ] `ProviderModelSelection` and `ProviderModelResolution` gain `basisId`.
        `ProviderCatalogBasis` gains `id`, `region` and `plan.id`. The advanced catalog gains
        `basisId`, `bases` and `capture`.
  - [ ] Keep `basisId` in the clone, parse, serialize, equal and equivalent helpers,
        `createExplicitProviderModelSelection`, `classifyCatalogSelection`,
        `resolveCatalogTargetSelection` and the workspace serializer
        (`useWorkspaceExecutionTargetState.ts`). `sessionReuse.ts` counts a change of basis as
        a retarget.
  - [ ] `readCatalogBasis` keeps a region-only basis; the normalizer keeps `bases` and
        `capture`.
- [ ] Reads and caches:
  - [ ] The Runtime client, Platform route (`requestRouter.ts`, `src/server/routes/providers.ts`)
        and renderer client (`providerCatalogClient.ts`) pass `basis` through. Server and
        renderer caches and both label registries key by basis. `catalog_basis_unknown` reaches
        the client instead of the generic lookup failure.
  - [ ] Read Runtime `catalogCapabilities` (`GET /providers/catalogs`), which Platform does not
        read today, and send `basisId` only when `catalogBases` is advertised.
  - [ ] The local host projection (`src/platform/runtime/localCatalogProjection.ts`) keeps the
        basis id so informational labels of two bases do not overwrite each other.
- [ ] Desktop UI (`src/design/components/ProviderModelFields.tsx` and its hooks):
  - [ ] A "List basis" select before Model when there are two or more bases; a new selection
        starts on the detected basis, otherwise the first.
  - [ ] An unmappable saved basis keeps its value as a disabled option with a notice, like an
        unmappable entry (`savedSelectionAttention.ts` gains the kind).
  - [ ] `CatalogBasisInfo` shows the region and the capture's CLI version and date; a
        non-blocking mismatch hint.
  - [ ] New `en` and `zh-TW` strings: "List basis" (「清單依據」), region and freshness text,
        and the hint.
- [ ] Tests: `tests/provider-model-basis-info.test.tsx`, `provider-model-fields.test.tsx`,
      `provider-selection.test.js`, `provider-catalog-client.test.tsx`,
      `provider-model-label-registry.test.tsx` and `local-catalog-projection.test.js`. The frozen
      fixture `tests/fixtures/catalogs-v2.json` changes only for fields these tests need.
- [ ] Packaging: the next Desktop release's `runtime_ref` must include Phases 1, 2 and 5.

## Phase 4: Maintenance skill (after Phase 1)

- [ ] Probe (`skills/maintain-provider-model-catalogs/scripts/`): `scopeKey`, `sameScope` and
      the scope lookups in `catalog-probe.mjs`, `compare.mjs`, `handoff.mjs`, `evidence.mjs`
      and `catalog-scope-entries.mjs` carry the basis id.
  - [ ] The probe compares against the detected basis, otherwise the first, and marks findings
        `basis-unconfirmed` (scenario 9); `--basis <id>` overrides both.
  - [ ] Snapshot rows, the handoff and `config/catalog-probe-acknowledgements.json` entries
        carry an optional basis id.
- [ ] References: the basis fields in `references/catalog-surfaces.md`, and the SPEC-045 FR-8
      rules in `SKILL.md` (a refresh names its basis and never edits another; a new basis
      needs evidence of its plan, region or channel; an identical list is noted, not added).
- [ ] Node tests for each changed script; sync the skill mirrors after merge.

## Phase 5: Kimi region data (after Phases 2 and 3 merge)

- [ ] Add `basis: { region: { id: global, label: global (kimi.ai) } }` to the Kimi scope
      (SPEC-045 FR-9), regenerate the JSON and pin it in `tests/catalog-runtime.test.ts`.
- [ ] Record the region in `references/providers/kimi.md`.
- [ ] It must ship in the same Runtime release as Playground and Desktop region display, so it
      waits for Phases 2 and 3.

## Out of scope

Capturing any new basis (Kimi `mainland-cn`, other plans), grouping options by channel (needed
only past eight bases, SPEC-045 owner decision 3), CLI version and date in the icon on targets
without a basis (decision 5), credential-kind channels, and any release or version bump.
