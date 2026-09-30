# Codex 0.159.2 picker: GPT-6.1-Sol

## Result and scope

The operator requested a live Codex CLI catalog refresh with
`maintain-provider-model-catalogs` and `desktop-ui-automation`, using **confirm uncertainty**,
then validation, a PR, squash auto-merge and branch cleanup. Scope is the `codex/cli` factory.
The existing approved flattening of More reasoning remains applicable.

The complete picker now has eight models. GPT-6.1-Sol is first and explicitly `(default)`;
its reasoning default is Low. Astra remains available with Medium reasoning and loses the
factory model-default flag. GPT-6-Sol and GPT-5.6-Sol descriptions now identify them as previous
generation workhorses. No existing model was removed. Other scopes, frozen migration data,
bindings, schema, version and product code are unchanged.

## Evidence and decisions

Native capture used Windows PowerShell 5.1, Windows Terminal, UI Automation visible TextPattern
ranges and the existing guarded capture helper. Installed CLI: `codex-cli 0.159.2`. Enumeration
was read on 2026-09-30; the picker traversal ran after midnight on 2026-10-01 Asia/Taipei
(2026-09-30 UTC). The factory observation date uses the completed traversal's local date.
Scope is the existing signed-in local CLI account; other accounts and operating systems are
unverified. No inference prompt, authentication flow or final effort selection was submitted.

- [Picker fixture](fixtures/codex-0.159.2/picker.agent-capture.redacted.txt) preserves the complete
  model list, eight reasoning menus, seven advanced menus, labels, descriptions, markers,
  navigation and usage warnings. Terminal context and local paths are visibly redacted.
- [Machine projection](fixtures/codex-0.159.2/machine-catalog.redacted.json) contains only the
  observed slug, display name, visibility, reasoning tokens/defaults and CLI context values from
  `codex debug models` without `--bundled`. The eight `visibility=list` rows match the picker.
  `gpt-reserve` and `codex-auto-review` are hidden and remain outside the selectable list.
- Model and reasoning defaults come from explicit `(default)` markers. Astra's `(current)` model
  and Extra high reasoning describe the capture session only. The invocation used
  `--model gpt-6-astra`, so the new model-default marker was visible without selecting a leaf.
- GPT-6.1-Sol, Astra, GPT-6-Sol, GPT-5.6-Sol and GPT-5.6-Terra offer
  Low/Medium/High/Extra high/Max/Ultra. Both Luna models end at Max; GPT-5.5 ends at Extra high.
  GPT-6.1-Sol and GPT-5.6-Sol default to Low; every other row defaults to Medium.
- Machine tokens match each model's menu independently. All eight CLI context values are 272000;
  these are not OpenAI API context-limit claims. Advanced display descriptions use picker wording;
  the different machine descriptions remain evidence. Existing capability tags and migration
  source names retain their earlier provenance; no capabilities were guessed for the new model.
- The observation tree has 67 observed paths and no expected-path gaps. The agent-owned decision
  assessment has four ready groups, zero omitted changes and zero confirmation gates. No material
  question was needed: completeness, raw mappings and explicit defaults were directly observed.

## Desktop and settings limits

The sandbox exposed zero UIA windows. The authorized native executor exposed the desktop and
supported observation and guarded input separately. Initial foreground acquisition failed safely;
after re-observing the owned window, its UIA `SetFocus()` and the ordinary focus guard succeeded.
The helper then completed 32 text captures and 16 key-menu screenshots. It returned to the
initial highlight; Escape returned to the prompt and `/exit` closed only the owned window.

`ConfigUnchanged: true` applies to the traversal's baseline, not the whole startup lifecycle.
The prelaunch settings hash differs from the final hash. The settings file's last write was
15:59:21 UTC, after the 15:58:25 prelaunch baseline and before the 16:01 traversal; it did not
change during traversal or exit. Without a prelaunch content snapshot, the writer and exact
delta are not proven. No settings were restored or overwritten, and full startup preservation
is not claimed. This does not conflict with the observed model/effort markers and mappings.
Ordinary CLI session/cache records can be created at startup.

## Cost

18 PNGs were saved: two startup/opened-picker checks plus 16 helper key screens. Every image is
**1129 × 635 px**, a window capture including terminal chrome. Raw images remain private outside
Git. The primary agent inspected five images; the independent reviewer inspected four existing
images and saved none. Thus there were nine image inputs, including repeated views of the same
saved images. At width × height / 750, each is approximately 956 input tokens, or **8603 estimated
image input tokens** in total. This estimate is not a separate charge to add to logged input usage.

The shared `measure-agent-usage.mjs` reader measured the primary Codex session as of
2026-09-30 16:20:54 UTC and the independent reviewer as of 16:21:20 UTC, before PR creation:

| Phase | Calls | Uncached input | Cache reads | Output | Reasoning within output |
| --- | ---: | ---: | ---: | ---: | ---: |
| Preparation | 9 | 66316 | 410112 | 3137 | 388 |
| Capture | 10 | 32468 | 883072 | 5935 | 1360 |
| Catalog update and validation (in progress) | 17 | 33593 | 2146560 | 13428 | 2119 |
| Primary session subtotal at cutoff | 36 | 132377 | 3439744 | 22500 | 3867 |
| Independent review session at cutoff | 20 | 74206 | 1174144 | 7133 | 1534 |
| Combined recorded subtotal at cutoffs | 56 | 206583 | 4613888 | 29633 | 5401 |

The host recorded `gpt-6.1-sol`, zero cache-write tokens and no monetary billing figure. These are
logged usage, not an inferred subscription price. The cutoffs exclude subsequent review,
documentation, PR/CI and cleanup work. Later
totals are reported in the completion message; this capture checkpoint remains reproducible.
Repeated session-context input is substantially larger than the image estimate.

## Scripts and validation

Existing reusable helpers were used unchanged: `WindowsUi.ps1` for scoped desktop/input guards,
`Capture-CodexPicker.ps1` for bounded model/effort traversal, `normalize-picker-paste.mjs` for
normalization/tree gaps/decisions, and `measure-agent-usage.mjs` for logged usage. No new stable
procedure was needed in the skill.

Temporary scripts remain private and were intentionally left out of the PR:

| Script or inline operation | Purpose | Reuse decision |
| --- | --- | --- |
| `launch-picker.ps1` | Clear inherited agent/terminal variables and launch this owned window | This run's executable/profile paths and override; not reusable unchanged on another machine |
| `prepare-evidence.mjs` | Materialize this exact eight-row capture, reconcile it and author observation/decision artifacts | One-time 0.159.2 capture names, coverage and destination; not a supported version-independent parser |
| `verify-selection.mts` | Assert this factory's initial GPT-6.1-Sol/Low, all eight switches, six new efforts, restored Ultra and adapter argv | Point-in-time factory expectations and worktree imports; not reusable unchanged for a changed catalog |
| Inline enumeration projection | Retain only observed catalog fields; remove a locally manufactured null field before retention | This run's field projection; upstream fields must be re-inspected on a later version |
| Inline PNG inventory and usage lookup | Count saved PNGs, measure pixel dimensions and find this agent's rollout | Capture/session-specific paths; existing usage helper supplies the reusable logic |
| Reviewer's inline assertions (not saved) | Independently compare YAML/generated scope equality and machine fields | This diff's review assertions; not a reusable tool or retained script |

- `npm run catalog:generate`: passed.
- `npm run catalog:check`: passed, including generated digest and code/data boundary checks.
- Catalog data/runtime suites: **58 tests passed** in two files, with isolated profiles.
- Normalizer: **6 tests passed**, using `--test-isolation=none` in the sandbox.
- Isolated factory/adapter smoke: equal basic/advanced revisions and ordered models; initial
  GPT-6.1-Sol/Low; all eight model switches; all six new-model efforts; restored explicit Ultra;
  actual `model` and `model_reasoning_effort` argv values. No provider process was launched.
- Initial sandbox generator/check/test-child attempts failed with `spawn EPERM`; the generator
  and Vitest succeeded through the authorized native executor. The first disposable smoke fixture
  lacked a configured provider; adding its isolated native instance made the check pass.
- Exact old IDs/labels and display consumers were searched in Runtime and Platform. Remaining
  occurrences describe other authorized provider/backend scopes, frozen migration/UI fixtures or
  synthetic adapter/UI tests. They are not an independent current Codex CLI menu to rewrite.
- Independent cross-review passed with no required fixes; it independently checked every model,
  scope isolation, generated data, redaction, decision/gap artifacts and sampled screenshots.
  Required full-suite `release-preflight` CI is recorded with the PR.

This validates source catalog data and isolated execution arguments. It is not an installed
Desktop/Playground acceptance run or a package publication. The factory digest is
`bbfb0c764dd04457859f51bd5bc34c11e089ef5a45d2cc986e16a4f310e79f9c`.
