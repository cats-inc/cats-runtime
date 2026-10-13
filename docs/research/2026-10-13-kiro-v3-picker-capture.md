# Kiro 2.30.0 V3 picker capture: labels stay raw IDs

Date: 2026-10-13 (UTC+8). Mode: refresh with an agent-operated picker capture. Interaction
policy: confirm uncertainty; no question arose. Scope: the `kiro` / `cli` catalog scope and the
Kiro parts of the `maintain-provider-model-catalogs` skill. Follows the
[V3 catalog refresh](./2026-10-13-kiro-v3-catalog-refresh.md) of the same day, whose Open
section asked whether the V3 picker displays the ACP display names.

## Request and outcome

The operator asked for the Kiro catalog to be updated with the skill in a worktree, using
desktop-ui-automation if needed. The probe came back clean, so the only open question was what
the V3 picker displays, which the probe cannot see.

- **Probe first:** `catalog-probe.mjs probe --providers kiro` reported `kiro/cli 2.30.0 21/21
  confirmed` with no findings. Membership, effort levels and defaults did not change since the
  morning refresh.
- **Labels stay the raw IDs.** The V3 picker shows `auto`, `claude-opus-5.5` and so on. The ACP
  display names (`Claude Opus 5.5`) do not appear in it, so the label policy keeps the IDs.
- **No data change.** IDs, order, controls, effort values and defaults are unchanged. Only the
  scope notes changed, recording three differences between the 2.27.1 and 2.30.0 panels (below).

## Capture

- **Environment:** `kiro-cli-chat 2.30.0`, not updated during the capture. Native Windows 11,
  RDP session 2, Windows Terminal window `Cats Kiro V3 picker 20261013`.
- **Launch:** `kiro-cli chat --agent-engine v3` from an empty private directory, after clearing
  inherited `CLAUDE*`, `NO_COLOR` and other agent/terminal variables (none of `KIRO_*`,
  `AWS_EXECUTION_ENV`, `JSC_*`, `TERM` or `CI` was set). The banner read "Welcome to Kiro CLI
  V3!". The UI appeared at once; no security-software detection was involved.
- **Method:** Windows UI Automation visible text through the platform `WindowsUi.ps1`. Every key
  was sent after the expected screen, highlight and panel were confirmed, and the next read
  waited for the highlight to move and the panel to name the highlighted row. The opened picker
  was checked against one window screenshot. The panel heading is `Settings for selected model:`
  on the active row and `Settings for model:` on every other row; the first walk stopped after
  one Down because it expected only the first form.
- **Keys:** `/model` + Enter and `/quit` + Enter (slash commands). In the picker: Down x20,
  Up x20 and one Escape. Enter, Tab, Left and Right were never sent in the picker, and no prompt
  was submitted.
- **Focus:** Explorer held the foreground once after launch while the operator had been idle
  for about 100 s. UI Automation `SetFocus()` on the owned window brought it back, as the
  platform reference describes. The foreground changed again before the first walk key, with
  input 1.9 s earlier; the agent waited until the operator had been idle for over 60 s and the
  owned window was in front before retrying.
- **Completeness:** 21 rows, 8 visible with a `(+13 more)` counter that counts down to none.
  Down from row 1 to 21 and Up back to 1 read the same rows and panels. Order, IDs, credit rates
  and descriptions equal `kiro-cli chat --list-models` and the ACP reply; claude-sonnet-4's
  `[EOL]` description is truncated on screen.
- **Evidence:**
  [model-picker.v3-agent-capture.redacted.txt](./fixtures/kiro-2.30.0/model-picker.v3-agent-capture.redacted.txt).
  The workspace path, which contained the user name, is redacted; raw step captures and the
  screenshot stay private.

## What the panel shows

The panel under the list shows the highlighted row's thinking and effort cells.

- **Current values, not defaults.** claude-opus-5.5 showed effort `xhigh` because the
  operator's `~/.kiro/settings/cli.json` holds `chat.modelDefaults` claude-opus-5.5 effort
  `xhigh`; Kiro's `defaultEffortLevel` is `medium`. Every other effort cell equals
  `defaultEffortLevel`. A walk result must never be promoted to a catalog `default:`.
- **Rings not cycled.** Without Left/Right the panel shows one value per row, so effort levels
  and their order still come from the ACP reply. Cycling would persist the setting, as 2.24.1
  did, and adds nothing the probe does not already read.
- **Thinking text changed.** Toggleable rows show `on`. claude-opus-5.5 and claude-sonnet-5.5
  show `n/a  Not available for this model.`, the same text as rows without thinking; the 2.27.1
  panel showed `Always on for this model.` for those two. The scope and row notes now record both.
- **No fallback row.** The 2.27.1 panel's `fallback none` row is gone.

## State after the capture

- `~/.kiro/settings/cli.json` kept its SHA-256 before every arrow key in the walk and after the
  exit.
- `~/.kiro/settings/feed_state.json` changed: Kiro marked its What's-new notice as seen. That is
  ordinary startup state and was not restored.
- Startup created an empty session (`New Session`, no messages) for the private directory. It
  was deleted with `kiro-cli chat --delete-session`, and `--list-sessions` for that directory
  then listed none. The prompt history file Kiro wrote for it (`/model`, `/quit`) was removed.
  The directory's `.index` folder and its session-index add/remove log remain, as they do after
  any Kiro deletion. The operator's own session was not touched.

## Skill changes

- `scripts/Capture-KiroPicker.ps1` (new): the guarded Up/Down walk used here, parameterized like
  the Junie and Auggie helpers. It goes Up to row 1, Down to the last row and Up again, records
  each row's label, rate, description, `[active]` tag and panel cells, checks that both
  directions agree, returns to the starting row and checks the settings file's SHA-256 before
  every key. The list has no indicator for rows scrolled out above, so the row position is the
  expected count minus the visible rows and `(+N more)`.
- `tests/Test-KiroPicker.ps1` (new): a simulated picker with a scrolled list and a lagging panel;
  it also rejects a longer or shorter list, a settings write and a reused evidence directory.
  The helper was also replayed offline against this capture's real screens and read all 21 rows.
- This differs from the `Capture-KiroPicker.ps1` removed on 2026-10-13 in
  [the V3 refresh](./2026-10-13-kiro-v3-catalog-refresh.md#skill-changes): that one cycled the
  effort ring with Left/Right, which rewrote `cli.json` and needed a restore script. The new
  helper only reads, and covers the one thing the probe cannot: the text the picker displays.
- `references/providers/kiro.md`, `references/interactive-capture.md` and `SKILL.md` now say the
  probe owns membership, efforts and defaults and the picker walk owns display text.

## Scripts

- `traverse.ps1` (private): the first version of the walk. Kept as `Capture-KiroPicker.ps1`.
- `drive.ps1` (private): launch, read, type, key and screenshot actions over `WindowsUi.ps1`
  for one window title. Left out: each action is a one-line helper call, and the interactive
  capture reference already shows the launch and slash-command sequence.
- `launch-kiro.ps1` (private): clears agent/terminal variables and runs `kiro-cli chat
  --agent-engine v3`. Left out: three lines, documented as launch hygiene in the reference.
- `idle.ps1` (private): reads `GetLastInputInfo` and the foreground window's process. Left out
  here because it belongs to the platform; recommended to `desktop-ui-automation`, whose Windows
  reference describes this check without a helper.
- `compare-notes.mjs` and `build-fixture.mjs` (private): compared the scope's `Picker ...`
  notes with the walk and built the redacted fixture from this run's files. Left out:
  specific to this run's file layout.

## Cost

- **Images:** 1 screenshot saved (1129 x 635) and 1 sent to the agent, about 960 input tokens.
- **Agent usage** (`measure-agent-usage.mjs claude`, this operator turn only, Claude Opus 5.5):
  - Preparation (skill, worktree, probe, readiness): 16 calls, 80,542 cache-write, 1,178,793
    cache-read and 7,256 output tokens.
  - Capture (launch to exit, cleanup and reconciliation): 42 calls, 66,397 cache-write,
    5,408,069 cache-read and 29,888 output tokens.
  - Catalog update (fixture, notes, helper, tests and this note, measured while writing it):
    17 calls so far, 41,691 cache-write, 3,109,518 cache-read and 28,886 output tokens.
  - The session carried a long earlier history, so cache reads dominate, as the skill warns.
- **Kiro credits:** none. No prompt was sent; the probe's ACP session sends none either.

## Validation

- `npm run catalog:generate` and `npm run catalog:check`; `catalog-probe.mjs validate` on the
  run's snapshot after the note edits: `kiro/cli 2.30.0 21/21 confirmed`.
- `tests/catalog-data.test.ts`, `tests/catalog-runtime.test.ts`, `tests/agent-skill-sync.test.ts`
  and `tests/docs-boundary.test.ts`: 75 tests passed.
- `powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-KiroPicker.ps1`:
  three cases passed.

## Open

- claude-sonnet-4's description says it reaches end of life on 2026-10-14. When a later list
  drops it, removing the row needs the operator's confirmation as usual.
