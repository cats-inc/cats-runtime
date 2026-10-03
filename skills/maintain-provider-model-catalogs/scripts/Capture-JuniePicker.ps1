<#
.SYNOPSIS
    Walks an already open Junie /model picker and cycles each row's effort back to its start.
.DESCRIPTION
    Start at an inspected Junie "Select model" picker in a dedicated single-pane Windows Terminal
    window. The script reads every row while it is highlighted (name cell with badges, prices,
    Effort cell, provider and the footer description), presses Right until the Effort cell returns
    to its starting value, and records that cycle. A row whose Effort cell does not change on Right
    has a single value. It then returns the highlight to the row it started on.

    Only Up, Down and Right are sent. Enter selects the row and Escape closes the picker, so neither
    is ever sent. Junie keeps each row's effort in ~/.junie/settings.json (effortPerModel); the
    script compares that file's SHA-256 before and after and reports the result, and each cycle ends
    on the starting value.
.PARAMETER UiHelperPath
    Path to the desktop-ui-automation WindowsUi.ps1 helper.
.PARAMETER WindowTitle
    The unique title of the capture window.
.PARAMETER OutputDirectory
    A new, empty private evidence directory outside Git.
.PARAMETER ConfigPath
    The settings file Junie writes, normally ~/.junie/settings.json.
.PARAMETER ExpectedModelCount
    The footer's row count (i/N), checked before any key is sent.
#>
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$ConfigPath,
    [Parameter(Mandatory)][ValidateRange(1,100)][int]$ExpectedModelCount,
    [ValidateRange(2,20)][int]$MaxEffortLevels = 9,
    [ValidateRange(500,20000)][int]$TimeoutMilliseconds = 3000
)
$ErrorActionPreference = 'Stop'
. $UiHelperPath
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container) -or
    @(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -ne 0) {
    throw 'Pass a new empty evidence directory.'
}
$stepsDir = Join-Path $OutputDirectory 'steps'
$null = New-Item -ItemType Directory -Path $stepsDir
$target = Get-WindowsUiTarget -Title $WindowTitle -ProcessName 'WindowsTerminal'
Set-WindowsUiFocus $target

$ARROW = [string][char]0x2192
$EFFORTS = 'None|Minimal|Low|Medium|High|XHigh|Max'

function Get-ConfigDigest {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { return 'absent' }
    $stream = [IO.File]::OpenRead($ConfigPath)
    try { -join ([Security.Cryptography.SHA256]::Create().ComputeHash($stream) | ForEach-Object { $_.ToString('X2') }) }
    finally { $stream.Dispose() }
}

function Read-JuniePicker([string]$Text) {
    if ($Text -notmatch 'Select model') { throw 'The Junie model picker is not visible. Stop and inspect.' }
    $lines = @($Text -split "`r?`n")
    $highlighted = @($lines | Where-Object { $_ -match ('^\s*' + $ARROW + '\s+\S') })
    if ($highlighted.Count -ne 1) { throw "Expected one highlighted row; saw $($highlighted.Count)." }
    $row = $highlighted[0]
    $match = [regex]::Match($row, '^\s*' + $ARROW +
        '\s+(?<name>.+?)\s+(?<in>\$[\d.,]+)\s+(?<out>\$[\d.,]+)\s+per Mtok\s+(?<effort>.*?)\s{2,}(?<provider>\S.*?)\s*$')
    if (-not $match.Success) { throw "Unrecognized picker row: $($row.Trim())" }
    $effort = [regex]::Match($match.Groups['effort'].Value, "\b($EFFORTS)\b")
    $footer = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*(\d+)/(\d+)\s*$') { $footer = $i } }
    if ($footer -lt 0) { throw 'The picker footer counter (i/N) is not visible.' }
    $counter = [regex]::Match($lines[$footer], '(\d+)/(\d+)')
    $description = @($lines[($footer + 1)..($lines.Count - 1)] | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join ' '
    [pscustomobject]@{
        Position = [int]$counter.Groups[1].Value; Total = [int]$counter.Groups[2].Value
        NameCell = $match.Groups['name'].Value.Trim(); Input = $match.Groups['in'].Value; Output = $match.Groups['out'].Value
        Effort = $(if ($effort.Success) { $effort.Value } else { $null }); Provider = $match.Groups['provider'].Value.Trim()
        Description = $description
    }
}

$script:steps = 0
function Save-Step([string]$Name, [string]$Text) {
    $script:steps++
    $Text | Set-Content -LiteralPath (Join-Path $stepsDir ('{0:D3}-{1}.txt' -f $script:steps, $Name)) -Encoding UTF8
}

function Wait-JunieState([scriptblock]$Done) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        Start-Sleep -Milliseconds 120
        Assert-WindowsUiFocus $target
        $text = Get-WindowsUiText $target
        $state = Read-JuniePicker $text
        if (& $Done $state) { return @($state, $text) }
    } while ([DateTime]::UtcNow -lt $deadline)
    return @($null, $text)
}

function Send-JunieKey([ValidateSet('Up','Down','Right')][string]$Key, $State) {
    $guard = '(?m)^\s*' + $ARROW + '\s+' + [regex]::Escape($State.NameCell) + '\s'
    Send-WindowsUiKey $target -Key $Key -ExpectedText $guard
}

$baseline = Get-ConfigDigest
$opened = Get-WindowsUiText $target
Save-Step 'opened' $opened
$state = Read-JuniePicker $opened
if ($state.Total -ne $ExpectedModelCount) {
    throw "The footer counts $($state.Total) rows, not the expected $ExpectedModelCount."
}
$startPosition = $state.Position
while ($state.Position -gt 1) {
    $from = $state.Position
    Send-JunieKey Up $state
    $state, $text = Wait-JunieState { param($s) $s.Position -eq ($from - 1) }
    if (-not $state) { throw "Up from row $from did not move. Stop and inspect." }
}

$rows = @()
$seen = @{}
for ($index = 1; $index -le $ExpectedModelCount; $index++) {
    if ($state.Position -ne $index) { throw "Expected row $index, but row $($state.Position) is highlighted." }
    if ($seen.ContainsKey($state.NameCell)) { throw "Row '$($state.NameCell)' repeated; the list differs from the footer count." }
    $seen[$state.NameCell] = $index
    Save-Step ('row-{0:D2}' -f $index) (Get-WindowsUiText $target)
    $start = $state.Effort
    $cycle = @($start)
    $current = $state
    $closed = $false
    if ($null -ne $start) {
        for ($press = 1; $press -le $MaxEffortLevels; $press++) {
            $before = $current.Effort
            Send-JunieKey Right $current
            $next, $text = Wait-JunieState { param($s) $s.Position -eq $index -and $s.Effort -ne $before }
            if (-not $next) {
                # A single-value row never changes; confirm once more before treating it as closed.
                Start-Sleep -Milliseconds 600
                $next = Read-JuniePicker (Get-WindowsUiText $target)
                if ($next.Effort -eq $before) { $closed = ($before -eq $start); break }
            }
            Save-Step ('row-{0:D2}-right-{1:D2}' -f $index, $press) $text
            $current = $next
            if ($current.Effort -eq $start) { $closed = $true; break }
            $cycle += $current.Effort
        }
        if (-not $closed) { throw "Row ${index}: effort did not return to '$start' (now '$($current.Effort)'). Stop and inspect." }
    }
    $badge = [regex]::Match($state.NameCell, '^(?<name>.+?)\s{2,}(?<badge>\S.*)$')
    $rows += [pscustomobject]@{
        Index = $index; NameCell = $state.NameCell
        Name = $(if ($badge.Success) { $badge.Groups['name'].Value } else { $state.NameCell })
        Badge = $(if ($badge.Success) { $badge.Groups['badge'].Value } else { $null })
        Input = $state.Input; Output = $state.Output; Provider = $state.Provider; Description = $state.Description
        StartEffort = $start; EffortCycle = $cycle; SingleValue = ($null -ne $start -and $cycle.Count -eq 1)
    }
    if ($index -lt $ExpectedModelCount) {
        Send-JunieKey Down $current
        $state, $text = Wait-JunieState { param($s) $s.Position -eq ($index + 1) }
        if (-not $state) { throw "Down from row $index did not move. Stop and inspect." }
    }
}
while ($state.Position -gt $startPosition) {
    $from = $state.Position
    Send-JunieKey Up $state
    $state, $text = Wait-JunieState { param($s) $s.Position -eq ($from - 1) }
    if (-not $state) { throw 'Up did not move while returning to the starting row. Stop and inspect.' }
}
Save-Step 'returned' (Get-WindowsUiText $target)
$rows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'rows.json') -Encoding UTF8
$final = Get-ConfigDigest
[pscustomobject]@{
    Rows = $rows.Count; ExpectedModelCount = $ExpectedModelCount; StartRow = $startPosition
    SingleValueRows = @($rows | Where-Object SingleValue | ForEach-Object { $_.Name })
    Steps = $script:steps; ConfigUnchanged = ($final -eq $baseline)
    Scope = 'This Windows Terminal picker, installation and account only.'
    Completeness = 'Each EffortCycle is the Right-key order from the start value; take linear order from the JAR EffortLevel order.'
} | ConvertTo-Json -Depth 4
