<#
.SYNOPSIS
    Captures every Auggie CLI /model picker row and, optionally, what selecting each row does.
.DESCRIPTION
    Uses the desktop-ui-automation Windows helper. Starts at an inspected Auggie "Select model for
    this session" picker in a dedicated single-pane Windows Terminal window. Walks Up to the first
    row, Down to the last row and Up again, reading each highlighted row's label, (current) and
    (default) suffixes, badges, cost tier and description, and checks that both directions give
    the same order. Top and bottom are read from the screen (no "N more" counter and the highlight
    on the first or last visible row), so no key is sent past an edge.

    The walk sends only Up and Down. -ProbeSelection is a separate, operator-authorized step: for
    each row it reopens /model, moves to the row, presses Enter and requires the picker to close
    with "Using model: <label>". Any other screen (for example an effort step) stops the probe.
    Escape is never sent. In Auggie 0.36.0 Enter changes only the session model.

    Before every key the settings file must still have its pre-capture SHA-256; any change stops
    the capture. Evidence stays private. Does not launch Auggie, log in, send prompts, interpret
    (current) as a default, or edit catalogs.
.PARAMETER UiHelperPath
    Path to desktop-ui-automation/scripts/windows/WindowsUi.ps1 in a canonical or active skill.
.PARAMETER WindowTitle
    Unique Windows Terminal title, fixed with --title and --suppressApplicationTitle.
.PARAMETER OutputDirectory
    Existing empty private evidence directory outside tracked repository content.
.PARAMETER ConfigPath
    Settings file to guard (normally ~/.augment/settings.json). It may be absent.
.PARAMETER ExpectedModelCount
    Rows listed by `auggie model list --json`. A different picker count stops before any probe.
.PARAMETER ProbeSelection
    Also press Enter on each row as described above. Requires explicit operator authorization.
.PARAMETER Screenshots
    KeyScreens saves the opened picker once; None records text only.
.PARAMETER TimeoutSeconds
    Wait for a changed, stable screen after each key.
.EXAMPLE
    .\Capture-AuggiePicker.ps1 -UiHelperPath $uiHelper -WindowTitle 'Auggie catalog capture' `
        -OutputDirectory $evidenceDir -ConfigPath "$env:USERPROFILE\.augment\settings.json" `
        -ExpectedModelCount 34
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$ConfigPath,
    [Parameter(Mandatory)][ValidateRange(1,200)][int]$ExpectedModelCount,
    [switch]$ProbeSelection,
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

$V = [string][char]0x2502; $DOT = [string][char]0x25CF; $UP = [string][char]0x2191; $DN = [string][char]0x2193
$pickerTitle = 'Select model for this session'
$rowPattern = "^\s*$V\s+(?:$DOT\s+)?(.+?)\s{2,}((?:\[[^\]]+\]\s*)*\`$+)\s*`$"

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

function Split-Label([string]$Text) {
    $label = $Text.Trim(); $current = $false; $default = $false
    while ($label -match '^(.*) \((current|default)\)$') {
        $label = $Matches[1]; if ($Matches[2] -eq 'current') { $current = $true } else { $default = $true }
    }
    [pscustomobject]@{ Label = $label; Current = $current; Default = $default }
}

function Read-Picker([string]$Text) {
    $lines = @($Text -split "`n" | ForEach-Object { $_.TrimEnd() })
    $state = [ordered]@{ Open = ($Text -match [regex]::Escape($pickerTitle)); Above = 0; Below = 0; Visible = @(); Highlight = $null }
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -match "^\s*$V\s+$UP (\d+) more$") { $state.Above = [int]$Matches[1]; continue }
        if ($line -match "^\s*$V\s+$DN (\d+) more$") { $state.Below = [int]$Matches[1]; continue }
        if ($line -notmatch $rowPattern) { continue }
        $parts = Split-Label $Matches[1]; $tail = $Matches[2]
        $state.Visible += $parts.Label
        if ($line -notmatch "^\s*$V\s+$DOT\s") { continue }
        $description = $null
        if ($i + 1 -lt $lines.Count -and $lines[$i + 1] -match "^\s*$V\s{3,}(\S.*)$" -and $lines[$i + 1] -notmatch $rowPattern -and
            $lines[$i + 1] -notmatch "^\s*$V\s+[$UP$DN] \d+ more$") { $description = $Matches[1].Trim() }
        $state.Highlight = [pscustomobject]@{ Label = $parts.Label; Current = $parts.Current; Default = $parts.Default
            Badges = @([regex]::Matches($tail, '\[([^\]]+)\]') | ForEach-Object { $_.Groups[1].Value })
            Cost = ([regex]::Match($tail, '\$+$')).Value; Description = $description }
    }
    [pscustomobject]$state
}
function Test-Edge($State, [string]$Edge) {
    if (-not $State.Highlight -or $State.Visible.Count -eq 0) { return $false }
    if ($Edge -eq 'top') { return $State.Above -eq 0 -and $State.Highlight.Label -ceq $State.Visible[0] }
    return $State.Below -eq 0 -and $State.Highlight.Label -ceq $State.Visible[-1]
}

$script:steps = 0
function Save-Step([string]$Name, [string]$Text) {
    $script:steps++
    $Text | Set-Content -LiteralPath (Join-Path $stepsDir ('{0:D3}-{1}.txt' -f $script:steps, $Name)) -Encoding UTF8
}
function Wait-Screen([string]$Before, [scriptblock]$Accept) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds); $after = $Before; $last = $null
    do {
        Start-Sleep -Milliseconds 150; $last = $after; $after = Get-WindowsUiText $target
        if ($after -cne $Before -and $after -ceq $last -and (& $Accept $after)) { return $after }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The screen did not reach the expected state after a key. Stop and inspect.'
}
function Send-PickerKey([ValidateSet('Up','Down','Enter')][string]$Key, [scriptblock]$Accept) {
    Assert-ConfigUnchanged "before $Key"
    $before = Get-WindowsUiText $target
    Send-WindowsUiKey -Target $target -Key $Key -ExpectedText ([regex]::Escape($pickerTitle))
    $after = Wait-Screen $before $Accept
    Save-Step $Key.ToLowerInvariant() $after
    $after
}
$moved = { param($t) [bool](Read-Picker $t).Highlight }
function Move-ToTop([int]$Limit) {
    $state = Read-Picker (Get-WindowsUiText $target)
    for ($n = 0; -not (Test-Edge $state 'top'); $n++) {
        if ($n -ge $Limit) { throw 'The first row was not reached. Stop and inspect.' }
        $state = Read-Picker (Send-PickerKey 'Up' $moved)
    }
    $state
}

Set-WindowsUiFocus $target
$opened = Get-WindowsUiText $target
if (-not (Read-Picker $opened).Open -or -not (Read-Picker $opened).Highlight) {
    throw 'Open the Auggie /model picker and inspect it before capture.'
}
Save-Step 'opened' $opened
$screenshotCount = 0
if ($Screenshots -eq 'KeyScreens') {
    $null = Save-WindowsUiSnapshot -Target $target -OutputPrefix (Join-Path $OutputDirectory 'picker-opened')
    $screenshotCount++
}
$limit = $ExpectedModelCount + 5
$state = Move-ToTop $limit
$rows = New-Object System.Collections.ArrayList
while ($true) {
    $h = $state.Highlight
    [void]$rows.Add([pscustomobject]@{ Index = $rows.Count + 1; Label = $h.Label; Current = $h.Current
        Default = $h.Default; Badges = @($h.Badges); Cost = $h.Cost; Description = $h.Description })
    if (Test-Edge $state 'bottom') { break }
    if ($rows.Count -ge $limit) { throw 'The last row was not reached. Stop and inspect.' }
    $previous = $h.Label
    $state = Read-Picker (Send-PickerKey 'Down' { param($t) $s = Read-Picker $t; $s.Highlight -and $s.Highlight.Label -cne $previous })
}
for ($i = $rows.Count - 2; $i -ge 0; $i--) {
    $want = $rows[$i].Label
    $state = Read-Picker (Send-PickerKey 'Up' { param($t) [bool](Read-Picker $t).Highlight })
    if ($state.Highlight.Label -cne $want) {
        throw "Reverse walk expected '$want' but found '$($state.Highlight.Label)'. Stop and inspect."
    }
}
$rows | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'rows.json') -Encoding UTF8
if ($rows.Count -ne $ExpectedModelCount) {
    throw "The picker listed $($rows.Count) rows; the JSON list has $ExpectedModelCount. Stop before any probe."
}

$probes = New-Object System.Collections.ArrayList
if ($ProbeSelection) {
    foreach ($row in $rows) {
        if ($row.Index -gt 1) {
            Assert-ConfigUnchanged 'before reopening /model'
            Send-WindowsUiText -Target $target -Text '/' -ExpectedText 'to show shortcuts'
            $null = Wait-WindowsUiText -Target $target -ExpectedText 'Enter command'
            Send-WindowsUiText -Target $target -Text 'model' -ExpectedText 'Enter command'
            $null = Wait-WindowsUiText -Target $target -ExpectedText 'model Select the model for this session'
            Assert-ConfigUnchanged 'before Enter'
            $before = Get-WindowsUiText $target
            Send-WindowsUiKey -Target $target -Key 'Enter' -ExpectedText 'model Select the model for this session'
            $state = Read-Picker (Wait-Screen $before { param($t) $s = Read-Picker $t; $s.Open -and [bool]$s.Highlight })
            $state = Move-ToTop $limit
        }
        for ($i = 1; $i -lt $row.Index; $i++) { $state = Read-Picker (Send-PickerKey 'Down' { param($t) [bool](Read-Picker $t).Highlight }) }
        if ($state.Highlight.Label -cne $row.Label) {
            throw "Row $($row.Index): expected '$($row.Label)', highlighted '$($state.Highlight.Label)'. Stop and inspect."
        }
        $after = Send-PickerKey 'Enter' { param($t) -not (Read-Picker $t).Open }
        $using = @($after -split "`n" | Where-Object { $_ -match 'Using model: ' } | ForEach-Object { ($_ -replace '^.*?Using model: ', '').Trim() })
        $direct = $using.Count -gt 0 -and $using[-1] -ceq $row.Label
        [void]$probes.Add([pscustomobject]@{ Index = $row.Index; Label = $row.Label; DirectSelect = $direct })
        $probes | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'probes.json') -Encoding UTF8
        if (-not $direct) { throw "Row $($row.Index) '$($row.Label)': Enter did not select it directly. Stop and inspect." }
    }
}
Assert-ConfigUnchanged 'during capture'
$summary = [ordered]@{
    Rows = $rows.Count; ExpectedModelCount = $ExpectedModelCount
    Current = @($rows | Where-Object Current | ForEach-Object Label)
    Default = @($rows | Where-Object Default | ForEach-Object Label)
    Probed = $probes.Count; AllDirect = (@($probes | Where-Object { -not $_.DirectSelect }).Count -eq 0)
    Steps = $script:steps; Screenshots = $screenshotCount; ConfigUnchanged = $true
}
$summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'summary.json') -Encoding UTF8
$summary | ConvertTo-Json
