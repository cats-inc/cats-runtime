# PLAN-045: Catalog basis (channel and plan)

User authorization: 2026-09-29. Implement the
[SPEC-031 basis amendment](../specs/SPEC-031-provider-catalog-data-and-local-overrides.md#amendment-2026-09-29-catalog-basis)
in Runtime and Platform, remove Pi's `[openai-codex]` label suffix, and change the frozen
Platform fixture only for the new field. No release, version bump or other catalog refresh.

## Phase 1: Runtime

- [x] Schema: add `basis` (`channel { id, label }`, `plan { label }`) to `src/catalogs/types.ts`
      and `src/catalogs/schema.ts`. Reject empty labels and a `basis` with neither field. Check
      `channel.id` against every entry's executable channel: `execution.provider` when present,
      otherwise the segment of `execution.model` before its first `/`.
- [x] Payload: carry `basis` on the advanced catalog result (`buildProviderAdvancedKnowledge`,
      `ProviderAdvancedCatalogResult`) and the read-only local host projection. The basic model
      list stays unchanged.
- [x] Data: add `basis.channel` to the Pi, Goose, Cline, OpenCode and Kilo scopes and
      `basis.plan` to Copilot. Drop Pi's `[openai-codex]` labels, keeping the old spellings in
      `source_names`. Regenerate the JSON.
- [x] Playground: an information icon beside the Model label whose tooltip comes from
      `catalog.basis`; a focusable button without `data-model-control-key`, because the form
      serializer collects those as model controls. Run `npm run build:ui` and commit the
      regenerated output. (First shipped as a disabled field in #125; replaced by the icon on
      2026-09-29.)
- [x] Tests: validation cases in `tests/catalog-data.test.ts` (AC-17); payload and unchanged
      spawned arguments in `tests/catalog-runtime.test.ts` (AC-19); rendering, absence and
      non-submission in `src/http/ui/shared.playground.test.ts` (AC-16, AC-18); Pi labels in
      `tests/runtime-server.test.ts`.
- [x] Skill: add the field to `references/catalog-surfaces.md`, the label rule to
      `references/providers/pi.md` and the plan to `references/providers/copilot.md`; sync the
      skill mirrors after merge.

Phase 1 delivered through [PR #125](https://github.com/cats-inc/cats-runtime/pull/125) and the
information-icon follow-up.

## Phase 2: Platform (after Phase 1 merges)

- [ ] Types: accept `basis` on the consumed advanced catalog (`src/shared/providerCatalog.ts`).
- [ ] Desktop selector: an information icon beside the Model label, reusing the product tooltip
      portal, with its tooltip text in `en` and `zh-TW`; focusable, nothing when `basis` is absent,
      and custom input unchanged.
- [ ] Fixture: `tests/fixtures/catalogs-v2.json` gains only `basis` in the `advanced` objects of
      Pi, Goose, Cline, OpenCode, Kilo and Copilot. No other fixture data changes; its models,
      labels and controls stay frozen. Update the comment in `tests/helpers/catalogFixture.js`
      to say so.
- [ ] Tests: the basis icon renders with its tooltip, stays absent without data and is not
      submitted with the selection (`tests/provider-model-fields.test.tsx` and neighbours).
- [ ] Packaging: Desktop builds against a Runtime revision that contains Phase 1.

## Scope and validation

Out of scope: the remaining SPEC-032 gaps (custom-model controls, cost and data-use badges,
Mode removal), any channel selector, and expanding other shortlists. Each phase uses the owning
repository's focused local checks, and full CI gates the merge.

*Last updated: 2026-09-29*
