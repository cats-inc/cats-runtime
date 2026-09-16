# Cursor 2026.09.15 fixed model presets

## Scope and decisions

Refresh mode, Cursor CLI only, confirm-uncertainty policy. The owner selected six fixed
combinations for Desktop and Playground, plus custom model-string input. Separate context,
effort, reasoning, thinking, and fast controls were explicitly declined for this shortlist.

| Order | Menu label | Fixed settings |
|---|---|---|
| 1 | Cursor Grok 4.6 | Extra High Fast |
| 2 | Composer 2.5 | Fast |
| 3 | Claude Opus 5 | 300K High Thinking; Fast off |
| 4 | GPT-5.6 Sol | 272K Medium; Fast off |
| 5 | Gemini 3.8 Flash | High |
| 6 | Muse Spark 1.3 | 300K High |

The menu combines the exact model label and the approved settings with an em dash. There
are no default markers. New selections start with the first entry; saved explicit choices
remain explicit. The owner corrected `Medium6` to `Medium` and explicitly included Thinking
in the final Opus combination. Earlier proposals for adjustable effort or universal Fast-off
were superseded by these fixed combinations.

## Evidence and execution identifiers

- [Picker transcription](./fixtures/cursor-2026.09.15-d2fe57e/picker-transcription.redacted.txt):
  operator-supplied model/parameter screens. This captures the six selected families, not all
  models offered by Cursor. Original spelling/markers remain in the transcription.
- [Approved combinations](./fixtures/cursor-2026.09.15-d2fe57e/approved-presets.redacted.txt):
  final selection, order, and corrections.
- [Selected executable variants](./fixtures/cursor-2026.09.15-d2fe57e/selected-variants.redacted.json):
  account-resolved parameter definitions and exact `variantStringRepresentation` values from
  the installed CLI's model-list request, captured 2026-09-17.

The local CLI version matched `2026.09.15-d2fe57e`. Its help documents bracket overrides for
`--model`. Ordinary `--list-models` still prints legacy slugs and labels, including 1M labels
for combinations whose parameterized family offers 300K or 272K. A temporary process-local
output hook exposed only the six families' already-returned `parameterizedModels` metadata;
installed CLI files and authentication settings were not changed. No inference was run.

The chosen expressions are copied from matching server-provided variants, not assembled from
display names or inferred legacy suffixes. Gemini's token is `reasoning_effort`, Sol's is
`reasoning`, and the others use their own observed parameters. The initial capture attempted
console output, which the CLI suppressed; the second capture wrote the same metadata to a
temporary file. Only redacted model metadata is retained here.

## Implementation

The owner clarified after Playground review that commas only separated fields in the supplied
combinations. Display labels therefore join parameters with spaces; execution expressions retain
their original commas and exact values.

The curated schema supports `selection_mode: shortlist`. Such a CLI catalog is the selectable
menu on initial reads and explicit refresh, ahead of live or persisted discovery snapshots.
Refresh re-reads the curated file. Configured/current upstream models are not injected into
this menu; custom strings continue through the raw model execution path. No other catalog
is opted into shortlist mode by this change.

Each Cursor entry stores the complete parameterized expression and exposes no additional
controls. Runtime normalization preserves it, selection resolution returns it, and the adapter
passes it as one `--model` argument. Bundled YAML, Runtime fallback, Playground fallback, and
Desktop fallback contain the same six ordered combinations.

Playground now provides Cursor's custom-input action and text field. Its saved custom string
is retained across refresh/reload instead of being replaced by a similar preset. Desktop uses
its existing custom-input implementation.

The local personal override was observed at version `2026.08.11-e8db854` with 204 models.
The owner explicitly authorized replacing its Cursor section with these six combos. The file
was backed up before writing; all other provider sections were verified unchanged. Repository
examples alone do not replace an existing personal override.

## Validation

- Focused Runtime catalog, normalization, selection, adapter, discovery, and Playground tests:
  9 files, 97 tests passed. Initial sandbox attempt failed before collection with Windows
  `spawn EPERM`; the same focused command passed with child-process permission.
- `npm run typecheck` passed, including Playground generation. The final Playground change
  passed its 9-test focused retry; the isolated discovery fixture passed its 36-test file.
- Desktop: 25 selection/label tests and 43 UI/consumer tests passed; server build, test UI
  bundle, renderer TypeScript and test TypeScript checks passed.
- A temporary DOM harness executed the real Playground functions and verified seven options,
  first-preset initialization, custom-field visibility, raw-string preservation on refresh,
  and fixed-preset serialization. This was an isolated DOM check, not a running-app smoke test.
- Curated data for other providers, local override parity, Markdown references, skill mirrors,
  and final diff checks passed.
- No model inference or installed Desktop smoke test was performed.

## Maintenance feedback

The canonical Cursor skill reference now records the procedures proven here: decide fixed versus
adjustable parameters early, distinguish legacy listings from exact parameterized variants, inspect
both custom-input surfaces, preserve shortlist/custom choices through refresh, and isolate discovery
tests from personal catalogs. It also records two avoidable retries: console-suppressed metadata
capture and incomplete multiline catalog-block extraction. A future capture should write an explicit
artifact, and a local replacement must pass parsed count/tuple and unrelated-provider checks before
writing. Current model values remain in this evidence and catalog, not in the procedural reference.
