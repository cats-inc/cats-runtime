# Auggie 0.36.0 shortlist

## Scope and evidence

Mode: refresh. Interaction policy: confirm uncertainty. The operator supplied the complete
intended six-entry Cats shortlist on 2026-09-23; this is not the full upstream inventory.
Preserve its order and labels. No model default, effort or context controls were supplied.
Initialize the first entry without adding a default marker, and retain custom model input.

The installed Windows npm package `@augmentcode/auggie` reports 0.36.0. Informational help
confirmed `--model <id>`, `model list`, and its `--json` option. One successful
`auggie model list --json` invocation resolved all six IDs. The output envelope included
`models`, `registryAvailable`, and `defaultModelId`; only selected public model fields were
retained. Neither the account identity nor registry/default values were inspected or retained.
Availability on other accounts/machines and per-model options remain unverified.

| Exact supplied display label | Observed executable ID |
|---|---|
| GPT-6 Astra | `gpt-6-astra` |
| GPT-5.6 Sol | `gpt-5-6-sol` |
| Claude Fable 5.1 | `claude-fable-5-1` |
| Claude Opus 5.5 | `claude-opus-5-5` |
| Grok 4.7 | `grok-4-7` |
| Prism (Claude + GPT) | `butler_a` |

Evidence: [operator text](./fixtures/auggie-0.36.0/operator.redacted.txt) and
[selected CLI metadata projection](./fixtures/auggie-0.36.0/model-id-mappings.redacted.json).
The latter is an extracted public-field projection, not verbatim full CLI output.
The paste normalizer, ordered observation summary and decision assessment passed; no
mapping/default/completeness question remained. Global `--reasoning-effort` help does not
establish effort menus and did not add controls. No projection loss was identified.

## Implementation

- Add a typed `selection_mode: shortlist` Auggie block in the curated example.
- Reuse verbatim-ID normalization, curated static routing and the entry-only advanced overlay.
  No new discovery mechanism, schema, advanced manifest or adapter transport is needed.
- Replace three old fallback rows in Runtime, Playground and Desktop with these six.
- Connect Auggie to Playground's existing custom field, serialization and saved-value paths.
- Existing `AuggieProvider` passes all six IDs unchanged as `--model`, including `butler_a`.
  Independent old alias tests remain valid for custom-input behavior and are retained.
- The personal document lacked Auggie and takes whole-file precedence over the example.
  The operator explicitly authorized a provider-only addition after reviewing the prepared
  delta. It was backed up, written and read back; all other providers compare equal.

No authentication, inference, persistent sessions or user product records were created.
The operator subsequently authorized PRs, auto-merge and branch cleanup. Release and package
version changes remain outside this catalog update.

## Validation

- `npm run build:ui`: passed; generated Playground HTML matches source exactly.
- Direct `tsc --noEmit -p tsconfig.json`: passed after the UI build.
- Focused Vitest run: 97 passed across curated loading/normalization, model catalog,
  advanced knowledge, Auggie adapter/integrated catalog and Playground (7 files, 5.73 seconds).
  Log: `%TEMP%/cats-auggie-runtime-tests.log`.
- After correcting the isolated test executable name to `auggie`, only that file was rerun:
  2 passed (2.70 seconds), `%TEMP%/cats-auggie-runtime-final.log`.
- Loader emits no warnings; curated and static fallback paths retain the six IDs through
  refresh. All six structured selections produce the exact `--model` argument, and custom
  strings retain their case. Playground tests cover six-plus-custom rendering, first selection,
  serialization and saved custom values.
- Repo-wide old-label/example-consumer searches found independent historical alias and inline
  fixtures; these remain unchanged. No stale Auggie picker table remains.
- Skill frontmatter and 50 local Markdown links validated using the installed Node/YAML.
  All 23 canonical files match Runtime/workspace Codex and Claude mirrors; workspace sync check
  passes. The member sync helper has no `-WhatIf`; its ordinary scoped sync succeeded.
- Both repository diff whitespace checks passed.

These are focused checks, not full CI, installed Desktop visual verification or live inference.
Desktop's 85 passing tests and compiler/build checks are recorded in the
[Desktop note](../../../cats-platform/docs/research/2026-09-23-auggie-shortlist.md).

## Maintenance feedback

Added a provider reference to the canonical maintenance skill: use sufficient retained mappings
first, then the CLI's bounded JSON model enumeration when IDs are missing. Preserve opaque IDs;
do not slugify display names, infer effort from global help or add dynamic discovery to a
shortlist refresh. Reuse the entry-only rollout checks and both UI consumers.
