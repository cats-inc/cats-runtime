<#
.SYNOPSIS
    Captures every row of the Kilo CLI model picker with its section, without selecting a model.
.DESCRIPTION
    Uses the desktop-ui-automation Windows helper. Starts at an inspected Kilo "Select model"
    dialog (opened with /models) in a dedicated single-pane Windows Terminal window; maximize the
    window first so the list and detail panel are wide enough.

    The dialog does not mark the highlighted row in its text; the detail panel on the right names
    it. The list wraps at both ends. The walk presses Up until the list jumps to its bottom (the
    highlight wrapped to the last row), presses Down once to wrap to the first row, then presses
    Down until the list jumps back to the top. The list lines seen at each scroll position are
    stitched into one ordered list of section headers and rows, and the panel names seen during
    the walk must match those rows one by one, so a skipped or repeated row stops the capture.

    Sends only Up and Down and leaves the dialog open on the first row. Before every key the
    model state file (recent, favorite and variant choices) must keep its pre-capture SHA-256.
    Evidence stays private. Does not launch Kilo, log in, select a model, send prompts, treat the
    current-model dot as a default, or edit catalogs.
.PARAMETER UiHelperPath
    Path to desktop-ui-automation/scripts/windows/WindowsUi.ps1 in a canonical or active skill.
.PARAMETER WindowTitle
    Unique Windows Terminal title, fixed with --title and --suppressApplicationTitle.
.PARAMETER OutputDirectory
    Existing empty private evidence directory outside tracked repository content.
.PARAMETER StatePath
    Model state file to guard, normally ~/.local/state/kilo/model.json. It may be absent.
.PARAMETER ProviderSection
    Header of the gateway provider's section. Favorites and Recent rows end with it as a
    description.
.PARAMETER Sections
    Other section headers the dialog can show.
.PARAMETER MaxRows
    Stop if the walk has not wrapped after this many rows.
.PARAMETER Screenshots
    KeyScreens saves the opened dialog once; None records text only.
.PARAMETER TimeoutSeconds
    Wait for a changed, stable screen after each key.
.EXAMPLE
    .\Capture-KiloPicker.ps1 -UiHelperPath $uiHelper -WindowTitle 'Kilo catalog capture' `
        -OutputDirectory $evidenceDir -StatePath "$env:USERPROFILE\.local\state\kilo\model.json"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$StatePath,
    [string]$ProviderSection = 'Kilo Gateway',
    [string[]]$Sections = @('Favorites', 'Recent', 'Recommended', 'Popular providers'),
    [ValidateRange(1,5000)][int]$MaxRows = 1000,
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
$StatePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($StatePath)
$stepsDir = Join-Path $OutputDirectory 'steps'
$null = New-Item -ItemType Directory -Path $stepsDir
$target = Get-WindowsUiTarget -Title $WindowTitle -ProcessName 'WindowsTerminal'

$V = [char]0x2502; $DOT = [string][char]0x25CF
# A long detail panel draws a scrollbar from block elements at its right edge.
$trailing = '[\s' + [char]0x2580 + '-' + [char]0x259F + ']+$'
$headers = @($Sections) + @($ProviderSection)
$describedSections = @('Favorites', 'Recent')

function Get-StateDigest {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return 'absent' }
    $stream = [IO.File]::OpenRead($StatePath)
    try { -join ([Security.Cryptography.SHA256]::Create().ComputeHash($stream) | ForEach-Object { $_.ToString('X2') }) }
    finally { $stream.Dispose() }
}
$baselineDigest = Get-StateDigest
function Assert-StateUnchanged([string]$When) {
    if ((Get-StateDigest) -ne $baselineDigest) { throw "The model state file changed $When. Stop and inspect." }
}

function Split-Line([string]$Line) {
    $at = $Line.LastIndexOf($V)
    if ($at -lt 0) { return @(($Line -replace $trailing, ''), '') }
    return @(($Line.Substring(0, $at) -replace $trailing, ''), ($Line.Substring($at + 1) -replace $trailing, '').Trim())
}

# Reads the dialog: list items between the Search line and the footer, and the panel's name.
function Read-Dialog([string]$Text) {
    $lines = @($Text -split "`n" | ForEach-Object { $_.TrimEnd("`r") })
    $state = [ordered]@{ Open = $false; Items = @(); Highlight = $null }
    $title = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ((Split-Line $lines[$i])[0] -match '^\s*Select model\s+esc$') { $title = $i; break } }
    if ($title -lt 0) { return [pscustomobject]$state }
    $search = -1; $footer = -1
    for ($i = $title + 1; $i -lt $lines.Count; $i++) {
        $left = (Split-Line $lines[$i])[0]
        if ($search -lt 0 -and $left -match '^\s*Search') { $search = $i; continue }
        if ($left -match '^\s*Connect provider\s') { $footer = $i; break }
    }
    if ($search -lt 0 -or $footer -lt 0) { return [pscustomobject]$state }
    $state.Open = $true
    # The lines below Search and above the footer are fixed spacers, not part of the scrolling list.
    $first = $search + 1; $last = $footer - 1
    if ($first -le $last -and -not (Split-Line $lines[$first])[0].Trim()) { $first++ }
    if ($last -ge $first -and -not (Split-Line $lines[$last])[0].Trim()) { $last-- }
    $items = @()
    for ($i = $first; $i -le $last; $i++) {
        $text = (Split-Line $lines[$i])[0].Trim()
        $current = $false
        if ($text.StartsWith($DOT + ' ')) { $current = $true; $text = $text.Substring(2).Trim() }
        if (-not $text) { $items += [pscustomobject]@{ Kind = 'blank'; Text = '' }; continue }
        if ($headers -ccontains $text) { $items += [pscustomobject]@{ Kind = 'header'; Text = $text }; continue }
        $parts = @($text -split '\s{2,}')
        $items += [pscustomobject]@{ Kind = 'row'; Text = $text; Label = $parts[0]; Current = $current
            Badges = @($parts | Select-Object -Skip 1) }
    }
    $state.Items = $items
    $name = @()
    for ($i = $title + 1; $i -lt $lines.Count -and $name.Count -le 4; $i++) {
        $right = (Split-Line $lines[$i])[1]
        if ($right -ceq $ProviderSection) { break }
        if (-not $right) { $name = @(); break }
        $name += $right
    }
    if ($name.Count -gt 0 -and $name.Count -le 4) { $state.Highlight = $name -join ' ' }
    [pscustomobject]$state
}
function Get-Signature($State) { ($State.Items | ForEach-Object { $_.Kind + ':' + $_.Text }) }
# How many lines the list scrolled between two screens: 0, +d (down), -d (up) or $null (a jump).
# One row moves the list at most a row, a header and a blank line; the overlap must hold a row.
function Get-Shift($Before, $After) {
    $a = @(Get-Signature $Before); $b = @(Get-Signature $After)
    if ($a.Count -ne $b.Count -or $a.Count -eq 0) { return $null }
    if (($a -join "`n") -ceq ($b -join "`n")) { return 0 }
    for ($d = 1; $d -le [Math]::Min(4, $a.Count - 2); $d++) {
        $keep = $a.Count - $d
        $down = @($a[$d..($a.Count - 1)]); $up = @($a[0..($keep - 1)])
        if (($down -join "`n") -ceq (@($b[0..($keep - 1)]) -join "`n") -and @($down -like 'row:*').Count -gt 0) { return $d }
        if ((@($b[$d..($b.Count - 1)]) -join "`n") -ceq ($up -join "`n") -and @($up -like 'row:*').Count -gt 0) { return -$d }
    }
    return $null
}

$script:steps = 0
function Save-Step([string]$Name, [string]$Text) {
    $script:steps++
    $Text | Set-Content -LiteralPath (Join-Path $stepsDir ('{0:D4}-{1}.txt' -f $script:steps, $Name)) -Encoding UTF8
}
function Wait-Screen([string]$Before) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds); $after = $Before; $last = $null
    do {
        Start-Sleep -Milliseconds 120; $last = $after; $after = Get-WindowsUiText $target
        if ($after -cne $Before -and $after -ceq $last -and (Read-Dialog $after).Highlight) { return $after }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'The screen did not change to a readable dialog after a key (two adjacent rows can look identical). Stop and inspect.'
}
function Send-DialogKey([ValidateSet('Up','Down')][string]$Key) {
    Assert-StateUnchanged "before $Key"
    $before = Get-WindowsUiText $target
    Send-WindowsUiKey -Target $target -Key $Key -ExpectedText 'Select model'
    $after = Wait-Screen $before
    Save-Step $Key.ToLowerInvariant() $after
    Read-Dialog $after
}
# The panel wraps long names, sometimes inside a word, so names are compared without whitespace.
# Returns the row's label (the panel's only when the list truncated it), or $null on a mismatch.
function Get-MatchedLabel([string]$Panel, $Row) {
    $listed = $Row.Label
    if ($listed.EndsWith(' ' + $ProviderSection)) { $listed = $listed.Substring(0, $listed.Length - $ProviderSection.Length - 1) }
    $compactPanel = $Panel -replace '\s', ''
    if (($listed -replace '\s', '') -ceq $compactPanel) { return $listed }
    $ellipsis = [string][char]0x2026
    if ($listed.EndsWith($ellipsis) -and $compactPanel.StartsWith(($listed.Substring(0, $listed.Length - 1) -replace '\s', ''))) { return $Panel }
    return $null
}

Set-WindowsUiFocus $target
$openedText = Get-WindowsUiText $target
$state = Read-Dialog $openedText
if (-not $state.Open -or -not $state.Highlight) { throw 'Open the Kilo model dialog (/models) and inspect it before capture.' }
Save-Step 'opened' $openedText
$screenshotCount = 0
if ($Screenshots -eq 'KeyScreens') {
    $null = Save-WindowsUiSnapshot -Target $target -OutputPrefix (Join-Path $OutputDirectory 'picker-opened')
    $screenshotCount++
}

# Up until the list jumps to its bottom, then one Down wraps to the first row at the top.
for ($n = 0; ; $n++) {
    if ($n -ge $MaxRows) { throw 'The list never wrapped while moving up. Stop and inspect.' }
    $previous = $state; $state = Send-DialogKey 'Up'
    if ($null -eq (Get-Shift $previous $state)) { break }
}
$previous = $state; $state = Send-DialogKey 'Down'
if ($null -ne (Get-Shift $previous $state)) { throw 'Down from the last row did not jump to the top. Stop and inspect.' }
$top = $state
$stitched = New-Object System.Collections.ArrayList
foreach ($item in $top.Items) { [void]$stitched.Add($item) }
$highlights = New-Object System.Collections.ArrayList
[void]$highlights.Add($top.Highlight)
while ($true) {
    if ($highlights.Count -gt $MaxRows) { throw 'The list did not wrap within MaxRows. Stop and inspect.' }
    $previous = $state; $state = Send-DialogKey 'Down'
    $shift = Get-Shift $previous $state
    if ($null -eq $shift) {
        if ((@(Get-Signature $state) -join "`n") -cne (@(Get-Signature $top) -join "`n") -or $state.Highlight -cne $top.Highlight) {
            throw 'The list jumped somewhere other than its top. Stop and inspect.'
        }
        break
    }
    if ($shift -lt 0) { throw 'The list scrolled up while moving down. Stop and inspect.' }
    if ($shift -gt 0) { foreach ($item in @($state.Items | Select-Object -Last $shift)) { [void]$stitched.Add($item) } }
    [void]$highlights.Add($state.Highlight)
}

$rows = New-Object System.Collections.ArrayList
$section = $null
foreach ($item in $stitched) {
    if ($item.Kind -eq 'header') { $section = $item.Text; continue }
    if ($item.Kind -ne 'row') { continue }
    $index = $rows.Count
    if ($index -ge $highlights.Count) { throw 'The list shows more rows than the walk visited. Stop and inspect.' }
    $panel = $highlights[$index]
    $label = Get-MatchedLabel $panel $item
    if ($null -eq $label) {
        throw "Row $($index + 1) reads '$($item.Label)' but the panel named '$panel'. Stop and inspect."
    }
    $description = $null
    if ($describedSections -ccontains $section -and $item.Label.EndsWith(' ' + $ProviderSection)) { $description = $ProviderSection }
    [void]$rows.Add([pscustomobject]@{ Index = $index + 1; Section = $section; Label = $label; Description = $description
        Badges = @($item.Badges); Current = $item.Current })
}
if ($rows.Count -ne $highlights.Count) {
    throw "The walk visited $($highlights.Count) rows but the list shows $($rows.Count). Stop and inspect."
}
$rows | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'rows.json') -Encoding UTF8

Assert-StateUnchanged 'during capture'
$sectionCounts = @($rows | Group-Object Section | ForEach-Object { [ordered]@{ Section = $_.Name; Rows = $_.Count } })
$repeated = @($rows | Group-Object Label | Where-Object { $_.Count -gt 1 } | ForEach-Object {
    [ordered]@{ Label = $_.Name; Sections = @($_.Group | ForEach-Object Section) } })
$summary = [ordered]@{
    Rows = $rows.Count; Sections = $sectionCounts; RepeatedLabels = $repeated
    Current = @($rows | Where-Object Current | ForEach-Object { "$($_.Section): $($_.Label)" })
    Steps = $script:steps; Screenshots = $screenshotCount; StateUnchanged = $true
}
$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'summary.json') -Encoding UTF8
$summary | ConvertTo-Json -Depth 4
