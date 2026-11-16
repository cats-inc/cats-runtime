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

- [x] Types (`src/catalogs/types.ts`): `CatalogBasis` gains `id?`, `region?: { id, label }` and
      `plan.id?`.
- [x] Schema (`src/catalogs/schema.ts`):
  - [x] `validateBasis` accepts the new fields and requires one of channel, region or plan.
  - [x] `catalogScopeKey` appends the basis id when present. An id-less scope keeps today's key,
        so `origins`, `affectedScopes` and accepted snapshots of single-basis targets do not
        change.
  - [x] `validateCatalogDocument`: unique keys, unique ids within a target, and an id-less
        scope only as its target's first (FR-2).
- [x] Resolver (`src/catalogs/resolver.ts`, `store.ts`):
  - [x] `mergeCatalogDocuments`: an override with an id replaces that basis or appends a new
        one after the factory bases; an id-less override replaces the target's first basis
        whatever its id (FR-3).
  - [x] `createCatalogSnapshot` and `readAcceptedCatalog` use the per-basis keys, so the
        last-accepted snapshot of a multi-basis document still loads.
  - [x] `findCatalogScope` takes an optional `basisId` (absent means the first basis); add a
        lister that returns a target's bases in data order. Keep both on the `./catalogs`
        package boundary.
  - [x] `CatalogStore.reload` reports affected scopes per basis.
- [x] Capabilities: `catalogCapabilities.catalogBases = true`. Update the pinned set in
      `tests/fixtures/catalog-soft-patch-smoke.mjs`; `tests/catalog-cli.test.ts` pins a fake
      older set on purpose and stays.
- [x] Advanced catalog (`src/core/models/providerAdvancedKnowledge.ts`,
      `providerModelCatalog.ts`, `providerAdvancedCatalog.ts`):
  - [x] Thread `basisId` through `getAdvancedCatalog`, `getImmediateAdvancedCatalog`, the
        knowledge builders and `tryManagedCatalog`, so the basic rows and the scope rows that
        `buildProviderAdvancedKnowledge` joins come from the same basis.
  - [x] The result gains `basisId` and `bases[]` when a target has two or more bases, and
        `capture { cliVersion, lastUpdated }` always. Runtime composes `bases[].label` from the
        channel, region and plan labels joined with ` · `. `detected` is `false` until Phase 2.
  - [x] `manifestId` includes the basis id.
  - [x] The basic model list stays on the first basis.
- [x] HTTP and MCP:
  - [x] `GET /providers/:provider/models/advanced` accepts `basis`; an unknown id returns 400
        with `code: catalog_basis_unknown` (`src/http/routes/providers.ts`).
  - [x] The MCP `providerAdvancedModels` tool gains a `basis` input (`src/mcp/tools.ts`, whose
        schema has `additionalProperties: false`). No test covers the MCP input yet; it builds
        the same query the HTTP route tests use.
  - [x] `docs/api.md` documents both.
- [x] Selection and sessions (`src/core/models/providerSelectionResolution.ts`,
      `src/http/routes/sessions.ts`):
  - [x] `ProviderModelSelection` and `ProviderModelResolution` gain `basisId`. Parse,
        canonicalize and compare keep it, so reuse conflicts see a change of basis.
  - [x] `resolveProviderSelection` resolves entries and controls in the selected basis, or the
        first one; an unknown `basisId` is rejected like an unknown entry, never switched.
  - [x] The plain-string path (`resolveRequestedSessionModelState`) searches the bases in data
        order and records the matching `basisId`.
  - [x] Create, reuse, fork and the Cursor native path record `basisId` in the binding; resume
        keeps it (the registry stores bindings without a schema). Tested for create and reuse;
        fork and the Cursor native path go through the same resolver and have no own test.
  - [x] `defaultSelection` of a non-first basis carries its `basisId`.
- [x] Tests:
  - [x] `tests/catalog-data.test.ts`: validation, merge, origins and accepted snapshot for a
        two-basis target.
  - [x] `tests/catalog-runtime.test.ts`: advanced result with `basis`, unknown basis,
        resolution, plain strings, unchanged spawned arguments for a plan or region basis, and
        Bot/MCP requests without `basisId` on the first basis (scenarios 3, 6 and 8).
  - [x] `src/core/models/providerSelectionResolution.test.ts`: `basisId` parse and compare.

## Phase 2: Runtime detection, Playground and sign-in report (after Phase 1)

- [x] Detection: a per-provider detector that reads only CLI output or non-secret markers
      (ADR-038). Initial source: Kimi's `region` file in `KIMI_CODE_HOME`, matched against
      `basis.region.id`. It marks at most one `bases[].detected`. Test that detection still
      reports `global` when `credentials/` cannot be read (scenario 7).
      Done in `src/backends/cli/kimi/catalogBasis.ts` and
      `src/core/models/catalogBasisDetection.ts`: only a local native Kimi instance is read, and
      only for a target with two or more bases; several matches mark none. The scenario 7 test
      puts a file where `credentials/` belongs; a second test records that the region file is
      the only path read.
- [x] Playground (`src/http/ui/shared.ts`, `pages/playground.html`):
  - [x] Fix `normalizeAdvancedCatalog`, which drops `basis` today, so the live page never shows
        the information icon. Keep `basis`, `basisId`, `bases` and `capture`. The dashboard
        (`index.html`) shares the normalizer. The fields are added only when the Runtime sends
        them, so the pinned shape in `tests/ui-shared.test.ts` did not change.
  - [x] Key the advanced catalogs by provider and basis, and fetch with `basis`. The first basis
        stays in `PROVIDER_ADVANCED_CATALOGS`; `PROVIDER_BASIS_CATALOGS` holds the others,
        fetched together on load so changing the select needs no wait.
  - [x] A "List basis" select before the Model select, shown only for two or more bases. A new
        agent starts on the detected basis when its list loaded, otherwise the first; there is
        no added option. A selection without `basisId` stays on the first basis even when that
        basis has an id. A basis whose list failed to load stays as a disabled option. Changing
        the basis keeps the entry and controls when the new list has the entry, otherwise takes
        that list's default. A saved `basisId` that is not listed, or whose list did not load,
        stays selected as a disabled option (an unlisted one labeled `<id> (unavailable)`) with
        a notice, and the card sends the saved selection back unchanged, so Runtime answers
        `catalog_basis_unknown` if the basis is gone. It is never turned into a plain string
        that Runtime would look up in another basis. Each provider's basis lists are replaced
        only after all of them are fetched again.
        Checked live on 2026-11-16 with headless Chromium against an isolated Runtime with a
        two-basis Kimi override and a `region` file reading `mainland-cn`, including a reload whose
        `?basis=mainland-cn` fetch failed and the next one that succeeded.
  - [x] `describeCatalogBasis` includes the region; the tooltip adds the CLI version and capture
        date from `capture`; a non-blocking hint when the chosen basis differs from the detected
        one.
  - [x] `readAgentModelState` sends `basisId`.
  - [x] Run `npm run build:ui` and commit the regenerated output. Update
        `src/http/ui/shared.playground.test.ts` and the markup pins in
        `tests/runtime-server.test.ts`.
- [x] `npm run catalog:logins` prints the detected basis where one is found: a signed-in Kimi
      result ends with `detected basis: region <token>`, read from the same marker after the
      presence check. The token, rather than a basis id, is printed because the first Kimi basis
      has no id.

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

- [x] Probe (`skills/maintain-provider-model-catalogs/scripts/`): `scopeKey`, `sameScope` and
      the scope lookups in `catalog-probe.mjs`, `compare.mjs`, `handoff.mjs`, `evidence.mjs`
      and `catalog-scope-entries.mjs` carry the basis id. The shared rules are in the new
      `catalog-probe/basis.mjs`; a report key of a non-first basis ends in `#<id>`.
  - [x] The probe compares against the detected basis, otherwise the first, and marks findings
        `basis-unconfirmed` (scenario 9); `--basis <id>` overrides both.
        - The sign-in marker (Kimi's `region` file, read with the same reader as
          `catalog:logins`) is read for every target, not only multi-basis ones. A marker that
          names a region, plan or channel the catalog records but no basis covers reports
          `basis-not-captured`; a marker on a CLI whose scopes record no such id changes nothing.
        - An unconfirmed basis makes the comparison inconclusive, so model findings are
          informational and nothing counts as confirmed; an operator finding asks to confirm the
          sign-in and validate with `--basis`. Bases on different channels never make it
          unconfirmed, because the chosen scope's channel decides what the source lists.
        - `--basis` takes `<provider>=<id>`, a bare `<id>` with one provider, and `first`. An
          unknown id fails before any CLI starts. In `validate`, a recorded basis the catalog no
          longer has is reported as `basis-missing`, never replaced by the first.
  - [x] Snapshot rows, the handoff and `config/catalog-probe-acknowledgements.json` entries
        carry an optional basis id. The snapshot keeps the request and the raw marker, so
        `validate` re-matches them; evidence fixtures record `basisId` and the marker as
        `signIn`, and a `#<id>` scope gets its own default file name.
  - [x] `catalog-scope-entries.mjs --write` needs `--basis` once a CLI has several bases, and
        refuses to write rows listed under a requested or detected sign-in into another basis.
- [x] References: the basis fields in `references/catalog-surfaces.md`, and the SPEC-045 FR-8
      rules in `SKILL.md` (a refresh names its basis and never edits another; a new basis
      needs evidence of its plan, region or channel; an identical list is noted, not added).
      `references/catalog-probe.md` gains a catalog bases section and the acknowledgement
      `basisId`; the Kimi reference notes the probe's use of the marker.
- [x] Node tests for each changed script. Checked on 2026-11-16: a real
      `probe --providers kimi` stayed clean (6/6) and recorded `region global`; a real probe of
      Pi, Copilot, OpenCode, Kilo, Cline and Goose (all with a channel or plan basis), and two
      earlier snapshots of Claude, Codex, Antigravity, Grok and Muse, gave the same verdicts,
      findings and counts with the old and the new scripts.
- [x] Sync the skill mirrors after merge (`Sync-WorkspaceSkills.ps1`), which also carries the
      Phase 2 skill changes. Done on 2026-11-16 after #236.

## Phase 5: Kimi region data (after Phases 2 and 3 merge)

- [ ] Add `basis: { region: { id: global, label: global (kimi.ai) } }` to the Kimi scope
      (SPEC-045 FR-9), regenerate the JSON and pin it in `tests/catalog-runtime.test.ts`.
- [ ] Record the region in `references/providers/kimi.md`.
- [ ] `POST /sessions` with an unknown `basisId` returns 400 with `code: catalog_basis_unknown`
      (SPEC-045 FR-5). Document it in `docs/api.md` and add a test in
      `tests/catalog-runtime.test.ts`. Desktop already maps the code; its read-back stays for
      older Runtimes.
- [ ] It must ship in the same Runtime release as Playground and Desktop region display, so it
      waits for Phases 2 and 3.

## Out of scope

Capturing any new basis (Kimi `mainland-cn`, other plans), grouping options by channel (needed
only past eight bases, SPEC-045 owner decision 3), CLI version and date in the icon on targets
without a basis (decision 5), credential-kind channels, and any release or version bump.
