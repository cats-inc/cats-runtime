<#
.SYNOPSIS
    Captures visible Codex model/effort menus from an already-open Windows Terminal picker.
.DESCRIPTION
    Uses the desktop-ui-automation Windows helper. Starts at /model, navigates each
    observed model and optional More reasoning submenu, and cancels back without selecting
    a final effort. Screenshots/text are private evidence, not ready-to-commit fixtures.
    Does not launch/login to Codex, send prompts, infer raw IDs/defaults, or edit catalogs.
    Inspect the terminal and footer first. Unexpected prompts, focus changes and missing
    rows stop the capture; no input is replayed to recover automatically.
.PARAMETER UiHelperPath
    Path to desktop-ui-automation/scripts/windows/WindowsUi.ps1 in a canonical or active skill.
.PARAMETER WindowTitle
    Unique Windows Terminal title, fixed with --title and --suppressApplicationTitle.
.PARAMETER OutputDirectory
    Existing empty private evidence directory outside tracked repository content.
.PARAMETER ConfigPath
    Config for the actual launched Codex home/profile. SHA-256 is checked from helper start;
    separately hash before launch to check startup too. Contents are not copied or logged.
.PARAMETER ExpectedModelCount
    Number independently established for this account's visible list. This check alone does
    not prove catalog completeness; reconcile with screenshots and CLI enumeration.
.PARAMETER Screenshots
    KeyScreens saves model-list and option-menu images, All includes navigation steps, and
    None records visible text only. Use None only after validating text/visual correspondence.
.EXAMPLE
    .\Capture-CodexPicker.ps1 -UiHelperPath $uiHelper -WindowTitle 'Catalog pilot' `
        -OutputDirectory $evidenceDir -ConfigPath $codexConfig -ExpectedModelCount 7
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$ConfigPath,
    [Parameter(Mandatory)][ValidateRange(1,50)][int]$ExpectedModelCount,
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
$modelHeading = '(?m)^[ \t]*Select Model and Effort[ \t]*\r?$'
$rowPattern = '(?m)^[ \t]*(?:\u203a[ \t]*)?(?<index>\d+)\.[ \t]+(?<rest>[^\r\n]+)'
$highlightPattern = '(?m)^[ \t]*\u203a[ \t]+(?<index>\d+)\.'
$captureCount = 0
$imageCount = 0
$captured = @()

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

function Step-Picker([string]$Key, [string]$Before, [string]$After) {
    Send-WindowsUiKey $target -Key $Key -ExpectedText $Before
    $null = Wait-WindowsUiText $target -ExpectedText $After
}

function Move-Picker([int]$Destination, [string]$Heading) {
    for ($step=0; $step -lt 55; $step++) {
        $text = Get-WindowsUiText $target
        if ($text -notmatch $Heading) { throw 'Picker context changed during navigation.' }
        $selected = [regex]::Matches($text, $highlightPattern)
        if ($selected.Count -ne 1) { throw 'Picker highlight is ambiguous.' }
        $position = [int]$selected[0].Groups['index'].Value
        if ($position -eq $Destination) { return }
        $next = $position + [Math]::Sign($Destination - $position)
        $key = if ($Destination -gt $position) { 'Down' } else { 'Up' }
        Step-Picker $key $Heading ('(?m)^[ \t]*\u203a[ \t]+' + $next + '\.')
    }
    throw 'Picker navigation exceeded its bound.'
}

try {
    $initial = Save-Picker 'models' $true
    if ($initial -notmatch $modelHeading) { throw 'Open and inspect /model before running capture.' }
    $rows = [regex]::Matches($initial, $rowPattern)
    if ($rows.Count -ne $ExpectedModelCount) { throw 'Visible model count differs from expected coverage.' }
    $initialSelection = [regex]::Matches($initial, $highlightPattern)
    if ($initialSelection.Count -ne 1) { throw 'Initial model highlight is ambiguous.' }
    for ($i=0; $i -lt $rows.Count; $i++) {
        if ([int]$rows[$i].Groups['index'].Value -ne $i + 1) { throw 'Visible model rows are incomplete or out of order.' }
    }
    foreach ($row in $rows) {
        $index = [int]$row.Groups['index'].Value
        $rawLabel = ($row.Groups['rest'].Value -split '[ \t]{2,}', 2)[0].Trim()
        $label = $rawLabel -replace ' \((current|default)\)$', ''
        $prefix = 'model-' + $index.ToString('D2')
        Move-Picker $index $modelHeading
        $null = Save-Picker ($prefix + '-selected')
        $effortHeading = '(?m)^[ \t]*Select Reasoning Level for ' +
            [regex]::Escape($label) + '[ \t]*\r?$'
        $selectedModel = '(?ms)\A(?=.*^[ \t]*Select Model and Effort[ \t]*\r?$)' +
            '(?=.*^[ \t]*\u203a[ \t]+' + $index + '\.[ \t]+' +
            [regex]::Escape($rawLabel) + '(?:[ \t]{2,}|\r?$))'
        Step-Picker 'Enter' $selectedModel $effortHeading
        $effort = Save-Picker ($prefix + '-effort') $true
        if ($effort -notmatch 'esc back') { throw 'Reasoning menu does not advertise cancel/back.' }
        $more = [regex]::Matches($effort,
            '(?m)^[ \t]*(?:\u203a[ \t]*)?(?<index>\d+)\.[ \t]+More reasoning')
        if ($more.Count -gt 1) { throw 'Advanced reasoning entry is ambiguous.' }
        if ($more.Count -eq 1) {
            Move-Picker ([int]$more[0].Groups['index'].Value) $effortHeading
            $null = Save-Picker ($prefix + '-more-selected')
            $moreSelected = '(?m)^[ \t]*\u203a[ \t]+\d+\.[ \t]+More reasoning'
            Step-Picker 'Enter' $moreSelected '(?m)^[ \t]*Advanced Reasoning[ \t]*\r?$'
            $advanced = Save-Picker ($prefix + '-advanced') $true
            if ($advanced -notmatch 'esc back') { throw 'Advanced menu does not advertise cancel/back.' }
            Step-Picker 'Escape' 'Advanced Reasoning' $effortHeading
        }
        Step-Picker 'Escape' $effortHeading $modelHeading
        if ((Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash -ne $baseline) {
            throw 'Config changed during capture. Stop; do not overwrite possible concurrent edits.'
        }
        $captured += [pscustomobject]@{
            Index=$index; Label=$label; AdvancedMenu=($more.Count -eq 1)
            EffortText=($prefix + '-effort.txt')
        }
    }
    Move-Picker ([int]$initialSelection[0].Groups['index'].Value) $modelHeading
    $null = Save-Picker 'models-returned'
    if ((Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash -ne $baseline) {
        throw 'Config changed before final verification; capture cannot report success.'
    }
    [pscustomobject]@{
        CapturedModels=$captured; TextCaptures=$captureCount; Screenshots=$imageCount; ConfigUnchanged=$true
        Scope='visible Windows Terminal picker; raw IDs and completeness require independent evidence'
        Completeness='Unverified until all model/effort rows and menu footers are reconciled with screenshots and CLI evidence'
    } | ConvertTo-Json -Depth 5
} catch {
    try { $null = Save-Picker 'stopped-state' $true } catch { }
    throw
} finally {
    if ((Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash -ne $baseline) {
        Write-Warning 'The config digest changed; capture did not restore or overwrite it.'
    }
}
