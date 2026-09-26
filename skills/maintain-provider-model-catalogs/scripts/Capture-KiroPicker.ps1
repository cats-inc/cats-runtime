<#
.SYNOPSIS
    Captures Kiro CLI /model rows and each row's settings-panel option rings from an open picker.
.DESCRIPTION
    Uses the desktop-ui-automation Windows helper. Starts at an inspected Kiro "Select model:"
    picker in a dedicated single-pane Windows Terminal window, with the model list focused, the
    search empty and the first row highlighted. Moves down every row and reads its raw id, credit
    rate, description, [active] marker and settings panel while it is highlighted. For each
    requested axis (effort, thinking) that the panel shows with a value other than n/a, Tab enters
    the panel and Right cycles that axis until a value repeats; Tab then returns to the list.
    Finally Up walks back to the first row and checks that both directions give the same order.

    Only Up, Down, Right and Tab are sent. Enter selects a model and Escape closes the picker, so
    neither is ever sent; the picker is left open at its first row. The platform Send-WindowsUiKey
    has no Tab, so Tab uses the same helper's focus, screen and focused-surface guards before its
    key primitive.

    Kiro persists every settings-panel toggle to its settings file without Enter. Before the first
    key this helper copies that file into the evidence directory and records its SHA-256 in
    config-state.json. Before every key the file must still match the last digest the helper
    observed; any other change stops the capture. The helper never restores while Kiro runs:
    after the owned Kiro exits, run Restore-KiroPickerConfig.ps1 with config-state.json.

    Evidence stays private. Does not launch Kiro, type /model, log in, send prompts, interpret
    [active] or unset values as defaults, or edit catalogs.
.PARAMETER UiHelperPath
    Path to desktop-ui-automation/scripts/windows/WindowsUi.ps1 in a canonical or active skill.
.PARAMETER WindowTitle
    Unique Windows Terminal title, fixed with --title and --suppressApplicationTitle.
.PARAMETER OutputDirectory
    Existing empty private evidence directory outside tracked repository content.
.PARAMETER ConfigPath
    Settings file the picker writes (normally ~/.kiro/settings/cli.json). It may be absent.
.PARAMETER ExpectedModelCount
    Rows independently listed by `kiro-cli chat --list-models`, compared with the visible rows plus
    the picker's "(+N more)" count. It does not prove account completeness.
.PARAMETER Axes
    Comma-separated settings rows to cycle, in order. Default "effort,thinking". An empty string
    reads rows and panels only, sends no Right or Tab, and leaves the settings file untouched.
.PARAMETER MaxValues
    Upper bound on Right presses per axis before the ring is declared incomplete.
.PARAMETER Screenshots
    KeyScreens saves the first list screen plus each cycled row's settings panel on entry, All
    saves every step, and None records text only.
.PARAMETER SettleMilliseconds
    Interval between the two equal settings-file digests that end a toggle's write.
.EXAMPLE
    .\Capture-KiroPicker.ps1 -UiHelperPath $uiHelper -WindowTitle 'Kiro catalog capture' `
        -OutputDirectory $evidenceDir -ConfigPath "$env:USERPROFILE\.kiro\settings\cli.json" `
        -ExpectedModelCount 20
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$ConfigPath,
    [Parameter(Mandatory)][ValidateRange(1,100)][int]$ExpectedModelCount,
    [string]$Axes = 'effort,thinking',
    [ValidateRange(2,20)][int]$MaxValues = 12,
    [ValidateSet('KeyScreens','All','None')][string]$Screenshots = 'KeyScreens',
    [ValidateRange(20,2000)][int]$SettleMilliseconds = 250
)
$ErrorActionPreference = 'Stop'
. $UiHelperPath
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    throw 'Create a private evidence directory before capture.'
}
if (@(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -ne 0) {
    throw 'Use a new empty evidence directory; previous captures must not be overwritten.'
}
$axisList = @($Axes -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($axis in $axisList) {
    if ($axis -cnotmatch '^[a-z][a-z_-]*$') { throw "Invalid settings axis '$axis'." }
}
if (@($axisList | Sort-Object -Unique).Count -ne $axisList.Count) { throw 'Axes must not repeat.' }
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).ProviderPath
$ConfigPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($ConfigPath)
$stepsDir = Join-Path $OutputDirectory 'steps'
$statePath = Join-Path $OutputDirectory 'config-state.json'

function Get-ConfigDigest {
    if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
        return (Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash
    }
    return 'absent'
}

# Back up before the first key. The backup and state stay in the private evidence directory.
$baselineDigest = Get-ConfigDigest
$backupRelative = $null
if ($baselineDigest -ne 'absent') {
    $backupDir = Join-Path $OutputDirectory 'config-backup'
    $null = New-Item -ItemType Directory -Path $backupDir
    $backupRelative = 'config-backup/' + (Split-Path -Leaf $ConfigPath)
    $backupPath = Join-Path $backupDir (Split-Path -Leaf $ConfigPath)
    Copy-Item -LiteralPath $ConfigPath -Destination $backupPath
    if ((Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash -ne $baselineDigest) {
        throw 'The settings file changed while it was being backed up. Stop and inspect.'
    }
}
$null = New-Item -ItemType Directory -Path $stepsDir
$script:lastDigest = $baselineDigest
$script:toggles = 0
$script:textCount = 0
$script:images = @()

function Save-ConfigState([string]$Status) {
    [ordered]@{
        schema = 'cats.kiro-picker-config-state/1'
        configPath = $ConfigPath
        windowTitle = $WindowTitle
        baselineExists = ($baselineDigest -ne 'absent')
        baselineDigest = $baselineDigest
        backupFile = $backupRelative
        lastObservedDigest = $script:lastDigest
        toggles = $script:toggles
        status = $Status
        updatedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Assert-ConfigAsObserved([string]$When) {
    if ((Get-ConfigDigest) -ne $script:lastDigest) {
        throw "The settings file changed $When without a toggle by this helper. Stop; do not overwrite possible concurrent edits."
    }
}

function Wait-ConfigSettled {
    $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(2000, 8 * $SettleMilliseconds))
    Start-Sleep -Milliseconds $SettleMilliseconds
    $previous = Get-ConfigDigest
    do {
        Start-Sleep -Milliseconds $SettleMilliseconds
        $current = Get-ConfigDigest
        if ($current -eq $previous) { return $current }
        $previous = $current
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The settings file kept changing after a toggle. Stop and inspect.'
}

Save-ConfigState 'started'
$target = Get-WindowsUiTarget -Title $WindowTitle -ProcessName WindowsTerminal
Assert-WindowsUiFocus $target

# Kiro 2.24.1 layout: "Select model:" heading, rows, "(+N more)", a U+2500 rule, the settings
# panel, a rule, then the footer. U+276F marks the highlighted list row or settings row.
$headingPattern = '(?m)^[ \t]*Select model:'
$emptySearchPattern = '^[ \t]*Select model:\s+type to search$'
$rulePattern = '^\u2500{10,}'
$rowPattern = '^(?<mark>\u276F| ) (?<id>\S+) {2,}(?<rate>\d+(?:\.\d+)?x credits) {2,}(?<desc>.*?)\s*$'
$morePattern = '^\(\+(?<count>\d+) more\)$'
$headerPattern = '^[ \t]*Settings for (?:selected )?model: (?<id>\S+)'
$panelPattern = '^(?<mark>\u276F| ) (?<axis>[a-z][a-z_-]*) {2,}(?<value>\S+) {2,}(?<desc>.*?)\s*$'
$listFooterPattern = '^[ \t]*esc to close\s\u00B7.*\u21B5 to select\s\u00B7\s*tab to switch panels$'
$settingsFooterPattern = '^[ \t]*esc to close\s\u00B7.*\u2190\u2192 to toggle\s\u00B7\s*\u21B5 back to models\b'

function Read-KiroPicker([string]$Text) {
    $headings = [regex]::Matches($Text, $headingPattern)
    if ($headings.Count -eq 0) { throw 'Kiro model picker is not visible.' }
    $lines = @($Text.Substring($headings[$headings.Count - 1].Index) -split '\r?\n' |
        ForEach-Object { $_.TrimEnd() })
    if ($lines[0] -notmatch $emptySearchPattern) { throw 'The picker search is not empty; the list may be filtered.' }
    $sections = @()
    $current = @()
    foreach ($line in ($lines | Select-Object -Skip 1)) {
        if ($line -match $rulePattern) { $sections += , $current; $current = @() } else { $current += $line }
    }
    $sections += , $current
    if ($sections.Count -lt 3) { throw 'The settings panel or footer is not visible.' }

    $rows = @()
    $more = 0
    foreach ($line in @($sections[0] | Where-Object { $_.Trim() })) {
        $row = [regex]::Match($line, $rowPattern)
        $moreLine = [regex]::Match($line.Trim(), $morePattern)
        if ($row.Success) {
            $desc = $row.Groups['desc'].Value
            $active = $desc.EndsWith(' [active]')
            if ($active) { $desc = $desc.Substring(0, $desc.Length - ' [active]'.Length) }
            $rows += [pscustomobject]@{
                Id = $row.Groups['id'].Value; Rate = $row.Groups['rate'].Value
                Description = $desc; Active = $active; Marked = $row.Groups['mark'].Value -ne ' '
            }
        } elseif ($moreLine.Success) {
            $more = [int]$moreLine.Groups['count'].Value
        } else {
            throw "Unexpected line in the model list: $line"
        }
    }
    if ($rows.Count -eq 0) { throw 'No model rows are visible.' }

    $settingsLines = @($sections[1] | Where-Object { $_.Trim() })
    $header = if ($settingsLines.Count) { [regex]::Match($settingsLines[0], $headerPattern) } else { $null }
    if (-not $header -or -not $header.Success) { throw 'The settings panel header is not visible.' }
    $panel = @()
    foreach ($line in ($settingsLines | Select-Object -Skip 1)) {
        $item = [regex]::Match($line, $panelPattern)
        if (-not $item.Success) { throw "Unexpected line in the settings panel: $line" }
        $panel += [pscustomobject]@{
            Axis = $item.Groups['axis'].Value; Value = $item.Groups['value'].Value
            Description = $item.Groups['desc'].Value; Marked = $item.Groups['mark'].Value -ne ' '
        }
    }
    $footer = @($sections[2] | Where-Object { $_.Trim() } | Select-Object -First 1)
    $focus = if ($footer.Count -and $footer[0] -match $listFooterPattern) { 'list' }
        elseif ($footer.Count -and $footer[0] -match $settingsFooterPattern) { 'settings' }
        else { throw 'The picker footer is not visible or not recognized.' }

    $markedRows = @($rows | Where-Object Marked)
    $markedPanel = @($panel | Where-Object Marked)
    if ($focus -eq 'list' -and ($markedRows.Count -ne 1 -or $markedPanel.Count -ne 0 -or
        $markedRows[0].Id -cne $header.Groups['id'].Value)) {
        throw 'List highlight and settings header disagree or are ambiguous.'
    }
    if ($focus -eq 'settings' -and ($markedRows.Count -ne 0 -or $markedPanel.Count -ne 1)) {
        throw 'Settings highlight is ambiguous.'
    }
    [pscustomobject]@{
        Rows = $rows; More = $more; HeaderId = $header.Groups['id'].Value
        Panel = $panel; Focus = $focus
        MarkedId = $(if ($markedRows.Count) { $markedRows[0].Id } else { $null })
        MarkedAxis = $(if ($markedPanel.Count) { $markedPanel[0].Axis } else { $null })
    }
}

function Get-AxisRow($State, [string]$Axis) {
    $found = @($State.Panel | Where-Object { $_.Axis -ceq $Axis })
    if ($found.Count -gt 1) { throw "Settings axis '$Axis' is listed twice." }
    if ($found.Count -eq 1) { return $found[0] }
    return $null
}

function Get-PanelValues($State) {
    @($State.Panel | ForEach-Object { $_.Axis + '=' + $_.Value })
}

function Wait-KiroState {
    param([string]$Focus, [string]$HeaderId, [string]$NotHeaderId, [string]$MarkedAxis,
        [string]$Axis, [string]$NotValue, [string]$What)
    $deadline = [DateTime]::UtcNow.AddMilliseconds(4000)
    do {
        Start-Sleep -Milliseconds 100
        Assert-WindowsUiFocus $target
        try { $state = Read-KiroPicker (Get-WindowsUiText $target) } catch { $state = $null }
        if ($state -and $state.Focus -eq $Focus -and
            (-not $HeaderId -or $state.HeaderId -ceq $HeaderId) -and
            (-not $NotHeaderId -or $state.HeaderId -cne $NotHeaderId) -and
            (-not $MarkedAxis -or $state.MarkedAxis -ceq $MarkedAxis)) {
            if (-not $Axis) { return $state }
            $row = Get-AxisRow $state $Axis
            if ($row -and $row.Value -cne $NotValue) { return $state }
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Expected $What did not appear; do not resend the key."
}

function Get-Guard([string]$Id, [string]$Focus, [string]$Axis, [string]$Value) {
    $guard = '(?ms)(?=.*^[ \t]*Settings for (?:selected )?model: ' + [regex]::Escape($Id) + '\s)'
    if ($Focus -eq 'list') {
        $guard += '(?=.*^\u276F ' + [regex]::Escape($Id) + ' )(?=.*\u21B5 to select)'
    } else {
        $guard += '(?=.*\u2190\u2192 to toggle)'
    }
    if ($Axis) { $guard += '(?=.*^\u276F ' + [regex]::Escape($Axis) + ' +' + [regex]::Escape($Value) + ' )' }
    return $guard
}

function Send-KiroKey([string]$Key, [string]$Guard) {
    if ($Key -eq 'Tab') {
        Assert-WindowsUiFocus $target
        if ((Get-WindowsUiText $target) -notmatch $Guard) { throw 'Expected screen was not observed; no key was sent.' }
        Assert-WindowsUiInputState $target (Get-WindowsUiInputState $target)
        Invoke-WindowsUiKeyInput -Code ([uint16]9) -Control $false
    } elseif (@('Up', 'Down', 'Right') -ccontains $Key) {
        Send-WindowsUiKey $target -Key $Key -ExpectedText $Guard
    } else {
        throw "Key '$Key' is not permitted by the Kiro picker helper."
    }
}

function Save-Step([string]$Name, [bool]$KeyScreen = $false) {
    $prefix = Join-Path $stepsDir (($script:textCount + 1).ToString('D3') + '-' + $Name)
    if ($Screenshots -eq 'All' -or ($Screenshots -eq 'KeyScreens' -and $KeyScreen)) {
        $snap = Save-WindowsUiSnapshot $target -OutputPrefix $prefix
        $script:images += [pscustomobject]@{ Name = (Split-Path -Leaf $snap.Image); Bounds = $snap.Bounds }
        $text = $snap.Text
    } else {
        Assert-WindowsUiFocus $target
        $text = Get-WindowsUiText $target
        $text | Set-Content -LiteralPath ($prefix + '.txt') -Encoding UTF8
    }
    $script:textCount++
    return $text
}

function Invoke-AxisCycle([string]$Id, [string]$Axis, [string]$Tag) {
    $state = Read-KiroPicker (Get-WindowsUiText $target)
    $start = Get-AxisRow $state $Axis
    if (-not $start -or $start.Value -eq 'n/a') {
        return [pscustomobject]@{ Axis = $Axis; Start = $(if ($start) { $start.Value } else { $null })
            Skipped = 'not selectable in the settings panel'; Cycle = @(); Sequence = @() }
    }
    for ($move = 0; $state.MarkedAxis -cne $Axis; $move++) {
        if ($move -ge 3) { throw "Could not highlight '$Axis' for $Id." }
        $names = @($state.Panel | ForEach-Object { $_.Axis })
        $key = if ([array]::IndexOf($names, $Axis) -gt [array]::IndexOf($names, $state.MarkedAxis)) { 'Down' } else { 'Up' }
        Send-KiroKey $key (Get-Guard $Id 'settings')
        $state = Wait-KiroState -Focus settings -HeaderId $Id -MarkedAxis $Axis -What "$Axis row"
    }
    $start = Get-AxisRow $state $Axis
    $sequence = @([pscustomobject]@{ Value = $start.Value; Description = $start.Description; Panel = @(Get-PanelValues $state) })
    $values = @($start.Value)
    $repeat = $null
    for ($press = 1; $press -le $MaxValues; $press++) {
        $previous = $values[$values.Count - 1]
        Assert-ConfigAsObserved "before toggling $Axis on $Id"
        Send-KiroKey Right (Get-Guard $Id 'settings' $Axis $previous)
        $state = Wait-KiroState -Focus settings -HeaderId $Id -MarkedAxis $Axis -Axis $Axis -NotValue $previous -What "next $Axis value"
        $script:toggles++
        $script:lastDigest = Wait-ConfigSettled
        Save-ConfigState 'capturing'
        $null = Save-Step ("$Tag-$Axis-" + $press.ToString('D2'))
        $row = Get-AxisRow $state $Axis
        $sequence += [pscustomobject]@{ Value = $row.Value; Description = $row.Description; Panel = @(Get-PanelValues $state) }
        if ($values -ccontains $row.Value) { $repeat = $row.Value; break }
        $values += $row.Value
    }
    if ($null -eq $repeat) { throw "'$Axis' on $Id did not repeat within $MaxValues values." }
    $first = [array]::IndexOf($values, $repeat)
    [pscustomobject]@{
        Axis = $Axis; Start = $start.Value; StartInCycle = ($first -eq 0)
        Cycle = @($values[$first..($values.Count - 1)]); Sequence = $sequence; EndValue = $repeat
    }
}

$captured = @()
try {
    $state = Read-KiroPicker (Save-Step 'models' $true)
    if ($state.Focus -ne 'list') { throw 'Start with the model list focused.' }
    if (-not $state.Rows[0].Marked) { throw 'Start with the first visible row highlighted.' }
    $total = $state.Rows.Count + $state.More
    if ($total -ne $ExpectedModelCount) {
        throw "Visible plus (+N more) rows ($total) differ from expected coverage ($ExpectedModelCount)."
    }
    $seen = @{}
    for ($index = 1; $index -le $total; $index++) {
        if ($index -gt 1) {
            $previousId = $captured[$captured.Count - 1].Id
            Assert-ConfigAsObserved 'before moving to the next row'
            Send-KiroKey Down (Get-Guard $previousId 'list')
            $state = Wait-KiroState -Focus list -NotHeaderId $previousId -What 'next model row'
        }
        Assert-ConfigAsObserved 'after moving rows'
        $row = @($state.Rows | Where-Object Marked)[0]
        if ($seen.ContainsKey($row.Id)) { throw "Row '$($row.Id)' repeated; the list wrapped or differs from the expected count." }
        $seen[$row.Id] = $index
        $tag = 'row-' + $index.ToString('D2')
        $null = Save-Step $tag
        $arrival = @($state.Panel | ForEach-Object {
            [pscustomobject]@{ Axis = $_.Axis; Value = $_.Value; Description = $_.Description } })
        $toCycle = @($axisList | Where-Object { $axisRow = Get-AxisRow $state $_; $axisRow -and $axisRow.Value -ne 'n/a' })
        $cycles = @()
        if ($toCycle.Count -gt 0) {
            Assert-ConfigAsObserved "before entering settings for $($row.Id)"
            Send-KiroKey Tab (Get-Guard $row.Id 'list')
            $null = Wait-KiroState -Focus settings -HeaderId $row.Id -What 'settings panel'
            $null = Save-Step ($tag + '-settings') $true
            foreach ($axis in $toCycle) { $cycles += Invoke-AxisCycle $row.Id $axis $tag }
            Send-KiroKey Tab (Get-Guard $row.Id 'settings')
            $state = Wait-KiroState -Focus list -HeaderId $row.Id -What 'model list'
        }
        $captured += [pscustomobject]@{
            Index = $index; Id = $row.Id; Rate = $row.Rate; Description = $row.Description
            Active = $row.Active; Arrival = $arrival; Cycles = $cycles
        }
    }
    for ($index = $total - 1; $index -ge 1; $index--) {
        $fromId = $captured[$index].Id
        $toId = $captured[$index - 1].Id
        Assert-ConfigAsObserved 'while returning to the first row'
        Send-KiroKey Up (Get-Guard $fromId 'list')
        $state = Wait-KiroState -Focus list -NotHeaderId $fromId -What 'previous model row'
        if ($state.HeaderId -cne $toId) {
            throw "Up from '$fromId' reached '$($state.HeaderId)', expected '$toId'; order differs by direction."
        }
    }
    $null = Save-Step 'models-returned'
    Assert-ConfigAsObserved 'before final verification'
    $restoreRequired = $script:lastDigest -ne $baselineDigest
    Save-ConfigState $(if ($restoreRequired) { 'restore-required' } else { 'unchanged' })
    $result = [pscustomobject]@{
        Rows = $captured
        ExpectedModelCount = $ExpectedModelCount
        OrderCheckedBothDirections = $true
        TextCaptures = $script:textCount
        Screenshots = $script:images.Count
        Images = $script:images
        Toggles = $script:toggles
        ConfigChanged = $restoreRequired
        RestoreRequired = $restoreRequired
        StateFile = 'config-state.json'
        Scope = 'This Windows Terminal picker, installation and account only; not WSL or other accounts.'
        Defaults = 'No default is interpreted: [active] marks the current selection and "default" is the unset state.'
        Completeness = 'Row count checked against ExpectedModelCount. Each Sequence is the Right-key order from the start value; derive linear order from the wrap point.'
    }
    $json = $result | ConvertTo-Json -Depth 8
    $json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'capture-result.json') -Encoding UTF8
    $json
} catch {
    try { $null = Save-Step 'stopped-state' $true } catch { }
    try { Save-ConfigState 'stopped' } catch { }
    throw
} finally {
    if ((Get-ConfigDigest) -ne $baselineDigest) {
        Write-Warning ('Kiro rewrote its settings file during capture. After the owned Kiro exits, ' +
            'run Restore-KiroPickerConfig.ps1 with config-state.json.')
    }
}
