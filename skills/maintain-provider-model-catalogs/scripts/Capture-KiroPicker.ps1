<#
.SYNOPSIS
    Walks an already open Kiro V3 /model picker and reads every row with its settings panel.
.DESCRIPTION
    Start at an inspected Kiro V3 "Select model:" picker in a dedicated single-pane Windows
    Terminal window. The script goes Up to the first row, Down to the last and Up again, reading
    each highlighted row's label, credit rate, description and [active] tag, and the settings
    panel's thinking and effort cells. Both directions must agree. It then returns the highlight
    to the row it started on.

    The catalog probe reads model IDs, effort levels and defaults through ACP without a picker.
    This walk answers what the probe cannot see: the text the picker displays. The panel cells
    are each row's current value. chat.modelDefaults in ~/.kiro/settings/cli.json overrides
    them, so they are not default evidence.

    Only Up and Down are sent. Enter selects the row, Escape closes the picker and Left/Right
    change the panel value, so none of them is ever sent. Before every key the settings file
    must match its pre-capture SHA-256.

    The list has no indicator for rows scrolled out above, only "(+N more)" below, so the row
    position is the expected count minus the visible rows and the rows below.
.PARAMETER UiHelperPath
    Path to the desktop-ui-automation WindowsUi.ps1 helper.
.PARAMETER WindowTitle
    The unique title of the capture window.
.PARAMETER OutputDirectory
    A new, empty private evidence directory outside Git.
.PARAMETER ConfigPath
    The settings file Kiro writes, normally ~/.kiro/settings/cli.json.
.PARAMETER ExpectedModelCount
    The row count of `kiro-cli chat --list-models`. A screen with more rows stops the script before
    any key; a smaller list stops it at the first edge it reaches.
#>
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$ConfigPath,
    [Parameter(Mandatory)][ValidateRange(1,200)][int]$ExpectedModelCount,
    [ValidateRange(500,20000)][int]$TimeoutMilliseconds = 4000
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

$POINTER = [string][char]0x276F
$ROW = '^(?<lead>' + $POINTER + ' |  )(?<id>\S+)\s+(?<rate>\d+(?:\.\d+)?x credits)(?:\s+(?<desc>.*?))?\s*$'

function Get-ConfigDigest {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { return 'absent' }
    $stream = [IO.File]::OpenRead($ConfigPath)
    try { -join ([Security.Cryptography.SHA256]::Create().ComputeHash($stream) | ForEach-Object { $_.ToString('X2') }) }
    finally { $stream.Dispose() }
}

function Read-PanelCell([string]$Text, [string]$Name) {
    $cell = [regex]::Match($Text, '(?m)^  ' + $Name + '\s+(?<value>\S+)\s+(?<text>.*?)\s*$')
    if (-not $cell.Success) { return $null }
    [pscustomobject]@{ Value = $cell.Groups['value'].Value; Text = $cell.Groups['text'].Value }
}

function Read-KiroPicker([string]$Text) {
    if ($Text -notmatch '(?m)^Select model:') { throw 'The Kiro model picker is not visible. Stop and inspect.' }
    $lines = @($Text -split "`r?`n")
    $visible = @()
    $highlight = -1
    foreach ($line in $lines) {
        $match = [regex]::Match($line, $ROW)
        if (-not $match.Success) { continue }
        if ($match.Groups['lead'].Value -eq ($POINTER + ' ')) {
            if ($highlight -ge 0) { throw 'More than one highlighted row. Stop and inspect.' }
            $highlight = $visible.Count
        }
        $visible += $match
    }
    if ($highlight -lt 0) { throw 'No highlighted row. Stop and inspect.' }
    $more = [regex]::Match($Text, '(?m)^\(\+(\d+) more\)\s*$')
    $below = if ($more.Success) { [int]$more.Groups[1].Value } else { 0 }
    $above = $ExpectedModelCount - $visible.Count - $below
    if ($above -lt 0) { throw "The picker shows more rows than the expected $ExpectedModelCount." }
    $row = $visible[$highlight]
    $description = $row.Groups['desc'].Value
    $active = $description -match '^\[active\]\s*'
    $panel = [regex]::Match($Text, '(?m)^ Settings for (?:selected )?model: (\S+)')
    [pscustomobject]@{
        Position = $above + $highlight + 1; Id = $row.Groups['id'].Value; Rate = $row.Groups['rate'].Value
        Description = ($description -replace '^\[active\]\s*', ''); Active = $active
        Panel = $(if ($panel.Success) { $panel.Groups[1].Value } else { $null })
        Thinking = (Read-PanelCell $Text 'thinking'); Effort = (Read-PanelCell $Text 'effort')
    }
}

$script:steps = 0
function Save-Step([string]$Name, [string]$Text) {
    $script:steps++
    $Text | Set-Content -LiteralPath (Join-Path $stepsDir ('{0:D3}-{1}.txt' -f $script:steps, $Name)) -Encoding UTF8
}

$baseline = Get-ConfigDigest
function Send-KiroKey([ValidateSet('Up','Down')][string]$Key, $State) {
    if ((Get-ConfigDigest) -ne $baseline) { throw "The settings file changed before $Key from row $($State.Position). Stop and inspect." }
    $guard = '(?m)^' + $POINTER + ' ' + [regex]::Escape($State.Id) + '\s[\s\S]*^ Settings for (?:selected )?model: ' +
        [regex]::Escape($State.Id) + '\s'
    Send-WindowsUiKey $target -Key $Key -ExpectedText $guard
    $want = if ($Key -eq 'Up') { $State.Position - 1 } else { $State.Position + 1 }
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        Start-Sleep -Milliseconds 120
        Assert-WindowsUiFocus $target
        $text = Get-WindowsUiText $target
        $next = Read-KiroPicker $text
        # The panel can redraw after the highlight; wait until it names the highlighted row.
        if ($next.Position -eq $want -and $next.Panel -ceq $next.Id) { return @($next, $text) }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "$Key from row $($State.Position) did not reach row $want with its panel. Stop and inspect."
}

function Get-RowRecord($State) {
    [pscustomobject]@{
        Index = $State.Position; Label = $State.Id; Rate = $State.Rate; Description = $State.Description
        Active = $State.Active; Thinking = $State.Thinking; Effort = $State.Effort
    }
}

$opened = Get-WindowsUiText $target
$text = $opened
Save-Step 'opened' $opened
$state = Read-KiroPicker $opened
if ($state.Panel -cne $state.Id) { throw 'The settings panel does not name the highlighted row. Stop and inspect.' }
$startPosition = $state.Position
while ($state.Position -gt 1) { $state, $text = Send-KiroKey Up $state }

$down = @()
$seen = @{}
for ($index = 1; $index -le $ExpectedModelCount; $index++) {
    if ($seen.ContainsKey($state.Id)) { throw "Row '$($state.Id)' repeated; the list differs from the expected count." }
    $seen[$state.Id] = $index
    Save-Step ('down-{0:D2}' -f $index) (Get-WindowsUiText $target)
    $down += Get-RowRecord $state
    if ($index -lt $ExpectedModelCount) { $state, $text = Send-KiroKey Down $state }
}
if ($text -match '(?m)^\(\+\d+ more\)') { throw 'Rows remain below the expected last row. Stop and inspect.' }

$mismatches = @()
for ($index = $ExpectedModelCount - 1; $index -ge 1; $index--) {
    $state, $text = Send-KiroKey Up $state
    Save-Step ('up-{0:D2}' -f $index) $text
    $back = Get-RowRecord $state
    $first = $down[$index - 1]
    if (($back | ConvertTo-Json -Compress -Depth 4) -cne ($first | ConvertTo-Json -Compress -Depth 4)) {
        $mismatches += "row $index"
    }
}
while ($state.Position -lt $startPosition) { $state, $text = Send-KiroKey Down $state }
Save-Step 'returned' (Get-WindowsUiText $target)

$down | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'rows.json') -Encoding UTF8
$final = Get-ConfigDigest
[pscustomobject]@{
    Rows = $down.Count; ExpectedModelCount = $ExpectedModelCount; StartRow = $startPosition
    ReverseMismatches = $mismatches; Steps = $script:steps; ConfigUnchanged = ($final -eq $baseline)
    Scope = 'This Windows Terminal picker, installation and account only.'
    Completeness = 'Panel cells are current values, which chat.modelDefaults overrides; effort levels and defaults come from the ACP probe.'
} | ConvertTo-Json -Depth 4
