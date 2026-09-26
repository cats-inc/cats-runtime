# Auggie 0.36.0 full catalog from an agent-operated picker capture

Date: 2026-09-27 (UTC+8). Mode: refresh. Interaction policy: confirm uncertainty.
Scope: the `auggie` / `cli` catalog scope, changed from a six-row shortlist to
`selection_mode: full`. No binding or adapter code changed.

## Request and decisions

The operator asked for the Auggie catalog to become a full list like Claude and Codex, with the
agent operating the interactive `auggie` `/model` picker through maintain-provider-model-catalogs
and desktop-ui-automation. The request also asked for screenshot count, resolution and token
usage, and for a PR with auto squash merge and branch cleanup. Constraints set by the operator:

- The picker defines membership and order. `auggie model list --json` supplies IDs; ask on any
  mismatch. IDs are used verbatim, including opaque ones. Labels are the picker text.
- Prism routing rows and `(500K)` context variants are kept when the picker lists them.
- `default` only where the picker marks one. `defaultModelId` goes into notes only.
- Effort must come from each model in the picker, not from global `--reasoning-effort` help.
- Do not press Enter in the model list; hash and back up the settings file first.
- Do not update Auggie, submit tasks or inferences, or log in or out. BYOK is out of scope.
- Capture on Windows native only.

Questions asked, and the operator's answers:

1. **Enter probe** (after the arrow-only walk found no effort anywhere). Answer: allow Enter on each
   row to check for an effort step, press Escape without confirming an effort, and keep the
   settings hash guard, stopping on any change.
2. **Effort** (after the probe found no effort step). Answer: follow the rule. No
   `auggie.reasoning_effort` binding and no adapter change. Record the JSON `effortLevels` and the
   global `--reasoning-effort` flag only in notes and this research note.

Policy: [SPEC-028](../specs/SPEC-028-provider-model-catalog-maintenance-skill.md) now lists Auggie
in the full-catalog group (2026-09-27 Auggie amendment). The
[2026-09-23 shortlist note](./2026-09-23-auggie-shortlist.md) is superseded.

## Capture

- **Environment:** `auggie --version` read `0.36.0 (commit 7c61e5bb)` before and after the capture.
  Native Windows 11, 2560×1306 desktop, in a dedicated Windows Terminal window titled
  `cats-auggie-capture`, launched 2026-09-27 05:25 (UTC+8).
- **Launch:** from an empty private directory, after removing `TERM`, `TERM_PROGRAM`, `CI`,
  `NO_COLOR`, pager variables and every `AUGMENT*`/`AUGGIE*` variable. The UI appeared at once, so
  no Defender check was needed. The workspace-indexing prompt was dismissed with Escape, which skips
  indexing for this session only and saves no choice.
- **Method:** Windows UI Automation visible text through the platform helper `WindowsUi.ps1`.
  Every key was sent only after the expected screen was confirmed, and the agent then waited for a
  changed, stable screen.
  - Picker keys: Up, Down, one Right (no visible effect) and, after authorization, Enter on each row.
  - Slash commands: `/model` and `/exit`. The `?` shortcut list and the slash-command list were
    read to look for effort, reasoning or thinking commands; there are none.
  - Escape: the indexing prompt, and once to close a picker that had opened with `model` typed into
    its search box. No effort step appeared, so Escape was never needed there.
  - Two Ctrl+C presses did not exit Auggie; `/exit` did.
- **Completeness:**
  - Six rows are visible, with `↑ N more` / `↓ N more` counters.
  - Down from row 1 to 34 and Up back to 1 visited the same 34 rows in the same order.
  - `model list --json` returned 34 models. Each picker label equals exactly one `displayName`.
    The picker order differs from the JSON order; the catalog follows the picker.
  - All six former shortlist IDs are present.
- **Enter probe:** for each row the probe reopened `/model`, moved to the row and pressed Enter.
  All 34 closed the picker with `Using model: <label>`. None showed an effort step.
- **Settings file:** `~/.augment/settings.json` (154 bytes) had SHA-256
  `86319C45203E3FBDC34306C165F09B17EAFC0AFDD4C432E6DBC1E58763AE398D` before launch, before every
  key, after exit, and now. A private backup was kept; no restore was needed. Enter changes only
  the session model.
- **Side effects:** Auggie wrote two small session files under `~/.augment/sessions/` (the
  preflight and the interactive capture, 426 and 418 bytes). No prompt was submitted.
- **Identity:** the startup screen shows the account email, so raw screenshots stay private. The
  committed fixture has no account data.
- **Evidence:**
  [model-picker.agent-capture.redacted.txt](./fixtures/auggie-0.36.0/model-picker.agent-capture.redacted.txt),
  a redacted projection of the walked rows, JSON IDs and effort levels, and probe results. Raw step
  captures, screenshots and scripts stay private, outside Git.

| # | Picker label | JSON ID | Cost | JSON effortLevels |
| --- | --- | --- | --- | --- |
| 1–3 | GPT-6 Astra, GPT-6 Sol, GPT-6 Luna | `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna` | $$$$, $$, $ | Astra low–max; Sol, Luna none–max |
| 4–6 | Claude Fable 5.1, Claude Opus 5.5, Claude Sonnet 5 | `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-0` | $$$$, $$$, $$ | low–max |
| 7 | Grok 4.7 | `grok-4-7` | $$ | low, medium, high |
| 8 | Gemini 3.8 Flash | `gemini-3-8-flash` | $ | low, medium, high, dynamic |
| 9–11 | Kimi K3, GLM 5.3 Flash, DeepSeek V4.1 Flash | `kimi-k3`, `glm-5-3`, `deepseek-4-1-flash` | $$, $, $ | low, high, max |
| 12–13 | Prism (Claude + GPT), Prism (GPT) `[New] [Auto]` | `butler_a`, `butler_b` | $$$ | none listed |
| 14 | Gemini 3.1 Pro | `gemini-3-1-pro-preview` | $$ | low, medium, high, dynamic |
| 15–17 | GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna | `gpt-5-6-sol`, `gpt-5-6-terra`, `gpt-5-6-luna` | $$$, $$, $ | none–max |
| 18 | GPT-5.5 | `gpt-5-5` | $$$ | none–xhigh |
| 19 | Claude Opus 5 | `claude-opus-5` | $$$ | low–max |
| 20 | **Opus 4.8 (default)** | `claude-opus-4-8` | $$$ | low–max |
| 21–23 | Opus 4.7, Opus 4.7 (500K), Claude Fable 5 | `claude-opus-4-7`, `claude-opus-4-7-500k`, `claude-fable-5` | $$$, $$$, $$$$ | low–max |
| 24–25 | Opus 4.6, Opus 4.6 (500K) | `claude-opus-4-6`, `claude-opus-4-6-500k` | $$$ | low, medium, high, max |
| 26 | Claude Sonnet 5 (500K) | `claude-sonnet-5-0-500k` | $$ | low–max |
| 27–28 | Sonnet 4.6, Sonnet 4.6 (500K) | `claude-sonnet-4-6`, `claude-sonnet-4-6-500k` | $$ | low, medium, high, max |
| 29 | Haiku 4.5 | `claude-haiku-4-5` | $ | none listed |
| 30–31 | Grok 4.5, Grok 4.6 | `grok-4-5`, `grok-4-6` | $$ | low, medium, high |
| 32 | Gemini 3.7 Flash | `gemini-3-7-flash` | $ | low, medium, high, dynamic |
| 33–34 | Kimi K2.7 Code, GLM 5.2 | `kimi-k2p7`, `glm-5-2` | $ | none listed |

`low–max` is low, medium, high, xhigh, max; `none–max` adds none first.

- **Defaults:** Opus 4.8 is the only row with a `(default)` suffix, and its JSON row is the only one
  with `isDefault: true`. The session model, Claude Opus 5.5, carried `(current)`; that is a session
  selection, not a default. The envelope `defaultModelId` is
  `claude-sonnet-5-0-high-c4-p2-agent`, which names no picker row; it is recorded in notes only.
- **Effort:** the picker shows no effort for any row, Left and Right do nothing, no slash command
  or shortcut covers effort, reasoning or thinking, and Enter opens no effort step. JSON lists
  `effortLevels` for 29 of 34 models, and `--help` lists a global `--reasoning-effort`. Neither is
  per-model picker evidence, so both stay in notes.
- **Context:** the `(500K)` labels are picker text. No context limits were added.

## Catalog delta

- The scope changes from `shortlist` to `full`, and `last_updated` to 2026-09-27; `cli_version`
  stays 0.36.0. The list was complete (34/34).
- Twenty-eight rows are new. The six former shortlist rows keep their IDs and labels, and the two
  that had `capabilityTags: [reasoning]` keep them.
- Each row's notes hold the picker description, cost tier, badges and JSON `effortLevels`. Every
  row has `controls: []`. `claude-opus-4-8` has `default: true` and keeps `Opus 4.8 (default)` as
  a source name.
- No code changed: no binding, adapter, Playground or Desktop model table.

### Behavior change

The shortlist had no default, so Desktop, Playground and runtime resolution started at its first
row, GPT-6 Astra. The full list declares the picker default, so they now start at Opus 4.8
(`--model claude-opus-4-8`). Every row still sends only `--model`; Auggie's own effort setting
applies. Existing sessions keep their recorded bindings. Custom model strings are unchanged.

Not verified by a turn: whether each ID runs a task. A turn would consume credits. The Enter probe
shows only that the interactive CLI accepts every row as a session model.

## WSL scope

The capture covers only this Windows native installation and account. The same `auggie` / `cli`
scope also serves Auggie under WSL. That does not show that a WSL installation, its version or its
account can see the same models. Capture WSL separately before relying on it there.

## Validation

- `npm run catalog:generate` and `npm run catalog:check` passed, including the code/data boundary
  check. The generated digest is `4d8c2d2683eccbad4e486232966083c6b73de564d729412d9bf3f931f24dcb87`.
- **Updated tests:**
  - `tests/catalog-runtime.test.ts`: 34 rows in picker order, Opus 4.8 as the only default and
    explicit initial selection, no controls on any row, and `--model <id>` without
    `--reasoning-effort` for `butler_b`, `claude-opus-4-8`, `gemini-3-1-pro-preview` and `kimi-k2p7`.
  - `src/http/ui/shared.playground.test.ts`: Auggie left the six-row shortlist group. A new test
    covers the 34 rows, Opus 4.8 initialization, no effort menu on any row and custom input.
- **Focused runs (all passed):**
  - Vitest, 129 tests in 8 files: `tests/catalog-data.test.ts`, `tests/catalog-runtime.test.ts`,
    `src/http/ui/shared.playground.test.ts`, `src/core/models/providerModelCatalog.test.ts`,
    `src/backends/cli/providers/auggie.test.ts`, `src/http/auggieManagement.test.ts`,
    `tests/ui-shared.test.ts` and `tests/agent-skill-sync.test.ts`.
  - `node --test` on `measure-agent-usage` and `normalize-picker-paste`: 13 passed.
  - `Test-AuggiePicker.ps1` 5/5, `Test-ClaudePicker.ps1` 9/9, `Test-CodexPicker.ps1` 5/5 and
    `Test-KiroPicker.ps1` 9/9 (see [Capture lessons](#capture-lessons) for its module path).
  - `tsc --noEmit -p tsconfig.json` passed.
  - Runtime `Sync-AgentSkills.ps1` and workspace `Sync-WorkspaceSkills.ps1` passed.
  - The full suite is left to the PR's `release-preflight` CI.
- **Old-ID consumers:** the historical `config/catalog-schema1-migration.json`,
  `tests/fixtures/catalog-schema1/*` and earlier research notes stay as they are. So does
  cats-platform's frozen `tests/fixtures/catalogs-v2.json` and the tests that read it. No Platform
  change is part of this PR. There is no personal catalog override on this machine.

## Cost

- **Images:** 12 window captures were saved, all 1129×635 on the 2560×1306 desktop. Five were sent
  to the model (the prompt, the opened picker, the first Down, a partial render and the first Enter
  probe), about 956 input tokens each at width × height / 750, or about 4,800 in total. Everything
  else was read as UI Automation text.
- **Host session:** Augment Agent, model `claude-opus-5-5`, one user turn. Its session file
  records per-call token usage, so the new Auggie reader in `measure-agent-usage.mjs` measured it.
  Phase starts are `at:` times. Sub-agents were not used (0 credits).

| Phase | Calls | Uncached input | Cache write | Cache read | Output |
| --- | --- | --- | --- | --- | --- |
| Preparation: skills, preflight, `model list --json`, settings hash | 14 | 32 | 178,202 | 1,117,387 | 7,412 |
| Capture: launch to `/exit` and hash check (includes the first question) | 48 | 96 | 218,155 | 5,958,764 | 31,140 |
| Second question to the operator | 2 | 4 | 1,717 | 323,982 | 888 |
| Catalog, tests and the Auggie usage reader | 51 | 104 | 436,293 | 8,246,991 | 34,561 |
| Reusable capture helper and its tests | 21 | 44 | 114,857 | 2,641,192 | 29,703 |
| Docs and validation (until measured) | 40 | 80 | 92,890 | 7,085,932 | 27,447 |
| **Total, 05:22–06:23 (UTC+8)** | 176 | 360 | 1,042,114 | 25,374,248 | 131,151 |

The commit, PR, merge and cleanup calls came after this measurement and are not included. Cache
reads are about 95% of all tokens: every call re-reads the whole context, so context size, not the
five screenshots, sets the cost. This repeats the skill's advice to use a fresh session per
provider refresh.

## Capture tooling

Temporary scripts written for this run, all in the private evidence directory:

| Temporary script | Purpose | Rerunnable? | Kept? |
| --- | --- | --- | --- |
| `Start-CleanAuggie.ps1` | Removes terminal and `AUGMENT*`/`AUGGIE*` variables and starts `auggie` in the private work directory | Yes, on this machine | No. The platform `Start-WindowsUiTerminal` plus the documented launch hygiene covers it, and the variables to clear depend on the agent host. |
| `ui.ps1` | Dot-sources `WindowsUi.ps1` and resolves the window by this run's title | Only with this title and path | No. A two-line loader; the kept helper takes `-UiHelperPath` and `-WindowTitle`. |
| `Walk-AuggieList.ps1` | Up/Down walk recording each highlighted row | Only with `ui.ps1` and this settings path | Merged into `Capture-AuggiePicker.ps1` |
| `Probe-AuggieEnter.ps1` | Reopens `/model` per row, presses Enter and checks `Using model:` | No: hard-codes GPT-6 Astra as the first row | Merged into `Capture-AuggiePicker.ps1 -ProbeSelection` |
| `gen-auggie-scope.tmp.mjs` | Splices the 34-row YAML scope and writes the redacted fixture | No: holds this version's notes and tag choices | No. Model rows belong in YAML, not code. |

Ad hoc commands (hashing, snapshots, key sends, session queries) were not saved as scripts.

Kept in this PR:

| Repository file | Why |
| --- | --- |
| `scripts/Capture-AuggiePicker.ps1` | A version-independent walk with screen-read edges, a direction check, the optional authorized Enter probe and a settings hash guard before every key. Parameters replace this run's window title, helper path and settings path. |
| `tests/Test-AuggiePicker.ps1` | Offline guards with a simulated picker: row, suffix, badge and description parsing; Up/Down only without `-ProbeSelection`; direct selection per row; stops on an effort step, a settings change, a count mismatch (before any Enter), a direction mismatch, a closed picker and reused evidence. |
| `scripts/measure-agent-usage.mjs` Auggie reader and its test | Reads `~/.augment/sessions/<id>.json` per-call token usage with `at:`, `text:` and `turn:` phases. |

The helper was validated offline: 5/5 checks, and its parser read the private walk screens for
rows 1, 13 and 34 correctly (label, badges, cost, description and both edges). The next Auggie
refresh will be its first native run.

## Capture lessons

These are now in the [Auggie reference](../../skills/maintain-provider-model-catalogs/references/providers/auggie.md)
and the [interactive capture reference](../../skills/maintain-provider-model-catalogs/references/interactive-capture.md):

- The slash-command echo renders as `/ model`. Type `/`, wait for `Enter command`, type `model`,
  then wait for the suggestion line before Enter.
- A step can read a partial render with no highlight. Wait for two identical reads that contain a
  highlight before recording a row.
- `(current)` is the session model; only `(default)` is default evidence.
- `/exit` ends Auggie; Ctrl+C did not.
- PowerShell variable names are case-insensitive: a screen-text `$t` overwrote the target `$T`,
  and a `$screenshots` counter collided with the `-Screenshots` parameter. No key was sent in the
  first case; the second was caught by the offline test.
- `Test-KiroPicker.ps1` failed here with `Get-FileHash` not found, because `powershell.exe`
  inherited the agent host's `PSModulePath`. With the Windows PowerShell module path it passed
  9/9. The Auggie helper and test hash through .NET and do not depend on it.

