# Junie five fixed combinations

> Superseded on 2026-09-26 by the [full-catalog picker capture](./2026-09-26-junie-picker-full-catalog.md).
> Junie is now a full-catalog provider with per-model effort controls.

Date: 2026-09-23 (Asia/Taipei). Mode: refresh; policy: confirm uncertainty.
Scope: Junie curated input, static fallback, fixed effort execution, Playground,
and the Desktop fallback in cats-platform. Other providers are unchanged.

## Evidence and operator decisions

- [Operator shortlist](./fixtures/junie-26.9.21/operator.redacted.txt): Junie
  26.9.21, complete intended Cats shortlist under the at-most-six-plus-custom policy,
  not the complete upstream/account inventory. Exact picker command and account
  scope were not supplied.
- [Local mapping evidence](./fixtures/junie-26.9.21/cli-mapping.redacted.txt): installed
  Windows CLI reports 26.9.21 (3294.5); informational help documents `--effort` tokens.
  Bounded shipped-JAR extraction corroborates the five names, not account entitlement.
- Operator explicitly authorized five fixed model/effort combinations and the missing
  execution support. No editable effort menu or additional values are inferred.
- Operator separately authorized replacing the personal Junie block. It was backed up
  before writing, checked against the bundled block, and all other providers compared equal.

| Literal model argument | Cats label | Fixed effort |
| --- | --- | --- |
| Gemini 3.7 Flash | Gemini 3.7 Flash — Medium (default) | medium |
| Claude Fable 5.1 | Claude Fable 5.1 — Low | low |
| Gemini 3.8 Flash | Gemini 3.8 Flash — Medium | medium |
| GPT-5.6-SOL | GPT-5.6-SOL — Low | low |
| Grok 4.6 | Grok 4.6 — Low | low |

Only Gemini 3.7 Flash was explicitly marked Default. Cats normalizes that suffix
to `(default)` while preserving model spelling and case. Fixed efforts are not
assertions of upstream effort defaults. The five supplied rows replace the old
eleven-row Cats snapshot; `last_updated` applies to this approved shortlist.

## Implementation

The existing verbatim Junie normalizer remains unchanged. The curated schema already
represents a single fixed effort per model; the advanced overlay resolves it internally
without exposing a control that clients can edit. A verified fixed-combination manifest
supplies the same mapping without a personal catalog. `JunieProvider.buildArgs`, shared
by initial and streamed/resumed turns, passes model and effort separately.

Known plain model strings receive the same fixed effort as structured selections.
Unknown custom strings retain their spelling and acquire no inferred effort or provider.
Custom input is enabled in Playground serialization and saved-selection reconciliation;
Desktop's existing custom-input path is retained. Refresh preserves the approved menu.

The old bundled-example expectations are updated. Independent historical fixtures in
model normalization, explicit inline YAML, UI envelopes and parser tests remain historical.
The obsolete version-only Junie freshness test is replaced by the new integrated shortlist
test. No credentials, live sessions or inference requests were used for validation.

## Validation

- `npm run build:ui` and direct `tsc --noEmit -p tsconfig.json`: passed.
- Seven focused catalog/normalization/advanced/adapter/Playground files: 99 distinct tests
  passed. The initial run exposed four outdated expectations (explicit false flags and
  the approved-shortlist warning path); the affected two files passed on focused retry.
- `runtime-server.test.ts`, filtered to Junie model routes and Playground: 3 passed,
  70 unrelated cases skipped. This verifies the served generated page and both catalog routes.
- Skill frontmatter and all 44 local Markdown links validated using existing Node/YAML.
  The official Python validator could not start because PyYAML is not installed; no dependency
  was installed. Canonical/member/workspace Codex and Claude mirrors are synchronized.
- Desktop consumer validation is recorded in its corresponding research note.

These are focused checks, not full CI, installed Desktop visual verification or a live paid
Junie turn. The operator subsequently authorized PRs, auto-merge and branch cleanup;
release and package version changes remain outside this catalog update.

## Maintenance feedback

Added a Junie-specific reference under the canonical maintenance skill and registered this
approved shortlist. Future refreshes reuse the literal-name/fixed-effort path instead of
rediscovering or reauthorizing existing support. Shipped-JAR inspection is conditional on a
missing mapping; it must not replace account-specific evidence or grow the operator's menu.
