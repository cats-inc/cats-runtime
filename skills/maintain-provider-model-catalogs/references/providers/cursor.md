# Cursor Catalog Refresh

Use this reference for Cursor picker families, parameterized models, and fixed-combination
shortlists. Current model values and chosen combinations belong in the curated catalog and
evidence, not this skill. The initial implementation and capture are recorded in
`docs/research/2026-09-17-cursor-fixed-presets.md` in cats-runtime.

## Resolve the intended menu before editing

- Use the operator's latest explicit choice: adjustable model parameters or fixed combinations.
  A fixed-combination choice supersedes an earlier proposal for individual controls. Only ask
  about settings still unspecified; do not ask the operator to repeat already resolved choices.
- Keep model spelling/case and each parameter's display label. For fixed combinations, record
  the approved label composition separately from the source model label. Selection markers and
  internal variant-default metadata do not authorize a Cats `(default)` marker.
- Inspect the actual consumer path before proposing UI work. Desktop and Playground can render
  generic controls, but that does not prove Cursor execution supports those controls. Conversely,
  Desktop custom input does not prove that a particular Playground form has a custom-input action.

## Obtain exact execution expressions efficiently

1. Reuse sufficient supplied picker evidence and retained mappings first. Inspect local override
   version/count early so it cannot silently hide the bundled update.
2. When execution identifiers are missing, read installed CLI help and its read-only model list.
   A legacy slug or list label can imply a different context than the parameterized picker.
   Do not derive family ids or parameter tokens from display text or copy one model's tokens to
   another: visible Effort/Reasoning can map to different parameter keys.
3. Prefer account-resolved parameterized model metadata. Match the complete approved parameter
   tuple against a returned variant, then retain its exact `variantStringRepresentation`.
   Retain the supporting `parameterDefinitions` and `parameterValues` in redacted evidence.
   Do not treat a legacy slug as proof of a particular context window.
4. If public output omits metadata the CLI already fetched, first inspect the current listing
   implementation. A bounded, process-local, read-only output capture can expose that reply;
   preserve installed files and CLI-owned authentication. Do not add paid inference, login flows,
   credential extraction, or a separate authentication implementation. Check the hook matches
   current source and fail closed when it does not. Chunk names and offsets are version-specific,
   not reusable contracts. Prefer an explicit redacted output file: the CLI can suppress console
   logging. Stop collecting once the selected combinations are mapped.

## Preserve the shortlist through the complete path

- Curated `selection_mode: shortlist` makes the menu authoritative on initial reads and refresh,
  ahead of persisted/live discovery and configured current models. It is not a declaration that
  the upstream provider offers only those entries. Do not opt unrelated providers into this mode.
- For fixed combinations, store the exact parameterized expression as the curated `name` and
  supply the approved display label separately. Inspect `normalizeCursorCuratedModelId`; do not
  lose brackets or overrides through a label-derived normalization path.
- Keep curated YAML, Runtime fallback, Playground fallback, and Desktop fallback aligned. Model
  selection must resolve to the complete expression and pass it as one `--model` argument.
- Preserve raw custom strings and saved out-of-shortlist explicit Cursor selections. A nearest-model
  reconciliation must not replace a custom context/effort choice with a similar preset. Verify
  initial selection, custom-field visibility, refresh/reload, and serialized execution values.
- Prepare a provider-only local override diff before requesting any missing outside-project
  authorization. Locate the complete catalog block; a multiline regex `$` can stop at the first
  line instead of end-of-file. Before writing, parse the proposed file, check the selected tuples
  and count, compare every other provider, and back up the original. Keep unrelated bytes intact.

## Focused verification

Follow [catalog surfaces](../catalog-surfaces.md). `src/core/models/cursorPresets.test.ts` covers
bundled shortlist order, stale discovery snapshots, refresh, selection resolution, and adapter
argv. Include the affected Playground form/helper and Desktop fallback/selection tests.

Discovery tests that intentionally exercise an unrestricted list need their own temporary curated
fixture and environment. They must not depend on a developer's personal override or the evolving
bundled shortlist. Reuse passing checks for unchanged inputs; a docs/skill follow-up does not
invalidate product validation. Distinguish argv/DOM checks from installed-app or live-model tests.
