<#
.SYNOPSIS
    Exercises the Kiro V3 picker capture against a simulated UI; never opens a desktop window or
    starts Kiro.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('kiro-capture-test-' + [Guid]::NewGuid().ToString('N'))
$capture = Join-Path $PSScriptRoot '../scripts/Capture-KiroPicker.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
# Simulated Kiro 2.30.0 V3 /model picker with the real layout and synthetic model names:
# four visible rows, "(+N more)" below and no indicator for rows scrolled out above.
$kP = [string][char]0x276F; $kQ = [string][char]0x203A; $kLine = ([string][char]0x2500) * 40
$global:kk = @{ Row = 2; Top = 0; Panel = 2; Size = 4; Models = @(
    @{ Id = 'auto'; Rate = '1.00x'; Desc = 'Example routing row'; Thinking = 'n/a'; Effort = 'n/a' }
    @{ Id = 'example-opus'; Rate = '2.00x'; Desc = 'Example large model'; Thinking = 'n/a'; Effort = 'xhigh' }
    @{ Id = 'example-sonnet'; Rate = '1.30x'; Desc = 'Example active model'; Thinking = 'on'; Effort = 'high' }
    @{ Id = 'example-gpt'; Rate = '4.40x'; Desc = 'Example toggle-free model'; Thinking = 'n/a'; Effort = 'high' }
    @{ Id = 'example-haiku'; Rate = '0.40x'; Desc = ''; Thinking = 'n/a'; Effort = 'n/a' }
    @{ Id = 'example-glm'; Rate = '0.50x'; Desc = 'Example model'; Thinking = 'n/a'; Effort = 'n/a' }
    @{ Id = 'example-next'; Rate = '0.05x'; Desc = '[EOL] Example retiring model. Model reaches end of lif...'; Thinking = 'n/a'; Effort = 'n/a' }
) }
$global:mockKeys = @()
function Get-WindowsUiTarget { param($Title, $ProcessName) [pscustomobject]@{ Title = $Title } }
function Set-WindowsUiFocus { param($Target) }
function Assert-WindowsUiFocus { param($Target) }
function Get-WindowsUiText { param($Target)
    $s = $global:kk
    $lines = @(('Default ' + [char]0x00B7 + ' auto'), "$kQ /model", 'Select model:   type to search')
    $end = [Math]::Min($s.Top + $s.Size, $s.Models.Count) - 1
    for ($i = $s.Top; $i -le $end; $i++) {
        $m = $s.Models[$i]
        $lead = if ($i -eq $s.Row) { "$kP " } else { '  ' }
        $desc = if ($i -eq 2) { '[active] ' + $m.Desc } else { $m.Desc }
        $lines += ($lead + $m.Id.PadRight(19) + ($m.Rate + ' credits').PadRight(17) + $desc).TrimEnd()
    }
    $below = $s.Models.Count - 1 - $end
    if ($below -gt 0) { $lines += "(+$below more)" }
    $p = $s.Models[$s.Panel]
    $heading = if ($s.Panel -eq 2) { 'Settings for selected model: ' } else { 'Settings for model: ' }
    $lines += $kLine, (' ' + $heading + $p.Id + '                tab to switch panels')
    $note = { param($v) if ($v -eq 'n/a') { 'Not available for this model.' } else { 'Example setting text.' } }
    $lines += ('  thinking  ' + $p.Thinking.PadRight(7) + (& $note $p.Thinking)), ('  effort    ' + $p.Effort.PadRight(7) + (& $note $p.Effort))
    $lines += $kLine, ' esc to close'
    # The panel catches up with the highlight one read later when mockPanelLag is set.
    $s.Panel = $s.Row
    $lines -join "`n"
}
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    $global:mockKeys += $Key
    $s = $global:kk
    switch ($Key) {
        'Up' { $s.Row = [Math]::Max(0, $s.Row - 1) }
        'Down' { $s.Row = [Math]::Min($s.Models.Count - 1, $s.Row + 1) }
        default { throw "Capture sent a selecting, closing, value-changing or unexpected key: $Key" }
    }
    if ($s.Row -lt $s.Top) { $s.Top = $s.Row }
    if ($s.Row -ge $s.Top + $s.Size) { $s.Top = $s.Row - $s.Size + 1 }
    if (-not $global:mockPanelLag) { $s.Panel = $s.Row }
    if ($global:mockTouchAt -and $global:mockKeys.Count -eq $global:mockTouchAt) {
        [IO.File]::WriteAllText($global:mockConfig, '{"chat.modelDefaults":{"example-opus":{"output_config":{"effort":"max"}}}}')
    }
}
'@ | Set-Content -LiteralPath $mock -Encoding UTF8

$globals = 'kk', 'mockKeys', 'mockPanelLag', 'mockTouchAt', 'mockConfig'
function Reset-Fixture([string]$Name) {
    foreach ($variable in $globals) { Remove-Variable -Name $variable -Scope Global -ErrorAction SilentlyContinue }
    $dir = Join-Path $scratch $Name
    $null = New-Item -ItemType Directory -Path (Join-Path $dir 'evidence')
    $global:mockConfig = Join-Path $dir 'cli.json'
    [IO.File]::WriteAllText($global:mockConfig, '{"chat.agentEngine":"v3"}')
    return $dir
}
function Invoke-Capture([string]$Dir, [hashtable]$Extra = @{}) {
    $params = @{ UiHelperPath = $mock; WindowTitle = 'Fixture'; OutputDirectory = (Join-Path $Dir 'evidence')
        ConfigPath = (Join-Path $Dir 'cli.json'); ExpectedModelCount = 7; TimeoutMilliseconds = 500 }
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
    if ($source -match "-Key\s+['""]?(Enter|Escape|Left|Right)\b" -or $source -match '\[uint16\]\s*(13|27|37|39)\b') {
        throw 'The capture script contains an Enter, Escape, Left or Right key send.'
    }
    if ($source -match '[^\x00-\x7F]') { throw 'The capture script is not ASCII; Windows PowerShell 5.1 would misread it.' }
    Write-Output 'PASS the script is ASCII and sends no Enter, Escape, Left or Right'

    $dir = Reset-Fixture 'walk'
    $global:mockPanelLag = $true
    $result = Invoke-Capture $dir
    $rows = @((Get-Content -Raw -LiteralPath (Join-Path $dir 'evidence\rows.json') | ConvertFrom-Json) | ForEach-Object { $_ })
    $labels = ($rows | ForEach-Object { $_.Label }) -join ','
    if ($labels -ne 'auto,example-opus,example-sonnet,example-gpt,example-haiku,example-glm,example-next') {
        throw "Unexpected rows: $labels"
    }
    $cells = ($rows | ForEach-Object { $_.Thinking.Value + '/' + $_.Effort.Value }) -join ','
    if ($cells -ne 'n/a/n/a,n/a/xhigh,on/high,n/a/high,n/a/n/a,n/a/n/a,n/a/n/a') { throw "Unexpected panel cells: $cells" }
    if (-not $rows[2].Active -or $rows[1].Active -or $rows[2].Description -ne 'Example active model' -or
        $rows[3].Rate -ne '4.40x credits' -or $rows[4].Description -ne '' -or
        $rows[6].Description -notlike '`[EOL`] Example retiring model*' -or $rows[0].Effort.Text -ne 'Not available for this model.') {
        throw 'Tags, rates, descriptions or panel text were not recorded as shown.'
    }
    if ($result.Rows -ne 7 -or $result.StartRow -ne 3 -or @($result.ReverseMismatches).Count -ne 0 -or -not $result.ConfigUnchanged) {
        throw 'The row count, start row, reverse check or settings check was not reported.'
    }
    if ($global:kk.Row -ne 2) { throw "The picker was not left on its starting row: row $($global:kk.Row + 1)" }
    $keys = $global:mockKeys -join ','
    if ($keys -ne (@('Up', 'Up') + @('Down') * 6 + @('Up') * 6 + @('Down', 'Down') -join ',')) { throw "Unexpected key sequence: $keys" }
    Write-Output 'PASS walk reads every row both ways through a scrolled list, waits for the panel and returns to the start'

    $dir = Reset-Fixture 'too-many'
    Assert-Throws { Invoke-Capture $dir @{ ExpectedModelCount = 5 } } 'more rows than the expected 5' 'A list longer than expected'
    if (@($global:mockKeys).Count -ne 0) { throw 'A key was sent before the longer list was detected.' }
    $dir = Reset-Fixture 'too-few'
    Assert-Throws { Invoke-Capture $dir @{ ExpectedModelCount = 9 } } 'did not reach row' 'A list shorter than expected'
    $dir = Reset-Fixture 'settings'
    $global:mockTouchAt = 4
    Assert-Throws { Invoke-Capture $dir } 'settings file changed' 'A settings write during the walk'
    if (@($global:mockKeys).Count -ne 4) { throw 'A key was sent after the settings file changed.' }
    $dir = Reset-Fixture 'nonempty'
    Set-Content -LiteralPath (Join-Path $dir 'evidence\previous.txt') -Value 'previous capture'
    Assert-Throws { Invoke-Capture $dir } 'new empty evidence directory' 'An existing evidence directory'
    Write-Output 'PASS rejects a longer or shorter list, a settings write and reused evidence'
} finally {
    foreach ($name in $globals) { Remove-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue }
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'kiro-capture-test-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
