<#
.SYNOPSIS
    Captures visible Claude Code model rows and per-model effort levels from an open /model picker.
.DESCRIPTION
    Uses the desktop-ui-automation Windows helper. Starts at an inspected Claude Code
    "Select model" picker in a dedicated Windows Terminal window, moves across every model
    row with Up/Down, and cycles each row's effort line with Right until it returns to the
    starting level. A list longer than the picker's window scrolls: its edge rows carry
    up/down arrows and a "+N models" line counts the rows out of view, so each row is read
    while it is highlighted. Effort is one picker-wide selection, so a row that lacks the
    starting level (for example xHigh) leaves another level behind; the starting row is cycled
    back at the end. Only arrow keys are sent: Enter saves a default and "s" applies the
    session, so neither is ever used. The picker is left open at its starting row and effort.
    Screenshots/text are private evidence, not ready-to-commit fixtures. Does not launch or
    log in to Claude Code, send prompts, infer aliases/defaults, or edit catalogs.
.PARAMETER UiHelperPath
    Path to desktop-ui-automation/scripts/windows/WindowsUi.ps1 in a canonical or active skill.
.PARAMETER WindowTitle
    Unique Windows Terminal title, fixed with --title and --suppressApplicationTitle.
.PARAMETER OutputDirectory
    Existing empty private evidence directory outside tracked repository content.
.PARAMETER ConfigPath
    Settings file that the picker would write (normally ~/.claude/settings.json). SHA-256 is
    checked from helper start; hash it separately before launch to cover startup too.
.PARAMETER ExpectedModelCount
    Number of rows independently observed for this account, compared with the visible rows plus
    the picker's out-of-view count. It does not prove completeness.
.PARAMETER MaxEffortLevels
    Upper bound on Right presses per row before the cycle is declared incomplete.
.PARAMETER Screenshots
    KeyScreens saves the model list plus each row's default-marked (or first) effort screen,
    All saves every step, and None records text only.
.EXAMPLE
    .\Capture-ClaudePicker.ps1 -UiHelperPath $uiHelper -WindowTitle 'Catalog capture' `
        -OutputDirectory $evidenceDir -ConfigPath "$env:USERPROFILE\.claude\settings.json" `
        -ExpectedModelCount 5
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$ConfigPath,
    [Parameter(Mandatory)][ValidateRange(1,50)][int]$ExpectedModelCount,
    [ValidateRange(2,20)][int]$MaxEffortLevels = 12,
    [ValidateSet('KeyScreens','All','None')][string]$Screenshots = 'KeyScreens'
)
$ErrorActionPreference = 'Stop'
. $UiHelperPath
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
    throw 'Create a private evidence directory before capture.'
}
if (@(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -ne 0) {
    throw 'Use a new empty evidence directory; previous captures must not be overwritten.'
}
$baseline = (Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash
$target = Get-WindowsUiTarget -Title $WindowTitle -ProcessName WindowsTerminal
Assert-WindowsUiFocus $target

# Claude Code renders the prompt/highlight glyph U+276F followed by a no-break space, so
# separators use \s rather than a literal space. A scrolled list marks its edge rows with
# U+2191/U+2193 in the same column and counts out-of-view rows as "U+2026 +N models".
$heading = 'Select model'
$footerPattern = '(?m)^[ \t]*Enter to set as default\b[^\r\n]*Esc to cancel'
$rowPattern = '(?m)^[ \t]*(?:[\u276F\u2191\u2193]\s)?(?<index>\d+)\.\s(?<rest>[^\r\n]+)'
$hiddenPattern = '^\u2026\s\+(?<count>\d+)\s+models?$'
$highlightPattern = '(?m)^[ \t]*\u276F\s(?<index>\d+)\.\s'
$effortPattern = '^(?<glyph>\S)\s+(?<level>.+?) effort(?<default> \(default\))?\s+\u2190/\u2192 to adjust$'
$unsupportedPattern = '^(?<glyph>\S)\s+Effort not supported\b.*$'
$captureCount = 0
$imageCount = 0
$captured = @()

function Get-PickerRegion([string]$Text) {
    $start = $Text.LastIndexOf($heading)
    if ($start -lt 0) { throw 'Claude model picker is not visible.' }
    $region = $Text.Substring($start)
    if ($region -notmatch $footerPattern) { throw 'Picker footer is not visible; the menu may be truncated.' }
    return $region
}

function Read-Picker([string]$Text) {
    $region = Get-PickerRegion $Text
    $rows = [regex]::Matches($region, $rowPattern)
    if ($rows.Count -eq 0) { throw 'No model rows are visible.' }
    $highlight = [regex]::Matches($region, $highlightPattern)
    if ($highlight.Count -ne 1) { throw 'Picker highlight is ambiguous.' }
    $first = [int]$rows[0].Groups['index'].Value
    for ($i=0; $i -lt $rows.Count; $i++) {
        if ([int]$rows[$i].Groups['index'].Value -ne $first + $i) { throw 'Visible model rows are incomplete or out of order.' }
    }
    $footer = [regex]::Match($region, $footerPattern)
    $lastRow = $rows[$rows.Count - 1]
    $blockStart = $lastRow.Index + $lastRow.Length
    $block = $region.Substring($blockStart, $footer.Index - $blockStart)
    $allLines = @($block -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $hiddenLines = @($allLines | Where-Object { $_ -match $hiddenPattern })
    if ($hiddenLines.Count -gt 1) { throw 'Out-of-view row count is ambiguous.' }
    $hidden = if ($hiddenLines.Count -eq 1) { [int][regex]::Match($hiddenLines[0], $hiddenPattern).Groups['count'].Value } else { 0 }
    $lines = @($allLines | Where-Object { $_ -notmatch $hiddenPattern })
    if ($lines.Count -eq 0) { throw 'No effort line is visible for the highlighted row.' }
    $effort = [regex]::Match($lines[0], $effortPattern)
    $unsupported = [regex]::Match($lines[0], $unsupportedPattern)
    [pscustomobject]@{
        Rows = $rows
        Total = $rows.Count + $hidden
        Highlight = [int]$highlight[0].Groups['index'].Value
        EffortBlock = ($lines -join "`n")
        EffortLine = $lines[0]
        EffortDetail = @($lines | Select-Object -Skip 1)
        Level = if ($effort.Success) { $effort.Groups['level'].Value } else { $null }
        IsDefault = $effort.Success -and $effort.Groups['default'].Success
        Adjustable = $effort.Success
        Unsupported = $unsupported.Success
    }
}

function Save-Picker([string]$Name, [bool]$KeyScreen = $false) {
    $prefix = Join-Path $OutputDirectory $Name
    if ($Screenshots -eq 'All' -or ($Screenshots -eq 'KeyScreens' -and $KeyScreen)) {
        $text = (Save-WindowsUiSnapshot $target -OutputPrefix $prefix).Text
        $script:imageCount++
    } else {
        Assert-WindowsUiFocus $target
        $text = Get-WindowsUiText $target
        $text | Set-Content -LiteralPath ($prefix + '.txt') -Encoding UTF8
    }
    $script:captureCount++
    return $text
}

function Wait-PickerChange([string]$PreviousBlock, [int]$PreviousHighlight) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds(3000)
    do {
        Start-Sleep -Milliseconds 120
        Assert-WindowsUiFocus $target
        $state = Read-Picker (Get-WindowsUiText $target)
        if ($state.EffortBlock -cne $PreviousBlock -or $state.Highlight -ne $PreviousHighlight) { return $state }
    } while ([DateTime]::UtcNow -lt $deadline)
    return $null
}

function Move-Picker([int]$Destination) {
    for ($step=0; $step -lt 55; $step++) {
        $state = Read-Picker (Get-WindowsUiText $target)
        if ($state.Highlight -eq $Destination) { return $state }
        $next = $state.Highlight + [Math]::Sign($Destination - $state.Highlight)
        $key = if ($Destination -gt $state.Highlight) { 'Down' } else { 'Up' }
        Send-WindowsUiKey $target -Key $key -ExpectedText ('(?m)^[ \t]*\u276F\s' + $state.Highlight + '\.\s')
        $null = Wait-WindowsUiText $target -ExpectedText ('(?m)^[ \t]*\u276F\s' + $next + '\.\s')
    }
    throw 'Picker navigation exceeded its bound.'
}

function Assert-ConfigUnchanged([string]$When) {
    if ((Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash -ne $baseline) {
        throw "Config changed $When. Stop; do not overwrite possible concurrent edits."
    }
}

try {
    $initialText = Save-Picker 'models' $true
    $initial = Read-Picker $initialText
    if ($initial.Total -ne $ExpectedModelCount) { throw 'Visible plus out-of-view model count differs from expected coverage.' }
    for ($index=1; $index -le $initial.Total; $index++) {
        # Read each row while highlighted: a scrolled list shows only part of the rows at once.
        $state = Move-Picker $index
        if ($state.Total -ne $initial.Total) { throw 'Model count changed while scrolling.' }
        $row = @($state.Rows | Where-Object { [int]$_.Groups['index'].Value -eq $index })
        if ($row.Count -ne 1) { throw "Model row $index is not uniquely visible." }
        $columns = $row[0].Groups['rest'].Value.Trim() -split '[ \t]{2,}', 2
        $rawLabel = $columns[0].Trim()
        $current = $rawLabel.EndsWith([string][char]0x2714)
        $label = $rawLabel.TrimEnd([char]0x2714).Trim()
        $prefix = 'model-' + $index.ToString('D2')
        $null = Save-Picker ($prefix + '-effort-01')
        $levels = @([pscustomobject]@{ Line=$state.EffortLine; Level=$state.Level; Default=$state.IsDefault; Detail=$state.EffortDetail })
        $defaultSaved = $false
        if ($state.IsDefault -or -not $state.Adjustable) {
            $null = Save-Picker ($prefix + '-effort-key') $true
            $defaultSaved = $true
        }
        $cycleComplete = -not $state.Adjustable
        if ($state.Adjustable) {
            $startBlock = $state.EffortBlock
            for ($press=1; $press -le $MaxEffortLevels; $press++) {
                Send-WindowsUiKey $target -Key Right -ExpectedText ('(?m)^[ \t]*\u276F\s' + $index + '\.\s')
                $changed = Wait-PickerChange $state.EffortBlock $index
                if ($null -eq $changed) { break }
                if ($changed.Highlight -ne $index) { throw 'Effort adjustment moved the model highlight.' }
                $state = $changed
                if ($state.EffortBlock -ceq $startBlock) { $cycleComplete = $true; break }
                $null = Save-Picker ($prefix + '-effort-' + ($press + 1).ToString('D2'))
                $levels += [pscustomobject]@{ Line=$state.EffortLine; Level=$state.Level; Default=$state.IsDefault; Detail=$state.EffortDetail }
                if ($state.IsDefault -and -not $defaultSaved) {
                    $null = Save-Picker ($prefix + '-effort-key') $true
                    $defaultSaved = $true
                }
            }
        }
        if (-not $defaultSaved) { $null = Save-Picker ($prefix + '-effort-key') $true }
        Assert-ConfigUnchanged 'during capture'
        $captured += [pscustomobject]@{
            Index=$index; Label=$label; Current=$current
            Description=$(if ($columns.Count -gt 1) { $columns[1].Trim() } else { '' })
            Unsupported=$levels[0].Line -match $unsupportedPattern
            CycleComplete=$cycleComplete
            EffortCycle=$levels
        }
    }
    $final = Move-Picker $initial.Highlight
    for ($press=1; $press -le $MaxEffortLevels -and $final.Adjustable -and $final.EffortBlock -cne $initial.EffortBlock; $press++) {
        Send-WindowsUiKey $target -Key Right -ExpectedText ('(?m)^[ \t]*\u276F\s' + $initial.Highlight + '\.\s')
        $changed = Wait-PickerChange $final.EffortBlock $initial.Highlight
        if ($null -eq $changed -or $changed.Highlight -ne $initial.Highlight) { break }
        $final = $changed
    }
    if ($final.EffortBlock -cne $initial.EffortBlock) { throw 'Starting effort was not restored on the starting row.' }
    $null = Save-Picker 'models-returned'
    Assert-ConfigUnchanged 'before final verification'
    [pscustomobject]@{
        CapturedModels=$captured; TextCaptures=$captureCount; Screenshots=$imageCount; ConfigUnchanged=$true
        Scope='visible Windows Terminal picker; aliases and account completeness require independent evidence'
        Completeness='Effort order is the Right-key cycle from each row''s starting level; reconcile with screenshots'
    } | ConvertTo-Json -Depth 6
} catch {
    try { $null = Save-Picker 'stopped-state' $true } catch { }
    throw
} finally {
    if ((Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash -ne $baseline) {
        Write-Warning 'The config digest changed; capture did not restore or overwrite it.'
    }
}
