<#
.SYNOPSIS
    Exercises Kilo picker capture against a simulated dialog; never opens a desktop window or
    starts Kilo.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('kilo-capture-test-' + [Guid]::NewGuid().ToString('N'))
$capture = Join-Path $PSScriptRoot '../scripts/Capture-KiloPicker.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
# Simulated Kilo 7.8.8 model dialog with its real layout and synthetic model names: sections,
# a detail panel naming the highlighted row, wrap-around at both ends and the list scrolling.
$V = [string][char]0x2502; $DOT = [string][char]0x25CF; $ELL = [string][char]0x2026
$long = 'Example Provider: Example Extremely Long Model Name'
$rows = @(
    @{ S = 'Recent'; L = 'Example Beta' }
    @{ S = 'Recent'; L = 'Example Gamma'; B = 'May train' }
    @{ S = 'Recommended'; L = 'Auto Example' }
    @{ S = 'Recommended'; L = 'Example Beta' }
    @{ S = 'Kilo Gateway'; L = 'Example Alpha' }
    @{ S = 'Kilo Gateway'; L = 'Example Delta (free)'; B = 'May train' }
    @{ S = 'Kilo Gateway'; L = $long }
    @{ S = 'Kilo Gateway'; L = 'Example Epsilon (wrapped)' }
    @{ S = 'Kilo Gateway'; L = 'Example Zeta' }
    @{ S = 'Kilo Gateway'; L = 'Example Eta' }
)
$lines = @(); $rowLine = @(); $section = $null
foreach ($r in $rows) {
    if ($r.S -ne $section) { if ($section) { $lines += ,@{ T = '' } }; $lines += ,@{ T = $r.S }; $section = $r.S }
    $rowLine += $lines.Count; $lines += ,@{ R = $rowLine.Count - 1 }
}
$global:mk = @{ Rows = $rows; Lines = $lines; RowLine = $rowLine; Current = 0; Row = 1; Top = 0; Visible = 6; Open = $true }
if ($global:mockClosed) { $global:mk.Open = $false }
$global:mockKeys = @()
function Get-MockRowText($n) { $s = $global:mk; $r = $s.Rows[$n]; $text = $r.L
    if ($text.Length -gt 40) { $text = $text.Substring(0, 39) + $ELL }
    if ($r.S -eq 'Recent') { $text += ' Kilo Gateway' }
    $mark = if ($n -eq $s.Current) { "$DOT " } else { '  ' }
    ('    ' + $mark + ('{0,-58}{1,-10}' -f $text, $r.B)) }
function Get-WindowsUiTarget { param($Title, $ProcessName) [pscustomobject]@{ Title = $Title } }
function Set-WindowsUiFocus { param($Target) }
function Get-WindowsUiText { param($Target)
    $s = $global:mk
    if (-not $s.Open) { return "Ask anything`n  Code  MiniMax Kilo Gateway" }
    $name = $s.Rows[$s.Row].L
    $cut = if ($name.Length -gt 30) { $name.LastIndexOf(' ', 30) } else { -1 }
    $panel = @(if ($cut -gt 0) { $name.Substring(0, $cut), $name.Substring($cut + 1) } else { $name })
    # Like Kilo, break a name inside its parenthesis.
    if ($name -like '*(wrapped)') { $panel = @($name.Substring(0, $name.Length - 8), $name.Substring($name.Length - 8)) }
    $panel += 'Kilo Gateway', 'Released  2026', 'Context  1M'
    if ($name -like 'Example Delta*') { $panel = @($panel | ForEach-Object { $_.PadRight(26) + [char]0x2588 }) }
    $left = @(('      {0,-60}esc ' -f 'Select model'), '', '      Search', '')
    foreach ($i in $s.Top..($s.Top + $s.Visible - 1)) {
        $l = $s.Lines[$i]
        if ($null -eq $l) { $left += '' } elseif ($l.ContainsKey('R')) { $left += Get-MockRowText $l.R } else { $left += ('      ' + $l.T) }
    }
    $left += '', '      Connect provider ctrl+a  Favorite ctrl+f'
    $out = @('  KILO CLI')
    for ($i = 0; $i -lt $left.Count; $i++) {
        $right = if ($i -ge 1 -and $i - 1 -lt $panel.Count) { $panel[$i - 1] } else { '' }
        $out += ('{0,-80}{1}  {2}' -f $left[$i], $V, $right)
    }
    ($out + '  ~\work  7.8.8') -join "`n"
}
function Move-MockRow([int]$Delta) { $s = $global:mk; $n = $s.Rows.Count
    $s.Row = ($s.Row + $Delta + $n) % $n; $line = $s.RowLine[$s.Row]
    if ($line -ge $s.Top + $s.Visible) { $s.Top = $line - $s.Visible + 1 }
    if ($line -lt $s.Top) { $s.Top = $line }
    if ($s.Row -eq 0) { $s.Top = 0 } }
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    $global:mockKeys += $Key
    if ($global:mockWriteOnKey -eq $global:mockKeys.Count) { Add-Content -LiteralPath $global:mockStatePath -Value 'x' }
    switch ($Key) {
        'Down' { $step = if ($global:mockSkipAt -eq $global:mockKeys.Count) { 2 } else { 1 }; Move-MockRow $step }
        'Up' { Move-MockRow -1 }
        default { throw "Capture sent an unexpected key: $Key" }
    }
}
function Save-WindowsUiSnapshot { param($Target, $OutputPrefix)
    Get-WindowsUiText $Target | Set-Content -LiteralPath ($OutputPrefix + '.txt') -Encoding UTF8
    [pscustomobject]@{ Image = $OutputPrefix + '.png' }
}
'@ | Set-Content -LiteralPath $mock -Encoding UTF8

$globals = 'mockClosed', 'mockWriteOnKey', 'mockSkipAt', 'mockKeys', 'mockStatePath', 'mk'
function Reset-Fixture([string]$Name) {
    foreach ($variable in $globals) { Remove-Variable -Name $variable -Scope Global -ErrorAction SilentlyContinue }
    $dir = Join-Path $scratch $Name
    $null = New-Item -ItemType Directory -Path (Join-Path $dir 'evidence')
    $global:mockStatePath = Join-Path $dir 'model.json'
    [IO.File]::WriteAllText($global:mockStatePath, '{"recent":[]}')
    return $dir
}
function Invoke-Capture([string]$Dir, [hashtable]$Extra = @{}) {
    $params = @{ UiHelperPath = $mock; WindowTitle = 'Fixture'; OutputDirectory = (Join-Path $Dir 'evidence')
        StatePath = $global:mockStatePath; TimeoutSeconds = 1; Screenshots = 'None' }
    foreach ($key in $Extra.Keys) { $params[$key] = $Extra[$key] }
    & $capture @params | Out-String | ConvertFrom-Json
}
function Assert-Throws([scriptblock]$Action, [string]$Pattern, [string]$Label) {
    $failed = $false
    try { $null = & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "$Label failed unexpectedly: $($_.Exception.Message)" }
        $failed = $true
    }
    if (-not $failed) { throw "$Label did not fail." }
}

try {
    $dir = Reset-Fixture 'walk'
    $result = Invoke-Capture $dir
    $rows = @((Get-Content -Raw -LiteralPath (Join-Path $dir 'evidence\rows.json') | ConvertFrom-Json) | ForEach-Object { $_ })
    $got = ($rows | ForEach-Object { "$($_.Section)/$($_.Label)" }) -join ','
    $want = 'Recent/Example Beta,Recent/Example Gamma,Recommended/Auto Example,Recommended/Example Beta,' +
        'Kilo Gateway/Example Alpha,Kilo Gateway/Example Delta (free),' +
        'Kilo Gateway/Example Provider: Example Extremely Long Model Name,Kilo Gateway/Example Epsilon (wrapped),' +
        'Kilo Gateway/Example Zeta,Kilo Gateway/Example Eta'
    if ($got -ne $want) { throw "Unexpected rows: $got" }
    if ($rows[0].Description -ne 'Kilo Gateway' -or $null -ne $rows[3].Description -or -not $rows[0].Current -or $rows[3].Current) {
        throw 'Recent descriptions or the current-model dot were not recorded per row.'
    }
    if (($rows[1].Badges -join ',') -ne 'May train' -or ($rows[5].Badges -join ',') -ne 'May train') { throw 'Badges were not parsed.' }
    $sections = ($result.Sections | ForEach-Object { "$($_.Section)=$($_.Rows)" }) -join ','
    if ($sections -ne 'Recent=2,Recommended=2,Kilo Gateway=6') { throw "Unexpected section counts: $sections" }
    if (@($result.RepeatedLabels).Count -ne 1 -or $result.RepeatedLabels[0].Label -ne 'Example Beta' -or
        ($result.RepeatedLabels[0].Sections -join ',') -ne 'Recent,Recommended') { throw 'Repeated labels were not reported.' }
    if (@($global:mockKeys | Where-Object { $_ -notin 'Up', 'Down' }).Count -ne 0) { throw 'The walk sent a key other than Up/Down.' }
    if ($global:mk.Row -ne 0 -or $global:mk.Top -ne 0 -or -not $result.StateUnchanged) {
        throw 'The walk did not leave the dialog on its first row with the state file unchanged.'
    }
    Write-Output 'PASS the walk wraps once each way and records every row with its section, badges and description'

    $dir = Reset-Fixture 'skip'
    $global:mockSkipAt = 6
    Assert-Throws { Invoke-Capture $dir } 'panel named|walk visited|scrolled up|jumped' 'A skipped row'
    Write-Output 'PASS a skipped row stops the capture'

    $dir = Reset-Fixture 'state'
    $global:mockWriteOnKey = 4
    Assert-Throws { Invoke-Capture $dir } 'model state file changed' 'A state change during the walk'
    Write-Output 'PASS a model state change stops the capture before the next key'

    $dir = Reset-Fixture 'closed'
    $global:mockClosed = $true
    Assert-Throws { Invoke-Capture $dir } 'Open the Kilo model dialog' 'A closed dialog'
    $dir = Reset-Fixture 'nonempty'
    Set-Content -LiteralPath (Join-Path $dir 'evidence\previous.txt') -Value 'previous capture'
    Assert-Throws { Invoke-Capture $dir } 'new empty evidence directory' 'An existing evidence directory'
    Write-Output 'PASS rejects a closed dialog and reused evidence'
} finally {
    foreach ($name in $globals) { Remove-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue }
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'kilo-capture-test-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
