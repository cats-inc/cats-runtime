# OpenCode Catalog Refresh

Use sufficient supplied labels and retained ID mappings first. Current selected models and their
evidence belong in `docs/research/2026-09-18-opencode-shortlist.md`, not in this reference.

## Resolve missing provider-qualified IDs

- Cats executes OpenCode models as `provider/model`. A display name alone does not identify the
  provider namespace; identical names can appear under both `opencode` and `opencode-go`.
- When a mapping is missing, inspect installed `opencode models --help`. In the verified 1.18.31
  capture, `opencode models --verbose --pure` returned an ID line followed by a JSON metadata
  object containing `name` and `providerID`. Use a bounded, read-only invocation with
  `OPENCODE_DISABLE_AUTOUPDATE=true`; no prompt, session, login or inference is needed.
- Parse the current output shape and retain only relevant public ID/name/provider fields. This
  is not one JSON document; do not pass the entire output directly to `JSON.parse`. Stop once
  the selected rows are mapped. The normal listing helper intentionally exposes raw IDs as labels;
  it does not replace the operator's display-name evidence.
- If multiple providers expose the same selected name, ask only which namespace to use for that
  row. Do not pick the first result or infer it from neighboring rows. A matching name/ID does
  not establish model options, defaults or entitlements on another machine.

## Apply the approved shortlist

Store the observed provider-qualified ID as `name`, the exact display text as `label`, and use
the existing `selection_mode: shortlist`. Model-list-only evidence adds no effort/context controls
or default flags. Reuse the entry-only advanced selection path and verbatim-ID normalizer.

Follow [new shortlist rollout checks](../catalog-surfaces.md#new-shortlist-rollout-checks) for
Runtime routing, both UI consumers, custom input and isolated dynamic-discovery fixtures.
The bundled `opencodeShortlist.test.ts` exercises order, refresh, configured-default exclusion
and exact model resolution. Older unrestricted-discovery fixtures remain a separate supported
configuration; they must explicitly opt out of the bundled shortlist.
