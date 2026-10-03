<#
.SYNOPSIS
    Exercises the Junie picker capture against a simulated UI; never opens a desktop window or
    starts Junie.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('junie-capture-test-' + [Guid]::NewGuid().ToString('N'))
$capture = Join-Path $PSScriptRoot '../scripts/Capture-JuniePicker.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
# Simulated Junie 26.9.22 /model picker with the real layout and synthetic model names.
$jA = [string][char]0x2192; $jL = [string][char]0x2039; $jR = [string][char]0x203A
$global:jk = @{ Row = 1; Models = @(
    @{ Name = 'Default (Example Flash)  70% off'; In = '$0.40'; Out = '$2.40'; Ring = @('High', 'Low', 'Medium'); At = 0; Desc = 'Example default row.' }
    @{ Name = 'Example Lite  Free'; In = '$0.15'; Out = '$0.90'; Ring = @('None'); At = 0; Desc = 'Example single-value row.' }
    @{ Name = 'Example Pro'; In = '$4.00'; Out = '$20.00'; Ring = @('Low', 'Medium', 'High', 'XHigh', 'Max'); At = 3; Desc = 'Example row with a saved effort.' }
    @{ Name = 'Example GPT'; In = '$2.00'; Out = '$10.00'; Ring = @('Low', 'Medium', 'High', 'XHigh', 'Max', 'None'); At = 0; Desc = 'Example row whose None follows Max.' }
) }
$global:mockKeys = @()
function Get-WindowsUiTarget { param($Title, $ProcessName) [pscustomobject]@{ Title = $Title } }
function Set-WindowsUiFocus { param($Target) }
function Assert-WindowsUiFocus { param($Target) }
function Get-WindowsUiText { param($Target)
    $s = $global:jk
    $lines = @('     Select model', '     Current model: Example Lite JetBrains AI', '',
        '   >   Start typing to search for models', '',
        '     Name                                   Input     Output               Effort      Provider')
    for ($i = 0; $i -lt $s.Models.Count; $i++) {
        $m = $s.Models[$i]
        $lead = if ($i -eq $s.Row) { "   $jA " } else { '     ' }
        $lines += $lead + $m.Name.PadRight(39) + $m.In.PadRight(10) + ($m.Out + ' per Mtok').PadRight(19) +
            ("$jL " + $m.Ring[$m.At] + " $jR").PadRight(12) + 'JetBrains AI'
    }
    $lines += ('     {0}/{1}' -f ($s.Row + 1), $s.Models.Count), '', ('     ' + $s.Models[$s.Row].Desc)
    $lines -join "`n"
}
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    $global:mockKeys += $Key
    $s = $global:jk; $m = $s.Models[$s.Row]
    switch ($Key) {
        'Up' { $s.Row = [Math]::Max(0, $s.Row - 1) }
        'Down' { $s.Row = [Math]::Min($s.Models.Count - 1, $s.Row + 1) }
        'Right' {
            if ($global:mockStuckRing -and $m.Name -eq 'Example Pro') { $m.At = [Math]::Min($m.At + 1, $m.Ring.Count - 1) }
            else { $m.At = ($m.At + 1) % $m.Ring.Count }
        }
        default { throw "Capture sent a selecting, closing or unexpected key: $Key" }
    }
}
'@ | Set-Content -LiteralPath $mock -Encoding UTF8

$globals = 'jk', 'mockKeys', 'mockStuckRing'
function Reset-Fixture([string]$Name) {
    foreach ($variable in $globals) { Remove-Variable -Name $variable -Scope Global -ErrorAction SilentlyContinue }
    $dir = Join-Path $scratch $Name
    $null = New-Item -ItemType Directory -Path (Join-Path $dir 'evidence')
    [IO.File]::WriteAllText((Join-Path $dir 'settings.json'), '{"effortPerModel":"{}"}')
    return $dir
}
function Invoke-Capture([string]$Dir, [hashtable]$Extra = @{}) {
    $params = @{ UiHelperPath = $mock; WindowTitle = 'Fixture'; OutputDirectory = (Join-Path $Dir 'evidence')
        ConfigPath = (Join-Path $Dir 'settings.json'); ExpectedModelCount = 4; TimeoutMilliseconds = 500 }
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
    $source = Get-Content -Raw -LiteralPath $capture
    if ($source -match "-Key\s+['""]?(Enter|Escape)\b" -or $source -match '\[uint16\]\s*(13|27)\b') {
        throw 'The capture script contains an Enter or Escape key send.'
    }
    if ($source -match '[^\x00-\x7F]') { throw 'The capture script is not ASCII; Windows PowerShell 5.1 would misread it.' }
    Write-Output 'PASS the script is ASCII and contains no Enter/Escape sends'

    $dir = Reset-Fixture 'walk'
    $result = Invoke-Capture $dir
    $rows = @((Get-Content -Raw -LiteralPath (Join-Path $dir 'evidence\rows.json') | ConvertFrom-Json) | ForEach-Object { $_ })
    $cycles = ($rows | ForEach-Object { $_.Name + '=' + ($_.EffortCycle -join '>') }) -join ';'
    $expected = 'Default (Example Flash)=High>Low>Medium;Example Lite=None;Example Pro=XHigh>Max>Low>Medium>High;' +
        'Example GPT=Low>Medium>High>XHigh>Max>None'
    if ($cycles -ne $expected) { throw "Unexpected cycles: $cycles" }
    if ($rows[0].Badge -ne '70% off' -or $rows[1].Badge -ne 'Free' -or $null -ne $rows[2].Badge -or
        $rows[2].Input -ne '$4.00' -or $rows[3].Description -ne 'Example row whose None follows Max.') {
        throw 'Badges, prices or descriptions were not recorded as shown.'
    }
    if (($result.SingleValueRows -join ',') -ne 'Example Lite' -or -not $result.ConfigUnchanged -or $result.StartRow -ne 2) {
        throw 'The single-value row, settings check or start row was not reported.'
    }
    $ends = ($global:jk.Models | ForEach-Object { $_.Ring[$_.At] }) -join ','
    if ($global:jk.Row -ne 1 -or $ends -ne 'High,None,XHigh,Low') {
        throw "The picker was not left on its starting row with every effort restored: row $($global:jk.Row), $ends"
    }
    if (@($global:mockKeys | Where-Object { $_ -notin 'Up', 'Down', 'Right' }).Count -ne 0) { throw 'A key other than Up/Down/Right was sent.' }
    Write-Output 'PASS walk records every row, badge and effort cycle, and restores the start'

    $dir = Reset-Fixture 'count'
    Assert-Throws { Invoke-Capture $dir @{ ExpectedModelCount = 5 } } 'not the expected 5' 'A wrong expected count'
    if (@($global:mockKeys).Count -ne 0) { throw 'A key was sent before the count check.' }
    $dir = Reset-Fixture 'stuck'
    $global:mockStuckRing = $true
    Assert-Throws { Invoke-Capture $dir } 'did not return' 'A cycle that never returns to its start'
    $dir = Reset-Fixture 'nonempty'
    Set-Content -LiteralPath (Join-Path $dir 'evidence\previous.txt') -Value 'previous capture'
    Assert-Throws { Invoke-Capture $dir } 'new empty evidence directory' 'An existing evidence directory'
    Write-Output 'PASS rejects a wrong count, a cycle that never returns and reused evidence'
} finally {
    foreach ($name in $globals) { Remove-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue }
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'junie-capture-test-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
