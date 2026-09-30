# Agent-operated picker capture

Use only when the operator requests live catalog evidence. A complete supplied paste does not
need a second capture. Apply the ordinary refresh/preview policy and [paste intake](paste-intake.md)
to the acquired text; desktop access does not authorize inference calls, login, catalog edits,
personal overrides or publication beyond the existing request.

## Collect once, then reuse

1. Read the matching `desktop-ui-automation` platform recipe and prove local observation/control.
   Record CLI version, account scope without identity, terminal host and capture method.
2. Use a dedicated, uniquely titled terminal window and a new private evidence directory outside
   Git. Keep screenshots and raw logs private; images never enter Git, even redacted (see
   [evidence storage](evidence-and-scope.md#evidence-storage-and-redaction)). Record the actual
   launched home/profile/config path; hash the relevant config before launch without copying
   credentials or the whole profile.
   On Windows, the platform helper's `Start-WindowsUiTerminal` opens that window and
   `Send-WindowsUiText` types slash commands under the same guards as keys. Wait for the typed
   command to appear on screen before a separate guarded Enter.
   Launch hygiene when the agent starts the CLI itself:
   - **Clean the environment first.** Clear inherited agent variables (`TERM`, `CI`, `NO_COLOR`,
     pager and git-prompt variables, and the host agent's own variables), because a TUI can
     refuse a dumb terminal.
   - **If the CLI exits before its UI, check security software first.** Read the Defender
     protection history, or `Get-MpThreatDetection`, for events after the launch time before
     trying anything else. Each retry of a blocked launch adds another detection.
   - **Never allow, exclude or restore a detection yourself.** Report it, then give the operator
     the exact uniquely titled launch command and attach to the window they open. The
     [Junie reference](providers/junie.md) records one such case.
3. Inspect command help only as needed for startup/isolation flags. Read each screen's footer.
   Navigate menus and cancel leaves; do not submit an inference prompt or assume Enter/Escape
   have the same meaning across model, effort, upgrade and authentication screens.
4. Prefer visible accessibility text. Verify its correspondence with a current window screenshot.
   Capture each model's option branches, order, labels, descriptions and explicit defaults. Wait
   for the expected new heading/highlight after each key; never replay a key because rendering
   took longer than a fixed sleep. Stop on a changed window/pane, prompt or ambiguous selection.
   Some pickers persist an option toggle without Enter (Kiro 2.24.1 rewrites its settings file on
   every ←→). Before cycling options, hash and privately back up the file the picker writes, and
   restore it only after the owned CLI exits and no concurrent writer changed it.
5. Reconcile model coverage with a supported CLI enumeration when available. Check that each
   menu is fully visible through its footer; a model count alone cannot prove effort completeness.
   Resolve only material gaps. Use machine tokens for identity and picker text for its display.
6. Cancel back, exit only the owned CLI/window and compare the final config hash with the
   prelaunch baseline. Do not overwrite a concurrent setting change as an automatic restoration.
   A terminal process can own other windows: close the owned window, not the shared host PID.
7. Keep a checkpoint of captured paths and unresolved gaps. A pause, helper review or later YAML
   edit does not invalidate evidence. Do not rerun a complete traversal without a concrete gap,
   upstream change or changed behavior requiring that validation.
8. Before the agent session ends, record its [cost](#cost); Junie's per-call usage file did not
   survive to the next day. List and keep the capture's scripts as the skill's
   [keep reusable scripts](../SKILL.md#keep-reusable-scripts) section describes.

## Windows Codex helper

The Runtime owns Codex menu semantics in
[`Capture-CodexPicker.ps1`](../scripts/Capture-CodexPicker.ps1). Platform owns the native helper at
`desktop-ui-automation/scripts/windows/WindowsUi.ps1` inside its canonical or active skill package.
Pass the discovered path explicitly; do not copy the platform implementation into Runtime.

On the tested Windows host, use Windows PowerShell 5.1. Start at an inspected `/model` menu in a
dedicated, single-pane Windows Terminal window, already foreground. Resolve the actual config
used by that invocation. The helper does not launch the CLI, type `/model`, authenticate, or
choose catalog IDs/defaults:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/scripts/Capture-CodexPicker.ps1 `
  -UiHelperPath $desktopUiHelper -WindowTitle $captureWindowTitle `
  -OutputDirectory $newEmptyEvidenceDirectory -ConfigPath $actualCodexConfig `
  -ExpectedModelCount $independentlyObservedCount
```

Default `-Screenshots KeyScreens` captures only the model list and option menus; intermediate
navigation is text-only. `All` is for diagnosing the helper, not routine catalog maintenance.
Use `None` after confirming that the visible text faithfully represents this terminal's menus;
retain an initial visual check and capture anomalies separately. Do not send every stored image
back to the model when the text is sufficient. Record saved images separately from inspected images.

The helper binds one visible keyboard-focusable TextPattern surface and rejects split panes,
changed foreground, replaced surfaces, unexpected selected rows and nonempty output directories.
It never confirms a final effort. Its hash baseline starts when the helper runs; the separate
prelaunch hash is required to claim startup preservation. Success means capture finished and that
config stayed unchanged, not that completeness, redaction or catalog correctness is automatic.

Exercise traversal, final hash failure and capture policies without launching a CLI:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-CodexPicker.ps1
```

## Windows Claude helper

[`Capture-ClaudePicker.ps1`](../scripts/Capture-ClaudePicker.ps1) owns Claude Code picker
semantics and takes the same platform helper path. Start at an inspected Claude Code
`Select model` picker in a dedicated single-pane Windows Terminal window, already foreground.
Pass the settings file the picker would write (normally `~/.claude/settings.json`). The helper
does not launch the CLI, type `/model` or interpret aliases/defaults:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/scripts/Capture-ClaudePicker.ps1 `
  -UiHelperPath $desktopUiHelper -WindowTitle $captureWindowTitle `
  -OutputDirectory $newEmptyEvidenceDirectory -ConfigPath $claudeSettings `
  -ExpectedModelCount $independentlyObservedCount
```

It sends only arrow keys. Up/Down move rows; Right cycles each row's effort line until it returns
to its starting level. A scrolled list counts toward `-ExpectedModelCount` through its visible
rows plus the `… +N models` line, and each row is read while highlighted. That line counts every
row out of view through 2.1.283, and only the rows below the window from 2.1.284, so the helper
accepts either total at every row. Effort is picker-wide,
so the helper cycles the starting row back at the end. Enter (save default) and `s` (session only)
are never sent, and the picker is left open at its starting row and effort. `KeyScreens` saves the list plus one default-marked
(or unsupported) screen per row; the other steps are text-only. The JSON result records each
row's label, current marker, description and effort cycle with explicit `(default)` markers.
Order is the Right-key cycle from the starting level; derive linear order from the wrap point.

Exercise traversal, config-change and evidence-directory guards without launching a CLI:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-ClaudePicker.ps1
```

The picker does not show what a row sets. After the traversal, close the picker with Escape and
run [`Read-ClaudePickerRowStatus.ps1`](../scripts/Read-ClaudePickerRowStatus.ps1) from the empty
prompt of the same window:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/scripts/Read-ClaudePickerRowStatus.ps1 `
  -UiHelperPath $desktopUiHelper -WindowTitle $captureWindowTitle `
  -Rows '2,4,6' -OutputFile $newResultFile -ConfigPath $claudeSettings
```

For each row it opens `/model`, highlights the row, presses `s` (this session only), reads the
`/status` Version and Model lines and closes `/status` with Escape. Enter only runs the typed
commands; it is never sent inside the picker. Before `s` it waits for the highlight and footer to
render together, because a guard read during a redraw once missed the highlight. The settings
file must keep its SHA-256 after every row. The session is left on the last row; exit with
`/exit`. Exercise it without a desktop or CLI:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-ClaudePickerRowStatus.ps1
```

[`claude-picker-observation.mjs`](../scripts/claude-picker-observation.mjs) turns the capture
helper's JSON, plus the row-status JSON when present, into the observation tree for `gaps`,
`summary` and `assess`. Rows without a `/status` read keep `rawId: null`:

```text
node skills/maintain-provider-model-catalogs/scripts/claude-picker-observation.mjs \
  --capture capture-result.json --row-status row-status.json --artifact <fixture path> > observation.json
```

## Windows Kiro helper

[`Capture-KiroPicker.ps1`](../scripts/Capture-KiroPicker.ps1) owns Kiro CLI picker semantics and
takes the same platform helper path. It does not launch Kiro, type `/model` or interpret defaults.

1. **Launch.** Clean the environment first (see launch hygiene above). When the agent itself runs
   inside Kiro, that means `KIRO_*`, `AWS_EXECUTION_ENV` and `JSC_*`. Then open interactive
   `kiro-cli chat` in a uniquely titled window with `Start-WindowsUiTerminal`, from an empty
   private working directory.
2. **Open the picker.** Type `/model` with `Send-WindowsUiText`, wait for the echo, and send one
   guarded Enter to run the slash command. The picker opens with the list focused.
3. **Check the start.** The first row must be highlighted and the search empty. Run
   `kiro-cli chat --list-models` for `-ExpectedModelCount`.
4. **Capture.** Pass the settings file the picker writes, normally `~/.kiro/settings/cli.json`:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/scripts/Capture-KiroPicker.ps1 `
  -UiHelperPath $desktopUiHelper -WindowTitle $captureWindowTitle `
  -OutputDirectory $newEmptyEvidenceDirectory -ConfigPath $kiroSettings `
  -ExpectedModelCount $listModelsCount
```

**What the helper does:**

- Reads every row while it is highlighted: raw ID, credit rate, description, `[active]` and the
  arrival value of each settings row. `-ExpectedModelCount` is checked against the visible rows
  plus the `(+N more)` line.
- For each `-Axes` row (default `effort,thinking`) that is not `n/a`:
  - Tab enters the settings panel.
  - Right cycles the value until one repeats, recording every step together with the other
    rows' values, so `thinking` off → `effort` n/a is visible.
  - Tab returns to the list.
- Walks back up with Up and checks that both directions give the same order, then leaves the
  picker open at its first row.
- Sends only Up, Down, Right and Tab. Enter would select a model and Escape would close the
  picker, so neither is ever sent. `Send-WindowsUiKey` has no Tab, so Tab reuses the platform
  helper's own guards before its key primitive.
- Screenshots: `KeyScreens` saves the first list screen and each cycled row's settings panel;
  every step is kept as text. The JSON result records each ring as the Right-key sequence from
  its start value. `default` is the unset state, so derive linear order from the wrap point.

**Settings file.** Kiro saves every toggle immediately. The helper:

1. copies the settings file into the evidence directory before the first key;
2. records its SHA-256 in `config-state.json`;
3. before every key, requires the file to match the last digest it observed, and stops on any
   other change;
4. never restores while Kiro runs.

`-Axes ''` reads only the list and arrival values, with no toggles and no settings write.

**After the capture:**

1. Press Escape at the picker footer.
2. Exit the owned Kiro with `/quit`.
3. Once its window has closed, restore the file:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/scripts/Restore-KiroPickerConfig.ps1 `
  -UiHelperPath $desktopUiHelper -StatePath (Join-Path $newEmptyEvidenceDirectory 'config-state.json')
```

The restore refuses in two cases: while the capture window still exists, and when the file changed
after the last recorded toggle (another program, or Kiro on exit). In the second case compare the
file with the backup by hand. Otherwise it writes the backup through a same-directory temporary
file, or removes a file that did not exist at baseline, and checks the baseline digest. A repeated
run leaves an already restored file alone.

When the capture agent runs inside Kiro CLI, measure its session with the shared
[agent usage](#agent-usage) helper.

Exercise traversal, config guards and restore without a desktop or Kiro:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-KiroPicker.ps1
```

## Windows Auggie helper

[`Capture-AuggiePicker.ps1`](../scripts/Capture-AuggiePicker.ps1) owns Auggie CLI picker semantics
and takes the same platform helper path. It does not launch Auggie or interpret defaults.

1. **Launch.** Clean the environment first (launch hygiene above, plus `AUGMENT_*` and `AUGGIE_*`).
   Open interactive `auggie` in a uniquely titled window with `Start-WindowsUiTerminal`, from an
   empty private working directory. The workspace-indexing prompt accepts Escape, which skips
   indexing for this session only.
2. **Open the picker.** Type `/`, wait for `Enter command`, type `model`, wait for
   `model Select the model for this session` and send one guarded Enter. The echo renders as
   `/ model`, so do not match `/model` literally. Run `auggie model list --json` for
   `-ExpectedModelCount`.
3. **Capture.** Pass the settings file, normally `~/.augment/settings.json`:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/scripts/Capture-AuggiePicker.ps1 `
  -UiHelperPath $desktopUiHelper -WindowTitle $captureWindowTitle `
  -OutputDirectory $newEmptyEvidenceDirectory -ConfigPath $auggieSettings `
  -ExpectedModelCount $modelListCount
```

- The walk goes Up to the first row, Down to the last and Up again, reading each highlighted
  row's label, `(current)` and `(default)` suffixes, badges, cost tier and description, and
  checks that both directions agree. Edges come from the screen (no `↑`/`↓ N more` line and the
  highlight on the first or last visible row), so no key is sent past an edge. It sends only Up
  and Down and leaves the picker open at the first row.
- `-ProbeSelection`, only with operator authorization, then presses Enter on each row (reopening
  `/model` for rows after the first) and requires `Using model: <label>`. Any other screen, such
  as an effort step, stops the probe. Escape is never sent. In 0.36.0 Enter changes only the
  session model.
- Before every key the settings file must match its pre-capture SHA-256; there is nothing to
  restore. `KeyScreens` saves the opened picker once; every step is kept as text.
- Exit the owned Auggie with the `/exit` slash command. Ctrl+C did not exit 0.36.0.

Exercise the walk, probe and guards without a desktop or Auggie:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-AuggiePicker.ps1
```

## Windows Copilot helper

[`Capture-CopilotPicker.ps1`](../scripts/Capture-CopilotPicker.ps1) owns GitHub Copilot CLI picker
semantics and takes the same platform helper path. It does not launch Copilot or interpret defaults.

1. **Launch.** Clean the environment first (launch hygiene above, plus `COPILOT_*`). Open
   interactive `copilot --no-auto-update --no-custom-instructions --disable-builtin-mcps
   --no-remote --no-remote-export` in a uniquely titled window with `Start-WindowsUiTerminal`, from
   an already trusted folder. The first launch in Windows Terminal adds `askedSetupTerminals` to
   `~/.copilot/config.json`, so take the settings hash after startup. If focusing fails because
   Explorer owns the foreground, wait until the operator is idle and call the UI Automation
   element's `SetFocus()` before the helper.
2. **Open the picker.** Type `/model`, wait for the command list and send one guarded Enter; that
   Enter runs the command and selects nothing. The picker must be on `group: recommended`.
3. **Capture.** Pass the settings file, normally `~/.copilot/config.json`:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/scripts/Capture-CopilotPicker.ps1 `
  -UiHelperPath $desktopUiHelper -WindowTitle $captureWindowTitle `
  -OutputDirectory $newEmptyEvidenceDirectory -ConfigPath $copilotConfig -CycleOptions
```

- The walk goes Down until the list wraps to its first row, then Up through every row to check the
  reverse order. For each highlighted row it reads the group header, label, `(default)` suffix,
  current-session check mark, Context figures, Reasoning or Tier value, and the detail pane. A
  plan-unavailable row is recorded from its pane message. The pane can lag the highlight, so each
  read waits until the pane names the highlighted row (or differs from the previous row's pane),
  and a pane that never catches up is reported in `PaneUnmatched` instead of being attributed.
- Two Context figures are recorded as the Tab context toggle; the helper never sends Tab.
- `-CycleOptions` then presses Left on each row with arrows until the value stops changing or
  repeats, restores the arrival value, does the same with Right and restores again. `options.json`
  keeps both sequences; a row that ends at both edges is `linear` with its full `Order`, and the
  Auto Tier graph is reported as `irregular`. Changes apply to the session only.
- It sends only Up, Down, Left and Right. Before every key the settings file must match its
  pre-capture SHA-256. `KeyScreens` saves the opened picker once; every step is kept as text.
- Afterwards close the picker with Escape and exit the owned Copilot with `/exit`.

Exercise the walk, option cycling and guards without a desktop or Copilot:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-CopilotPicker.ps1
```

## Turn evidence into data

Trim only terminal padding/chrome, mark redactions visibly, and retain material picker text under
`docs/research/fixtures/<cli>-<version>/`. Record per-model paths and warnings in the observation
tree. Run `normalize`, `gaps` and `assess`, then update only the authorized schema-2 YAML scopes and
generate/check JSON. Existing approval to flatten Codex's More reasoning list still applies;
other projections need their own evidence/scope. Never turn capture output into a model table in
product code. Personal overrides use the separate [soft-patch workflow](local-soft-patch.md).

The [Codex reference](providers/codex.md) records default-marker masking and other tested UI
details. The owning repo's `docs/research/2026-09-24-codex-picker-pilot.md` records the native run,
catalog delta, validation and limitations. The [Claude reference](providers/claude.md) and
`docs/research/2026-09-25-claude-picker-agent-capture.md` do the same for Claude Code;
`docs/research/2026-09-26-claude-picker-eleven-rows.md` adds the scrolled list and row values;
`docs/research/2026-09-30-claude-picker-sonnet-5-5.md` adds the below-window count, a moved
alias and the row-status reader.
The [Kiro reference](providers/kiro.md) and `docs/research/2026-09-27-kiro-picker-full-catalog.md`
record a settings panel whose toggles persist, and its config restore. The
[Auggie reference](providers/auggie.md) and `docs/research/2026-09-27-auggie-picker-full-catalog.md`
record a picker without effort and the authorized Enter probe. The
[Copilot reference](providers/copilot.md) and `docs/research/2026-09-27-copilot-picker-full-catalog.md`
record per-row Reasoning, Context and Tier controls, plan-unavailable rows and a lagging detail pane.

## Cost

When the operator asks for cost, report the number and pixel size of saved images separately from
the images actually sent to the agent; each sent image is about width × height / 750 input tokens.
The session context re-read on every call usually outweighs screenshots, so fewer, larger steps
save more than dropping screenshots.

### Agent usage

[`measure-agent-usage.mjs`](../scripts/measure-agent-usage.mjs) summarizes the capture agent's own
session from its local files: calls, tokens (uncached input, cache writes, cache reads and
output), cost or credits, per model and per phase. It prints numbers and model names only, never
message content, and runs wherever Node runs:

```text
node skills/maintain-provider-model-catalogs/scripts/measure-agent-usage.mjs <host> <session-file> \
  --phase-start <marker> --phase-start <marker> \
  --phase-name Preparation --phase-name Capture --phase-name "Catalog update"
```

- **Claude Code:** `~/.claude/projects/<project>/<session-id>.jsonl`. Each API message is counted
  once, and the session's `subagents` folder is included.
- **Codex:** `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`. Per-call usage is the change in
  the running total; reasoning output is reported as part of output.
- **Junie:** `~/.junie/sessions/<session>/events.jsonl`, with Junie's USD cost per call. Measure
  before ending the session. The 2026-09-26 capture's file was gone the next day, and its
  `summary.json` covered only $0.29 of the $9.68 that `events.jsonl` had recorded.
- **Kiro CLI:** `~/.kiro/sessions/cli/<session-id>.json`, or `KIRO_SESSION_ID` from inside Kiro.
  Kiro 2.24.1 records one credit entry per request and leaves the token fields at 0. The result
  also lists each turn's requests, duration and context use; the turn in progress has no metadata
  until it ends.
- **GitHub Copilot:** `~/.copilot/session-state/<session-id>/events.jsonl`, or that folder. Tokens
  and premium requests arrive per model in `session.shutdown`, once per exit (a resumed session
  has several segments, which the reader sums). Copilot 1.0.88 writes no `outputTokens` on its
  messages, so an open session reports only message counts and Copilot's own nano-AIU checkpoint;
  exit it to record the rest.
- **Auggie:** `~/.augment/sessions/<session-id>.json`. Each `chatHistory` exchange is one call,
  with tokens in its `token_usage` node. The call in progress is saved only when it ends, and
  sub-agents appear only as session-level credits and USD.
- **Grok, Muse and Antigravity:** no reader yet. Grok's session log holds only a cumulative
  context size, and Muse exposed no per-message usage on the 2026-09-25 and 2026-09-26 hosts.
  Report estimates and label them as such.

Phase starts apply in order, and the call that matches one starts the next phase:

- `at:<ISO time with zone>` (Auggie, Claude, Codex, Copilot, Junie): the first call at or after that time.
- `text:<literal>` (Auggie, Claude, Codex, Copilot, Kiro): the first call whose own message or tool call contains
  the literal. Prompts and tool output never match, so use a unique command or file name from the
  agent's own calls, such as the capture window title.
- `turn:<n>` (Auggie, Copilot, Junie, Kiro): the first call of user turn n.

Exercise every host reader with synthetic session files:

```text
node --test skills/maintain-provider-model-catalogs/tests/measure-agent-usage.node-test.mjs
```
