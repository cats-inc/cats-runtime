# Antigravity 1.2.3 model and effort picker

Observed: 2026-09-16. Mode: refresh. Policy: confirm uncertainty.
Scope: agy catalog, execution selection, Playground and Desktop consumers only.

## Evidence and decisions

- The operator supplied the complete seven-model `/model` menu and each model's
  effort screens for Antigravity CLI 1.2.3. Account scope is the operator's CLI;
  the paste contains no account identifiers or credentials.
- [Retained picker](./fixtures/antigravity-1.2.3/model-picker.success.redacted.txt)
  preserves labels, order, slider states, descriptions and the no-default request.
- Raw execution ids are not shown by that picker. They retain separate provenance:
  the [1.1.24 machine enumeration](./fixtures/antigravity-1.1.24/models-command.success.redacted.txt)
  captured on September 3. No CLI was launched or model turn charged during this
  refresh; current-version raw-id enumeration remains unverified.
- The supplied complete menu retains the same seven families and fourteen
  executable combinations. No model capability was removed. Ordered intake and
  decision assessment found no missing screen or unresolved mapping.
- The operator explicitly requested first-item initialization and no invented
  model/effort default markers. No selection marker is interpreted as an account
  default. Other providers retain their current behavior.

| Picker model | Effort choices, in order |
| --- | --- |
| Gemini 3.8 Flash | low, medium, high |
| Gemini 3.7 Flash | low, medium, high |
| Gemini 3.6 Flash | low, medium, high |
| Gemini 3.1 Pro | low, high |
| Claude Sonnet 4.6 (Thinking) | Not adjustable |
| Claude Opus 4.6 (Thinking) | Not adjustable |
| GPT-OSS 120B (Medium) | Not adjustable |

## Implementation

Previously Cats flattened effort into fourteen model names. The curated and
fallback menus now contain seven families, using the first effort's existing raw
id as the entry id. Existing curated `options` and advanced-control applicability
represent the separate effort axis without a schema change.

`antigravity.effort` is a session/request enum. Resolution maps the selected family
and effort to one of the explicitly recorded execution ids; for example,
`gemini-3.1-pro-low` plus `high` executes `gemini-3.1-pro-high`. There is no guessed
family id or new CLI flag. Unsupported combinations are rejected.

With no explicit effort, execution and UI use the first applicable option.
This initialization is not exported as `entries[].controlDefaults` and does not
mark a model or effort as default. Switching models resets effort; reloading a
saved explicit selection preserves it. Desktop omits its synthetic Default row
for this control. Playground selects the first option without decorating its label.

The operator separately approved the local Antigravity override update. Its
previous content was backed up, candidate and original hashes checked, the write
read back, and all other provider sections verified unchanged.

## Validation

- The operator verified the updated Cats Runtime Playground and reported it OK
  before authorizing auto-merge PRs and branch cleanup.
- Runtime typecheck and nine focused files: 104 tests passed, including schema
  loading with zero warnings, all fourteen execution ids, unsupported effort,
  request overrides, Playground output and saved selections, and CLI adapter fixtures.
- Focused HTTP checks: 3 passed (Playground, bundled agy catalog and independent
  curated catalog). CLI argv construction is also checked for every Gemini combination.
- Desktop: typecheck, server/UI-test builds and 165 focused tests passed, including
  React model/effort interaction, saved values, execution labels and session payloads.
- Initial iteration caught a type annotation issue and an empty-overlay default
  selection regression; both were corrected before the Runtime pass. Desktop's
  old sentinel assertion was updated, and DOM tests now wait for initial target
  reconciliation before interacting. The corrected combined selection suite passed.
- Tests use isolated temporary roots or in-memory DOM. No user sessions created.
- No installed Desktop binary or live model invocation was used for verification.
