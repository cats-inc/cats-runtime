# Copilot 1.0.85 fixed shortlist

Date: 2026-09-17

## Scope and decisions

Refresh / Copilot CLI only / confirm uncertainty. The operator supplied six selected
model rows and confirmed fixed model-plus-effort combos. Other providers are unchanged.
Context figures are informational and omitted from menu names by operator authorization.
Only GPT-5.6 Terra carries an explicit upstream model default; no effort default is claimed.

| Model | Fixed effort | Picker context | Status |
| --- | --- | --- | --- |
| GPT-5.6 Terra (default) | Medium | 400K | ID verified; implemented |
| Claude Sonnet 5 | Medium | 264K | ID verified; implemented |
| Gemini 3.8 Flash | Medium | 266K | ID and effort confirmed by session selection message |
| Grok 4.6 | Medium | 328K | ID verified; implemented |
| MAI-Code-1.1-Flash | Medium | — | Replaces Luna on 2026-09-18; ID and effort verified |
| Kimi K3 | High | — | ID verified; implemented |

Display labels preserve upstream case and append the fixed effort, for example
`GPT-5.6 Terra — Medium (default)`. No context or effort selector is shown.
The six-entry policy is a deliberate Cats shortlist, not an upstream completeness claim.
All six selected entries are implemented, in the operator's order.

## 2026-09-18 shortlist revision

Refresh / Copilot only / confirm uncertainty. The operator explicitly replaced the fifth
entry, GPT-5.6 Luna, with MAI-Code-1.1-Flash at fixed Medium and reconfirmed all six rows.
Terra remains the sole model default; custom input and the other five combinations are unchanged.
The original capture below remains historical evidence for the initial shortlist.

- [Revised operator shortlist](./fixtures/copilot-1.0.85/shortlist-2026-09-18.redacted.txt).
- [Targeted CLI metadata](./fixtures/copilot-1.0.85/mai-2026-09-18.redacted.json) confirms
  `mai-code-1.1-flash`, the exact display name and `medium`. The installed CLI is still 1.0.85;
  the bounded read used existing login without a session or prompt. The capture's UTC date is
  September 17; the operator observation date in Asia/Taipei is September 18.
- The approved combo stays fixed even though RPC also lists Low and High. The picker has no
  context figure for MAI; RPC limits remain evidence only, without introducing a context choice.
- Existing schema/normalization and fixed-effort resolution represent this revision without
  behavior changes. Runtime, Playground and Desktop fallbacks are updated together. Prior
  authorization to synchronize the personal Copilot block applies to this revision.

Revision validation:

- Six focused Runtime catalog, normalization, advanced-knowledge and Playground files:
  80 tests passed, including the new model's resolved `--model` / `--effort` arguments and
  zero catalog warnings. Runtime TypeScript and UI generation passed.
- Desktop UI test bundle, 44 focused selector/default/persistence/audience tests and
  renderer/test TypeScript checks passed for the revised shortlist.
- Repository-wide old-ID searches confirm remaining Luna entries belong to Codex, historical
  evidence or accepted raw-name normalization, not the Copilot menu.
- The personal Copilot block was backed up and synchronized with hash-checked readback. Its
  backup suffix is `.copilot-1.0.85-2026-09-17T16-22-36.952Z.bak`. Parsed comparisons confirm
  all other providers unchanged in both the bundled example and personal file.
- No installed Desktop or paid inference smoke was performed for this revision.

## Evidence

- [Supplied picker rows and confirmation](./fixtures/copilot-1.0.85/picker.redacted.txt).
- [Installed CLI models.list metadata](./fixtures/copilot-1.0.85/selected-models.redacted.json).
  The installed package and `--no-auto-update --version` report 1.0.85.
  A bounded headless/stdio `models.list` call used the CLI's existing login, created no
  session and sent no prompt. Of 14 returned models, five matched the selected names.
  Gemini was absent. The operator then supplied the explicit session message
  `Model changed from Auto to gemini-3.8-flash (medium) for this session`, which establishes
  both ID and effort. No credentials or session content were read.
- The official [SDK client](https://github.com/github/copilot-sdk/blob/main/nodejs/src/client.ts)
  provides headless/stdio startup and `models.list`. No SDK dependency was installed.
- The official [CLI changelog](https://github.com/github/copilot-cli/blob/main/changelog.md)
  records `--effort` as a shorthand for `--reasoning-effort`; the adapter is retained.

Machine-readable context limits differ from the picker figures. These observations
remain separately attributed; no selectable context tier or exact token limit is inferred.
The explicit picker marker establishes Terra's default, not discovery ordering.

## Implementation

- Curated shortlist membership governs initial load and refresh, including with old configured
  models and cached snapshots. Other providers retain their existing catalog behavior.
- In a Copilot shortlist, an option containing exactly one effort value encodes the fixed combo.
  Runtime resolves it internally and omits editable controls and public control defaults.
  Submitted overrides remain unsupported. Multi-value and non-shortlist fixtures retain their
  existing controls. Public default selections remain valid when submitted unchanged.
- Runtime, Playground and Desktop fallback labels agree. Playground includes custom input and
  preserves saved out-of-shortlist entries as custom model strings.
- Execution keeps separate `--model` and `--effort` arguments. Custom strings stay raw.

## Validation and local synchronization

- Runtime catalog, selection, Playground and Copilot adapter tests: 124 passed, eight files.
  The initial sandbox run could not start Vite's helper (EPERM); the same focused run passed
  with process execution permitted.
- Runtime TypeScript checking and UI generation passed. Copilot API route checks: two passed
  (71 unrelated tests skipped). The actual Playground functions passed an isolated DOM harness
  covering menu/custom visibility, Terra's rendered default marker, default initialization,
  custom preservation and serialization. After fixing the live-menu default label, the ten
  Playground tests and DOM harness passed again; unaffected catalog results were reused.
- Desktop selector/default/persistence/audience tests: 44 passed. Renderer/test TypeScript checks passed.
- No installed Desktop or model inference smoke performed.
- Gemini's missing discovery row was resolved using the operator's session selection message.
- The operator explicitly authorized syncing the personal Copilot override from 1.0.80/13 models
  to 1.0.85/six fixed combos. The complete diff was prepared first, parsed to verify all other
  provider data unchanged, backed up, and written only after checking the original file hash.
  Readback matched the reviewed candidate. The backup suffix is
  `.copilot-1.0.85-2026-09-17T00-21-11.721Z.bak`.
- The operator subsequently authorized PR delivery. Version bumps and publication remain out of scope.

## Skill feedback

The operator requested a procedural follow-up. The canonical maintenance skill now records:

- Prefer the proven bounded `models.list` RPC for missing IDs; the former reference's
  machine-readable-enumeration limitation led to unnecessary help/artifact investigation.
- Use a selected model's session confirmation when enumeration omits it; preserve that source
  distinction rather than recapturing the full picker or guessing the raw id.
- Reuse the existing effort alias and fixed-option projection; keep context evidence distinct
  from selectable settings and fixed effort distinct from upstream defaults.
- Verify default rendering in the Runtime-backed fixed-combo menu, not just static labels.
- Settle missing catalog data before expensive final builds. This run built and checked a
  provisional five-entry subset before Gemini was confirmed, then repeated affected validation.

This follow-up changes skill prose and research documentation only. Validation covers metadata,
local reference links, diff hygiene and equality of Runtime/workspace Codex and Claude mirrors;
it reuses the product checks above.
