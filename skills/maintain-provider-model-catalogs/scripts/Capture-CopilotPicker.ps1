<#
.SYNOPSIS
    Captures every GitHub Copilot CLI /model picker row and, optionally, each row's option cycle.
.DESCRIPTION
    Uses the desktop-ui-automation Windows helper. Starts at an inspected Copilot /model picker on
    the default "group: recommended" sort, in a dedicated single-pane Windows Terminal window.
    Walks Down until the list wraps to its first row, then Up to verify the reverse order. For each
    highlighted row it records the group header, label, (default) suffix, the current-session check
    mark, the Context column figures, the Reasoning or Tier value between the arrows, and the detail
    pane (cost tier and credits per 1M tokens, or the plan-unavailable message). The detail pane can
    lag the highlight, so each read waits for the pane to name the highlighted row.

    Two Context figures mean the row has a Tab context toggle (first figure = --context default);
    the script records the figures and never sends Tab. -CycleOptions is a separate step: for each
    row with arrows it presses Left until the value stops changing or repeats, restores the arrival
    value, does the same with Right and restores again. Changes apply to the session only.

    Sends only Up, Down, Left and Right; never Enter, Escape or Tab. Before every key the settings
    file must still have its pre-capture SHA-256; any change stops the capture. Evidence stays
    private. Does not launch Copilot, log in, send prompts, treat the check mark as a default, or
    edit catalogs.
.PARAMETER UiHelperPath
    Path to desktop-ui-automation/scripts/windows/WindowsUi.ps1 in a canonical or active skill.
.PARAMETER WindowTitle
    Unique Windows Terminal title, fixed with --title and --suppressApplicationTitle.
.PARAMETER OutputDirectory
    Existing empty private evidence directory outside tracked repository content.
.PARAMETER ConfigPath
    Settings file to guard (normally ~/.copilot/config.json). It may be absent.
.PARAMETER MaxRows
    Upper bound on picker rows, including plan-unavailable rows.
.PARAMETER CycleOptions
    Also cycle Reasoning/Tier values on every row with arrows, as described above.
.PARAMETER Screenshots
    KeyScreens saves the opened picker once; None records text only.
.PARAMETER TimeoutSeconds
    Wait for a changed, stable screen (and a matching detail pane) after each key.
.EXAMPLE
    .\Capture-CopilotPicker.ps1 -UiHelperPath $uiHelper -WindowTitle 'Copilot catalog capture' `
        -OutputDirectory $evidenceDir -ConfigPath "$env:USERPROFILE\.copilot\config.json" -CycleOptions
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$ConfigPath,
    [ValidateRange(1,200)][int]$MaxRows = 80,
    [switch]$CycleOptions,
    [ValidateSet('KeyScreens','None')][string]$Screenshots = 'KeyScreens',
    [ValidateRange(1,30)][int]$TimeoutSeconds = 4
)
$ErrorActionPreference = 'Stop'
. $UiHelperPath
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    throw 'Create a private evidence directory before capture.'
}
if (@(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -ne 0) {
    throw 'Use a new empty evidence directory; previous captures must not be overwritten.'
}
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).ProviderPath
$ConfigPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ConfigPath)
$stepsDir = Join-Path $OutputDirectory 'steps'
$null = New-Item -ItemType Directory -Path $stepsDir
$target = Get-WindowsUiTarget -Title $WindowTitle -ProcessName 'WindowsTerminal'

$PROMPT = [string][char]0x276F; $LEFT = [string][char]0x2190; $RIGHT = [string][char]0x2192
$CHECK = [string][char]0x2713; $DASH = [string][char]0x2014; $MID = [string][char]0x00B7; $RULE = [string][char]0x2500
$BAR = [string][char]0x2503
$footer = 'enter to select'
$unavailableText = "Your plan doesn't include this model"

function Get-ConfigDigest {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { return 'absent' }
    $stream = [IO.File]::OpenRead($ConfigPath)
    try { -join ([Security.Cryptography.SHA256]::Create().ComputeHash($stream) | ForEach-Object { $_.ToString('X2') }) }
    finally { $stream.Dispose() }
}
$baselineDigest = Get-ConfigDigest
function Assert-ConfigUnchanged([string]$When) {
    if ((Get-ConfigDigest) -ne $baselineDigest) { throw "The settings file changed $When. Stop and inspect." }
}

function Read-Pane([string[]]$Lines) {
    $rules = @(for ($i = 0; $i -lt $Lines.Count; $i++) { if ($Lines[$i] -match "^\s*$RULE{20,}") { $i } })
    if ($rules.Count -lt 2) { return $null }
    $body = @($Lines[($rules[-2] + 1)..($rules[-1] - 1)] | Where-Object { $_.Trim() } | ForEach-Object { $_.Trim() })
    $pane = [ordered]@{ Title = $null; CostTier = $null; Credits = [ordered]@{}; Unavailable = $false; Text = ($body -join "`n") }
    foreach ($line in $body) {
        if ($line -match "^(.+?) $MID (\S+) cost$") { $pane.Title = $Matches[1]; $pane.CostTier = $Matches[2] }
        elseif ($line -match '^(Input|Output|Cache Read|Cache Write)\s+\.*\s*([0-9.]+)$') { $pane.Credits[$Matches[1] -replace ' ', ''] = [double]$Matches[2] }
        elseif ($line.StartsWith($unavailableText)) { $pane.Unavailable = $true }
    }
    [pscustomobject]$pane
}

function Read-Picker([string]$Text) {
    $lines = @($Text -split "`n" | ForEach-Object { $_.TrimEnd() -replace "\s*$BAR`$", '' })
    $state = [ordered]@{ Open = ($Text -match $footer); Recommended = ($Text -match 'group: recommended')
        Row = $null; Pane = (Read-Pane $lines) }
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -notmatch "^\s$PROMPT (\S.*)$" -or $line -match 'Search models') { continue }
        $parts = @($Matches[1].Trim() -split '\s{2,}')
        $label = $parts[0]; $current = $false; $default = $false
        if ($label.EndsWith(" $CHECK")) { $current = $true; $label = $label.Substring(0, $label.Length - 2) }
        if ($label.EndsWith(' (default)')) { $default = $true; $label = $label.Substring(0, $label.Length - 10) }
        $optionPart = $parts[-1]; $option = $null
        if ($optionPart -match "^$LEFT (.+) $RIGHT$") { $option = $Matches[1] }
        # From 1.0.91 a Category word (Versatile, Lightweight, Powerful) precedes the Context column.
        $rest = @($parts | Select-Object -Skip 1)
        $category = $null
        if ($rest.Count -ge 3 -and $rest[0] -match '^[A-Za-z][A-Za-z -]*$') { $category = $rest[0]; $rest = @($rest | Select-Object -Skip 1) }
        $context = @()
        if ($rest.Count -ge 2 -and $rest[0] -ne $DASH) { $context = @($rest[0] -split ' ') }
        # A group header is one indented phrase; an unfocused row has column gaps after its label.
        $group = $null
        if ($i -gt 0 -and $lines[$i - 1] -match '^ {3}(\S(?:.*\S)?)$') {
            $heading = $Matches[1]
            if ($heading -notmatch '\s{2,}') { $group = $heading }
        }
        $state.Row = [pscustomobject]@{ Label = $label; Default = $default; Current = $current
            Category = $category; Context = $context; Option = $option; Group = $group }
        break
    }
    [pscustomobject]$state
}

function Test-PaneMatches($State) {
    if (-not $State.Row -or -not $State.Pane) { return $false }
    if ($State.Pane.Unavailable) { return $true }
    if ($State.Row.Label -eq 'Auto') { return $State.Pane.Text -match 'Auto routes' }
    return $State.Pane.Title -ceq $State.Row.Label
}

$script:steps = 0
function Save-Step([string]$Name, [string]$Text) {
    $script:steps++
    $Text | Set-Content -LiteralPath (Join-Path $stepsDir ('{0:D3}-{1}.txt' -f $script:steps, $Name)) -Encoding UTF8
}
# Returns the settled screen after a key. $AllowUnchanged is for option keys at a list edge.
# After a row change the pane must also differ from the previous row's pane: plan-unavailable panes
# are identical, so a stale one would otherwise match. Identical neighbours settle at the timeout.
function Wait-Settled([string]$Before, [bool]$AllowUnchanged) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds); $after = $Before; $last = $null; $stable = $null
    $old = Read-Picker $Before
    do {
        Start-Sleep -Milliseconds 150; $last = $after; $after = Get-WindowsUiText $target
        if ($after -ceq $last) {
            $stable = $after; $new = Read-Picker $after
            $sameRow = $new.Row -and $old.Row -and $new.Row.Label -ceq $old.Row.Label
            $freshPane = $sameRow -or -not $old.Pane -or -not $new.Pane -or $new.Pane.Text -cne $old.Pane.Text
            if ($after -cne $Before -and $freshPane -and (Test-PaneMatches $new)) { return $after }
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($stable -and ($stable -cne $Before -or $AllowUnchanged)) { return $stable }
    throw 'The screen did not settle after a key. Stop and inspect.'
}
function Send-PickerKey([ValidateSet('Up','Down','Left','Right')][string]$Key) {
    Assert-ConfigUnchanged "before $Key"
    $before = Get-WindowsUiText $target
    $state = Read-Picker $before
    if (-not $state.Open -or -not $state.Recommended -or -not $state.Row) {
        throw 'The picker is not open on the recommended group. Stop and inspect.'
    }
    Send-WindowsUiKey -Target $target -Key $Key -ExpectedText $footer
    $after = Wait-Settled $before ($Key -in 'Left', 'Right')
    Save-Step $Key.ToLowerInvariant() $after
    $state = Read-Picker $after
    if (-not $state.Open -or -not $state.Row) { throw "The picker closed or lost its row after $Key. Stop and inspect." }
    $state
}

function New-RowRecord([int]$Index, $State, [string]$Group) {
    $pane = $State.Pane; $matched = Test-PaneMatches $State
    [pscustomobject]@{ Index = $Index; Group = $Group; Label = $State.Row.Label
        Default = $State.Row.Default; Current = $State.Row.Current
        Unavailable = ($matched -and $pane.Unavailable); Category = $State.Row.Category; Context = @($State.Row.Context)
        Option = $State.Row.Option; CostTier = $(if ($matched) { $pane.CostTier } else { $null })
        Credits = $(if ($matched) { $pane.Credits } else { $null }); PaneMatched = $matched }
}

Set-WindowsUiFocus $target
$opened = Get-WindowsUiText $target
$state = Read-Picker $opened
if (-not $state.Open -or -not $state.Row) { throw 'Open the Copilot /model picker and inspect it before capture.' }
if (-not $state.Recommended) { throw 'Switch the picker back to group: recommended before capture.' }
Save-Step 'opened' $opened
$screenshotCount = 0
if ($Screenshots -eq 'KeyScreens') {
    $null = Save-WindowsUiSnapshot -Target $target -OutputPrefix (Join-Path $OutputDirectory 'picker-opened')
    $screenshotCount++
}

$rows = New-Object System.Collections.ArrayList
$group = $state.Row.Group
[void]$rows.Add((New-RowRecord 1 $state $group))
while ($true) {
    if ($rows.Count -ge $MaxRows) { throw 'The list did not wrap within MaxRows. Stop and inspect.' }
    $state = Send-PickerKey 'Down'
    if ($state.Row.Label -ceq $rows[0].Label -and [string]$state.Row.Group -ceq [string]$rows[0].Group) { break }
    if ($state.Row.Group) { $group = $state.Row.Group }
    [void]$rows.Add((New-RowRecord ($rows.Count + 1) $state $group))
}
for ($i = $rows.Count - 1; $i -ge 0; $i--) {
    $state = Send-PickerKey 'Up'
    if ($state.Row.Label -cne $rows[$i].Label) {
        throw "Reverse walk expected '$($rows[$i].Label)' but found '$($state.Row.Label)'. Stop and inspect."
    }
}
$rows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'rows.json') -Encoding UTF8

function Invoke-OptionWalk([string]$Key, [string]$Label, [string]$Arrival) {
    $values = New-Object System.Collections.ArrayList; [void]$values.Add($Arrival); $end = 'limit'
    for ($n = 0; $n -lt 12; $n++) {
        $previous = $values[$values.Count - 1]
        $state = Send-PickerKey $Key
        if ($state.Row.Label -cne $Label) { throw "$Key moved off '$Label'. Stop and inspect." }
        $value = $state.Row.Option
        if ($value -ceq $previous) { $end = 'edge'; break }
        [void]$values.Add($value)
        if (@($values | Where-Object { $_ -ceq $value }).Count -gt 1) { $end = 'repeat'; break }
    }
    [pscustomobject]@{ Values = @($values); End = $end }
}
function Restore-Option([string]$Label, [string]$Arrival) {
    foreach ($key in 'Right', 'Left') {
        $state = Read-Picker (Get-WindowsUiText $target)
        for ($n = 0; $n -lt 12 -and $state.Row.Option -cne $Arrival; $n++) {
            $previous = $state.Row.Option
            $state = Send-PickerKey $key
            if ($state.Row.Option -ceq $previous) { break }
        }
        if ($state.Row.Option -ceq $Arrival) { return }
    }
    throw "Could not restore '$Label' to '$Arrival'. Stop and inspect."
}

$options = New-Object System.Collections.ArrayList
if ($CycleOptions) {
    $position = 0
    foreach ($row in $rows) {
        if (-not $row.Option -or $row.Unavailable) { continue }
        while ($position -lt $row.Index - 1) { $null = Send-PickerKey 'Down'; $position++ }
        $state = Read-Picker (Get-WindowsUiText $target)
        if ($state.Row.Label -cne $row.Label) { throw "Expected '$($row.Label)', highlighted '$($state.Row.Label)'. Stop and inspect." }
        $leftWalk = Invoke-OptionWalk 'Left' $row.Label $row.Option
        Restore-Option $row.Label $row.Option
        $rightWalk = Invoke-OptionWalk 'Right' $row.Label $row.Option
        Restore-Option $row.Label $row.Option
        $linear = $leftWalk.End -eq 'edge' -and $rightWalk.End -eq 'edge'
        $order = $null
        if ($linear) {
            $leftValues = @($leftWalk.Values); [array]::Reverse($leftValues)
            $order = @($leftValues) + @($rightWalk.Values | Select-Object -Skip 1)
        }
        [void]$options.Add([pscustomobject]@{ Index = $row.Index; Label = $row.Label; Arrival = $row.Option
            Left = @($leftWalk.Values); LeftEnd = $leftWalk.End; Right = @($rightWalk.Values); RightEnd = $rightWalk.End
            Shape = $(if ($linear) { 'linear' } else { 'irregular' }); Order = $order })
        $options | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'options.json') -Encoding UTF8
    }
    while ($position -gt 0) { $null = Send-PickerKey 'Up'; $position-- }
}
Assert-ConfigUnchanged 'during capture'
$summary = [ordered]@{
    Rows = $rows.Count
    Available = @($rows | Where-Object { -not $_.Unavailable }).Count
    Unavailable = @($rows | Where-Object Unavailable | ForEach-Object Label)
    Default = @($rows | Where-Object Default | ForEach-Object Label)
    Current = @($rows | Where-Object Current | ForEach-Object Label)
    ContextRows = @($rows | Where-Object { $_.Context.Count -eq 2 } | ForEach-Object Label)
    PaneUnmatched = @($rows | Where-Object { -not $_.PaneMatched } | ForEach-Object Label)
    Cycled = $options.Count; Irregular = @($options | Where-Object { $_.Shape -ne 'linear' } | ForEach-Object Label)
    Steps = $script:steps; Screenshots = $screenshotCount; ConfigUnchanged = $true
}
$summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'summary.json') -Encoding UTF8
$summary | ConvertTo-Json
