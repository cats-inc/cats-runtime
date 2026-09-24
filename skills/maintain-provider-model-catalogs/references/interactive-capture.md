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
3. Inspect command help only as needed for startup/isolation flags. Read each screen's footer.
   Navigate menus and cancel leaves; do not submit an inference prompt or assume Enter/Escape
   have the same meaning across model, effort, upgrade and authentication screens.
4. Prefer visible accessibility text. Verify its correspondence with a current window screenshot.
   Capture each model's option branches, order, labels, descriptions and explicit defaults. Wait
   for the expected new heading/highlight after each key; never replay a key because rendering
   took longer than a fixed sleep. Stop on a changed window/pane, prompt or ambiguous selection.
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
to its starting level. Enter (save default) and `s` (session only) are never sent, and the picker
is left open at its starting row and effort. `KeyScreens` saves the list plus one default-marked
(or unsupported) screen per row; the other steps are text-only. The JSON result records each
row's label, current marker, description and effort cycle with explicit `(default)` markers.
Order is the Right-key cycle from the starting level; derive linear order from the wrap point.

Exercise traversal, config-change and evidence-directory guards without launching a CLI:

```powershell
powershell.exe -NoProfile -File skills/maintain-provider-model-catalogs/tests/Test-ClaudePicker.ps1
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
`docs/research/2026-09-25-claude-picker-agent-capture.md` do the same for Claude Code.

When the operator asks for cost, report the number and pixel size of saved images separately from
the images actually sent to the agent. If the agent host keeps a per-message usage transcript, sum
each message once by phase: preparation, capture and catalog update. Distinguish uncached input,
cache writes, cache reads and output. The session context re-read on every call usually outweighs
screenshots, so fewer, larger steps save more than dropping screenshots.
