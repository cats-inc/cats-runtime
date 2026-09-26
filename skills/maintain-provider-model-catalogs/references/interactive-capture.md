# Agent-operated picker capture

Use only when the operator requests live catalog evidence. A complete supplied paste does not
need a second capture. Apply the ordinary refresh/preview policy and [paste intake](paste-intake.md)
to the acquired text; desktop access does not authorize inference calls, login, catalog edits,
personal overrides or publication beyond the existing request.

## Collect once, then reuse

1. Read the matching `desktop-ui-automation` platform recipe and prove local observation/control.
   Record CLI version, account scope without identity, terminal host and capture method.
2. Use a dedicated, uniquely titled terminal window and a new private evidence directory outside
   Git. Keep raw screenshots/logs private. Record the actual launched home/profile/config path;
   hash the relevant config before launch without copying credentials or the whole profile.
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
rows plus the `… +N models` line, and each row is read while highlighted. Effort is picker-wide,
so the helper cycles the starting row back at the end. Enter (save default) and `s` (session only)
are never sent, and the picker is left open at its starting row and effort. `KeyScreens` saves the list plus one default-marked
(or unsupported) screen per row; the other steps are text-only. The JSON result records each
row's label, current marker, description and effort cycle with explicit `(default)` markers.
Order is the Right-key cycle from the starting level; derive linear order from the wrap point.

Exercise traversal, config-change and evidence-directory guards without launching a CLI:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-ClaudePicker.ps1
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

When the capture agent runs inside Kiro CLI,
[`Measure-KiroSessionUsage.ps1`](../scripts/Measure-KiroSessionUsage.ps1) reports that session's
cost from `~/.kiro/sessions/cli/<id>.json(l)`. It prints counts and credits only, never message
content, and runs in either PowerShell edition:

```powershell
& skills/maintain-provider-model-catalogs/scripts/Measure-KiroSessionUsage.ps1 -Turn 1 `
  -PhaseBoundary 'Action Launch', 'final-window' -PhaseName 'Preparation', 'Capture', 'Questions'
```

- **Per turn:** requests, duration, context use and credits. Kiro 2.24.1 records one
  `metering_usage` credit entry per request and leaves the token fields at 0, so tokens are
  reported as not recorded. The turn in progress has no metadata until it ends.
- **Phases:** each boundary is a literal string from one of the agent's own tool calls, and the
  message containing it starts the next phase. Phase credits pair metering entries with that
  turn's assistant messages in order.

Exercise traversal, config guards, restore and usage parsing without a desktop or Kiro:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-KiroPicker.ps1
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-KiroSessionUsage.ps1
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
`docs/research/2026-09-26-claude-picker-eleven-rows.md` adds the scrolled list and row values.
The [Kiro reference](providers/kiro.md) and `docs/research/2026-09-27-kiro-picker-full-catalog.md`
record a settings panel whose toggles persist, and its config restore.

When the operator asks for cost, report the number and pixel size of saved images separately from
the images actually sent to the agent. If the agent host keeps a per-message usage transcript, sum
each message once by phase: preparation, capture and catalog update. Distinguish uncached input,
cache writes, cache reads and output. The session context re-read on every call usually outweighs
screenshots, so fewer, larger steps save more than dropping screenshots.
