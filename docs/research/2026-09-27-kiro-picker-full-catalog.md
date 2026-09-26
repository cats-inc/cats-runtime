# Kiro 2.24.1 full catalog from an agent-operated picker capture

Date: 2026-09-27 (UTC+8). Mode: refresh. Interaction policy: confirm uncertainty.
Scope: the `kiro` / `cli` catalog scope, changed from a six-row shortlist to
`selection_mode: full`, plus a new `kiro.reasoning_effort` binding that the Kiro adapter sends as
`--effort`. The operator authorized the binding for this change.

## Request and decisions

The operator asked for the Kiro catalog to become a full list like Claude and Codex. The evidence
was to come from the agent operating the interactive `kiro-cli chat` `/model` picker, using
maintain-provider-model-catalogs with desktop-ui-automation. The request also asked for a report
of screenshot count, resolution and token usage, and for a PR with auto squash merge and branch
cleanup. Constraints set by the operator:

- Browse only; do not press Enter in the picker.
- Do not update Kiro, submit tasks, log in or out, or change Kiro settings.
- Capture on Windows native only.

Questions asked after the capture, and the operator's answers (2026-09-27 02:50):

1. **auto.** Include it as row 1, in picker order, without `default: true`. The picker's `[active]`
   marks only the current selection. `--list-models` reports `default_model: "auto"`; that is
   recorded in notes as reference and is not a catalog default. The 2026-09-18 shortlist had
   dropped auto; that was a shortlist choice, and the full list follows the picker.
2. **Effort binding.** Add `kiro.reasoning_effort` only to the ten rows whose picker shows effort.
   The other rows keep `controls: []`. The operator's earlier "every model has effort" meant each
   model's own values, not that all twenty rows must have effort. Tests must show that rows without
   effort send no `--effort` and that auto sends `--model auto`.
3. **No effort default.** Accepted as a behavior change, as for Junie. See
   [Behavior change](#behavior-change).
4. **Thinking.** Not represented in the catalog; recorded in notes only (see Capture).

Policy: [SPEC-028](../specs/SPEC-028-provider-model-catalog-maintenance-skill.md) now lists Kiro in
the full-catalog group (2026-09-27 amendment). The
[2026-09-18 shortlist note](./2026-09-18-kiro-shortlist.md) is superseded.

## Capture

- **Environment:** `kiro-cli --version` read `kiro-cli-chat 2.24.1` before the capture and was not
  updated during it. The capture ran on native Windows 11 (RDP session 2, `WinSta0\Default`,
  2560×1306 desktop) in a dedicated Windows Terminal window titled `Cats Kiro capture 20260927`.
- **Launch:** the agent launched `kiro-cli chat` with no arguments from an empty private
  directory. It first cleared the inherited agent and terminal variables: `KIRO_*`,
  `AWS_EXECUTION_ENV` and `JSC_*`. `TERM`, `CI`, `NO_COLOR` and pager variables were already
  absent. The UI appeared at once, so the Defender check was not needed and no detection was
  involved.
- **Method:** Windows UI Automation visible text through the platform helper `WindowsUi.ps1`.
  Every key was sent only after the expected screen and focused surface were confirmed, and the
  agent then waited for a changed screen.
  - Keys sent: `/model` + Enter and `/quit` + Enter (slash commands). In the picker: Up, Down, Tab,
    Left, Right and one Escape. Enter was never sent in the picker, and no prompt or task was
    submitted.
  - The helper's key set lacks Tab, so a private wrapper sent Tab/Left/Right behind the same
    focus/text/surface guards.
- **Completeness:**
  - The list shows 8 rows with a `(+N more)` counter that counts down to none.
  - Down from row 0 to 19 and Up back to 0 visited the same 20 rows in the same order.
  - The order and raw IDs equal `kiro-cli chat --list-models` exactly; there was no mismatch to
    raise.
  - All six former shortlist IDs are present. No row was removed.
- **Identity:** the picker shows only raw IDs, so `id`, `label` and `execution.model` are the same
  verbatim strings. No account identifier, email or organization appeared.
- **Evidence:**
  [model-picker.agent-capture.redacted.txt](./fixtures/kiro-2.24.1/model-picker.agent-capture.redacted.txt).
  Raw step captures, screenshots and scripts stay private, outside Git.

Each row has a settings panel (Tab switches panels, ←→ toggles). Effort values are listed in
linear order. Unset rows first show `default`, which leaves the ring on the first Right and never
returns, so it is not a selectable value.

| # | ID | Credits | Effort | Thinking |
| --- | --- | --- | --- | --- |
| 1 | auto | 1.00x | n/a | n/a |
| 2 | claude-opus-5.5 | 2.00x | low, medium, high, xhigh, max | Always on |
| 3 | claude-opus-5 | 2.20x | low, medium, high, xhigh, max | on/off |
| 4 | claude-sonnet-5 | 1.30x | low, medium, high, xhigh, max | on/off |
| 5 | claude-opus-4.8 | 2.20x | low, medium, high, xhigh, max | on/off |
| 6 | gpt-5.6-sol | 4.40x | none, low, medium, high, xhigh, max | n/a |
| 7 | gpt-5.6-terra | 2.20x | none, low, medium, high, xhigh, max | n/a |
| 8 | gpt-5.6-luna | 1.10x | none, low, medium, high, xhigh, max | n/a |
| 9 | claude-opus-4.7 | 2.20x | low, medium, high, xhigh, max | on/off |
| 10 | claude-opus-4.6 | 2.20x | low, medium, high, max | on/off |
| 11 | claude-sonnet-4.6 | 1.30x | low, medium, high, max | on/off |
| 12–20 | claude-opus-4.5, claude-sonnet-4.5, claude-sonnet-4, claude-haiku-4.5, deepseek-3.2, minimax-m2.5, minimax-m2.1, glm-5, qwen3-coder-next | 0.05x–2.20x | n/a | n/a |

- **No defaults are marked.**
  - No effort value carries a default marker.
  - claude-opus-4.7 displayed `xhigh`, and claude-opus-4.6 and claude-sonnet-4.6 displayed `high`,
    with no saved setting behind them and no marker.
  - claude-opus-5.5 displayed the saved `xhigh` from `cli.json`.
- **Global help is not per-model evidence.** `kiro-cli chat --help` lists
  `(e.g. low, medium, high, xhigh, max)`. The picker shows that `none` exists for the GPT rows
  and that `xhigh` is absent for claude-opus-4.6 and claude-sonnet-4.6.
- **Thinking.** Turning thinking off makes effort read `n/a  Not available while thinking is off`.
  `kiro-cli chat --help` has no thinking argument, so the adapter cannot pass it. The axis is only
  recorded in the catalog notes.
- **Context limits** come from `--list-models --format json-pretty` `context_window_tokens`.
  Descriptions and credit rates are the picker text.

### Settings written without Enter

Every ←→ in the settings panel immediately rewrote `~/.kiro/settings/cli.json` under
`chat.modelDefaults.<id>`:

- Claude rows: `output_config.effort`, plus `thinking.type: adaptive` once thinking is on.
- GPT rows: `reasoning.effort`.

Nothing was confirmed with Enter. The effort rings could not be read without toggling, so the
agent:

1. hashed the file before launch: SHA-256 `4C87129F3C18E5AC62AC407262DA88E09ACB722E5E4B5B3F45F7D871534E30D7`,
   123 bytes, one entry (claude-opus-5.5 effort xhigh);
2. kept a private backup copy;
3. cycled each ring back to its starting value;
4. after Kiro exited normally (exit 0), confirmed that no other writer had changed the file since
   the last toggle;
5. restored the backup byte for byte. The final hash equals the pre-launch hash.

One mid-capture restore was overwritten by the next toggle. That is expected; only the final
restore counts. The active model stayed `auto` throughout. Kiro also wrote an ordinary session
record for the capture chat, which had no prompt.

## Catalog delta

- The scope changes from `shortlist` to `full`, `cli_version` from 2.22.0 to 2.24.1, and
  `last_updated` to 2026-09-27. The last change is justified because the list was complete (20/20).
- Fourteen rows are new: auto, claude-opus-5.5, claude-opus-4.8, claude-opus-4.7, claude-opus-4.6,
  claude-sonnet-4.6, claude-opus-4.5, claude-sonnet-4.5, claude-sonnet-4, deepseek-3.2,
  minimax-m2.5, minimax-m2.1, glm-5 and qwen3-coder-next.
- The six retained rows keep their IDs and capability tags. They gain picker notes and context
  limits. Four of them gain effort controls; claude-haiku-4.5 keeps `controls: []`.
- **Code:**
  - `src/catalogs/bindings.ts` adds `kiro.reasoning_effort` (Kiro CLI, string).
  - `src/backends/cli/providers/kiro.ts` sends that value as `--effort` after `--model`, and
    rejects non-string or control-character values.
  - Values and per-model availability stay in YAML; no model ID appears in code.

### Behavior change

No effort default is declared. Desktop, Playground and runtime resolution therefore start each
effort-bearing row at its first value and always send `--effort`:

- Claude rows start at `low`: claude-opus-5.5, claude-opus-5, claude-sonnet-5, claude-opus-4.8,
  claude-opus-4.7, claude-opus-4.6 and claude-sonnet-4.6.
- GPT rows start at `none`: gpt-5.6-sol, gpt-5.6-terra and gpt-5.6-luna.

This overrides the effort that Kiro keeps in `~/.kiro/settings/cli.json` `chat.modelDefaults`.
For example, this machine's saved `claude-opus-5.5` → `xhigh` is not used for Cats turns; Cats sends
`--effort low` unless the user selects another value.

- Former shortlist rows that previously sent no `--effort` now send one: claude-opus-5 (`low`),
  claude-sonnet-5 (`low`), gpt-5.6-sol, gpt-5.6-terra and gpt-5.6-luna (`none`).
- claude-haiku-4.5 and the other rows without effort still send only `--model`, and auto sends
  `--model auto`.
- No "default" or "CLI default" option was added to keep Kiro's own setting; the operator
  rejected that.
- Existing sessions keep their recorded bindings.

Not verified by a turn: whether `kiro-cli chat --no-interactive --effort none` or
`--effort max` succeeds for each model. A turn would consume credits. `--list-models` accepts any
`--effort` string, so it cannot validate values.

## WSL scope

The capture covers only this Windows native installation and account. The same `kiro` / `cli`
scope also serves Kiro under WSL, where `/kiro/models` returns the same list. That does not show
that a WSL installation, its version or its account can see the same models or effort values.
Capture WSL separately before relying on it there.

## Validation

- `npm run catalog:generate` and `npm run catalog:check` passed, including the code/data boundary
  check. The generated digest is `80f0301cf62c30d761af0625b5421219a7036bffc04d6166b1b2c07f81950fca`.
- **New and updated tests:**
  - `tests/catalog-runtime.test.ts`:
    - the 20 rows start at auto, with no default flag and no controls on the initial selection;
    - first values: claude-opus-5.5 → low, claude-opus-4.6 → low, gpt-5.6-sol → none;
    - `xhigh` is rejected on claude-opus-4.6, and any effort is rejected on claude-haiku-4.5;
    - auto and claude-haiku-4.5 send no `--effort`; auto sends `--model auto`;
    - an unknown-ID, data-only scope emits `--effort` without model code.
  - `src/backends/cli/providers/kiro.test.ts`: argument order, omission, and rejection of invalid
    values.
  - `tests/runtime-server.test.ts`: `/kiro/models` and `/providers/kiro/models/advanced` (20 IDs,
    per-model values, no default markers).
  - `src/http/kiroManagement.test.ts`: the 20-ID route list.
  - `src/http/ui/shared.playground.test.ts`: Kiro left the six-row shortlist group. A new test
    covers menus, first values, saved `xhigh` and auto without effort.
- **Focused runs (all passed):**
  - Vitest, 129 tests in 8 files: `tests/catalog-data.test.ts`, `tests/catalog-runtime.test.ts`,
    `src/backends/cli/providers/kiro.test.ts`, `src/http/kiroManagement.test.ts`,
    `src/http/ui/shared.playground.test.ts`, `src/core/models/providerModelCatalog.test.ts`,
    `tests/ui-shared.test.ts` and `tests/agent-skill-sync.test.ts`.
  - `tests/runtime-server.test.ts -t kiro`: 2 passed.
  - `node --test` on the skill's `normalize-picker-paste` tests: 6 passed.
  - `tsc --noEmit -p tsconfig.json` passed. `npm run build:ui` left the generated UI unchanged.
  - Runtime `Sync-AgentSkills.ps1` and workspace `Sync-WorkspaceSkills.ps1 -Check` passed. The
    `.agents` and `.claude` copies match the canonical files.
  - The full suite is left to the PR's `release-preflight` CI.
- **Old-ID consumers:** the historical `config/catalog-schema1-migration.json`,
  `tests/fixtures/catalog-schema1/*` and earlier research notes stay as they are. So does
  cats-platform's frozen `tests/fixtures/catalogs-v2.json` ("Frozen HTTP projection … Never
  production data") and `tests/provider-selection.test.js`, which reads it. No Platform change is
  part of this PR.

## Cost

- **Images:** two window captures were saved, both 1129×635 on the 2560×1306 desktop: the startup
  screen and the opened picker. Both were sent to the model, about 960 input tokens each at
  width × height / 750. Everything else was read as UI Automation text.
- **Host session:** Kiro CLI 2.24.1, `kiro_default` agent, model claude-opus-5.5, effort xhigh.
  - Kiro's session record gives, per user turn, request counts, duration, context-window use and
    one `metering_usage` credit entry per request.
  - Its token fields were all 0, so uncached input, cache writes, cache reads and output tokens
    could not be measured. Credits are the available cost measure.
  - An earlier version of this note called `metering_usage` blank. That was a display artifact;
    the entries were there.
- **Method:** measured with the new `Measure-KiroSessionUsage.ps1` (see
  [Capture tooling](#capture-tooling)). Phase boundaries are the first tool call of each phase.
  Each phase's credits sum that turn's metering entries in request order; every turn had one
  entry per request.

| Turn / phase | Calls | Credits | Notes |
| --- | --- | --- | --- |
| 1. Preparation: skill reading, preflight, readiness, `--list-models` | 25 | 13.19 | |
| 1. Capture: launch to config restore | 42 | 31.73 | Four guard stops sent no key; one wait timed out after a delivered Down, which was not resent |
| 1. Wrap-up and questions to the operator | 10 | 10.71 | |
| **Turn 1 total (31 min)** | 77 | 55.64 | Context at end: 16.9% of 1,000,000 tokens (about 169,000) |
| 2. Catalog, code and tests | 32 | 32.80 | |
| 2. Evidence, docs and validation | 23 | 32.88 | |
| 2. Commit, PR, merge and cleanup | 13 | 20.01 | Includes about 4 min waiting for CI |
| **Turn 2 total (30 min)** | 68 | 85.69 | Context at end: 30.0% |
| 3. Listing the temporary scripts | 2 | 5.15 | |
| **Turns 1–3** | 147 | 146.48 | Turn 4, the tooling in this section, had not ended when measured |

Every call re-reads the whole context, so the re-read context dominates cost, not the two
screenshots. Turn 2's calls cost about 1.26 credits each, against 0.72 in turn 1, as the
context grew from about 169,000 to 300,000 tokens. This repeats the skill's advice to use a
fresh session per provider refresh.

## Capture tooling

After the catalog PR merged, the operator asked for the reusable parts of this run's temporary
scripts to be kept in the skill. The criterion was that a later Kiro version could rerun them
unchanged. The helpers follow the Claude and Codex conventions and the platform
`WindowsUi.ps1`; usage is in the Windows Kiro helper section of
[interactive capture](../../skills/maintain-provider-model-catalogs/references/interactive-capture.md).
Offline tests use a simulated picker and synthetic session files, and never start Kiro. The
private screens from this run were also parsed offline by the new capture parser, without
committing them: 124 of 124 parsed, with the arrival values listed above.

Included:

| Repository file | From | Why it was kept |
| --- | --- | --- |
| `scripts/Capture-KiroPicker.ps1` | `Traverse-KiroModels.ps1`, `Cycle-KiroEffort.ps1` | A version-independent picker traversal and settings-ring capture. Merged, with parameters in place of this run's window title, helper path and resume flags. |
| `scripts/Restore-KiroPickerConfig.ps1` | Ad hoc backup, hash and restore commands | Every capture that cycles settings needs the same backup, concurrent-writer check and verified restore. |
| `scripts/Measure-KiroSessionUsage.ps1` | Ad hoc session JSON/JSONL queries | Reports requests, credits and phase splits for any Kiro-hosted run without printing transcript content. |
| `tests/Test-KiroPicker.ps1`, `tests/Test-KiroSessionUsage.ps1` | New | Offline guards for the above: no Enter/Escape, a stop on concurrent edits, restore refusal and idempotency, direction and count checks, and usage parsing. |

Not included (left in the private directory):

| Temporary script | Why it was not kept |
| --- | --- |
| `Launch-KiroCapture.ps1` | Claude/Codex helpers do not launch the CLI. The platform `Start-WindowsUiTerminal` plus the documented launch hygiene covers it, and the variables to clear depend on the agent host. |
| `Invoke-KiroUi.ps1` | A one-action wrapper around generic window operations that `WindowsUi.ps1` already owns. Its guarded Tab moved into the capture helper. |
| `cats-desk-probe.ps1` (already deleted) | A one-time desktop readiness probe; the platform Windows recipe documents it. |
| `cats-fg-probe.ps1` (already deleted) | A one-time foreground and idle check, which is generic window work owned by the platform. |
| `gen-kiro-scope.tmp.mjs` (already deleted) | A single-use generator holding this version's model rows, which belong in YAML, not code. |

`Send-WindowsUiKey` has no Tab key. The Kiro helper therefore sends Tab through the platform
helper's own focus, screen and focused-surface guards and key primitive. Adding Tab to the
platform helper would be a separate cats-platform change.

The helpers were validated only offline. The next Kiro refresh will be their first native run.

- `Test-KiroPicker.ps1`: all 9 checks passed. `Test-KiroSessionUsage.ps1`: all 3 passed.
- The existing `Test-ClaudePicker.ps1` and `Test-CodexPicker.ps1` still pass.
- `tests/agent-skill-sync.test.ts`: 8 passed. Runtime and workspace skill sync passed, and the
  mirrors match the canonical files.
- `Measure-KiroSessionUsage.ps1` on this session reproduced the manually counted turn-1 phases
  (25/42/10) and produced the credit figures in [Cost](#cost).

## Capture lessons

These are now in the [Kiro reference](../../skills/maintain-provider-model-catalogs/references/providers/kiro.md)
and the [interactive capture reference](../../skills/maintain-provider-model-catalogs/references/interactive-capture.md):

- Kiro's per-model settings persist on toggle, with no Enter. Back up and hash `cli.json` before
  cycling, and restore only after the owned Kiro exits and a no-concurrent-writer check.
- Read `default` as the unset state, not an option or a default marker.
- The settings header reads `Settings for selected model:` on auto and `Settings for model:` on
  other rows. Match both.
- Windows PowerShell 5.1 reads a BOM-less script as ANSI. Non-ASCII literals such as `❯` or `─`
  then fail to match. Keep capture scripts ASCII and use `\u` regex escapes or `[char]` code
  points.
