<#
.SYNOPSIS
    Exercises Claude capture against an isolated simulated UI; never opens a desktop or CLI.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('claude-capture-test-' + [Guid]::NewGuid().ToString('N'))
$subject = Join-Path $PSScriptRoot '../scripts/Capture-ClaudePicker.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
$script:mockRow = 2
$script:mockTop = 1
$script:mockHashReads = 0
# Effort is one picker-wide level. A row lacking it shows its highest level below it, and a
# Right press makes the next level of that row the picker-wide level.
$script:mockRank = @('Low','Medium','High','xHigh','Max')
$script:mockLevel = if ($global:mockStartLevel) { $global:mockStartLevel } else { 'High' }
$script:mockModels = @(
    @{ Label='Example Default (recommended)'; Desc='Example One with 1M context'; Current=$false
       Levels=@('Low','Medium','High'); Default='Medium'; Detail=@{} }
    @{ Label='Example Alpha'; Desc='Example Two'; Current=$true
       Levels=@('Low','Medium','High','Max'); Default='High'; Detail=@{ Max='Uses more tokens.' } }
    @{ Label='Example Mini'; Desc='Example Three'; Current=$false; Levels=@(); Default=$null; Detail=@{} }
)
function Get-MockLevel($m) {
    if ($m.Levels -contains $script:mockLevel) { return $script:mockLevel }
    $limit = [array]::IndexOf($script:mockRank, $script:mockLevel)
    @($m.Levels | Where-Object { [array]::IndexOf($script:mockRank, $_) -le $limit })[-1]
}
function Get-WindowsUiTarget { param($Title, $ProcessName); [pscustomobject]@{Title=$Title} }
function Assert-WindowsUiFocus($Target) { }
function Get-FileHash { param($LiteralPath, $Algorithm)
    $script:mockHashReads++
    [pscustomobject]@{Hash=$(if ($global:simulateFinalChange -and $script:mockHashReads -ge 5) {'changed'} else {'baseline'})}
}
function Get-WindowsUiText($Target) {
    $mark = [char]0x276F; $nbsp = [char]0xA0; $check = [char]0x2714
    $lines = @("$mark$nbsp/model", '', '  Select model', '  Switch between models.', '')
    # $global:mockVisible simulates a scrolled window: edge arrows, padded numbers, hidden count.
    $count = $script:mockModels.Count
    $visible = if ($global:mockVisible) { $global:mockVisible } else { $count }
    if ($script:mockRow -lt $script:mockTop) { $script:mockTop = $script:mockRow }
    if ($script:mockRow -gt $script:mockTop + $visible - 1) { $script:mockTop = $script:mockRow - $visible + 1 }
    $last = [Math]::Min($count, $script:mockTop + $visible - 1)
    for ($i=$script:mockTop - 1; $i -lt $last; $i++) {
        $m = $script:mockModels[$i]
        $lead = if ($i + 1 -eq $script:mockRow) { "  $mark$nbsp" }
            elseif ($i + 1 -eq $script:mockTop -and $script:mockTop -gt 1) { "  $([char]0x2191) " }
            elseif ($i + 1 -eq $last -and $last -lt $count) { "  $([char]0x2193) " }
            else { '    ' }
        $number = if ($global:mockVisible) { "$($i + 1).  " } else { "$($i + 1). " }
        $label = if ($m.Current) { "$($m.Label) $check" } else { $m.Label }
        $lines += "$lead$number$label    $($m.Desc)"
    }
    $hidden = $count - ($last - $script:mockTop + 1)
    if ($hidden -gt 0) { $lines += "     $([char]0x2026) +$hidden $(if ($hidden -eq 1) { 'model' } else { 'models' })" }
    $lines += ''
    $m = $script:mockModels[$script:mockRow - 1]
    if ($m.Levels.Count -eq 0) {
        $lines += "  $([char]0x25CB) Effort not supported for $($m.Label)"
    } else {
        $level = Get-MockLevel $m
        $suffix = if ($level -eq $m.Default) { ' (default)' } else { '' }
        $lines += "  $([char]0x25CF) $level effort$suffix $([char]0x2190)/$([char]0x2192) to adjust"
        if ($m.Detail.ContainsKey($level)) { $lines += "  $($m.Detail[$level])" }
    }
    $lines += ''
    $lines += "  Enter to set as default $([char]0xB7) s to use this session only $([char]0xB7) Esc to cancel"
    return ($lines -join "`n")
}
function Save-WindowsUiSnapshot { param($Target, $OutputPrefix)
    $text = Get-WindowsUiText $Target
    $text | Set-Content -LiteralPath ($OutputPrefix + '.txt')
    [pscustomobject]@{Text=$text}
}
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    $m = $script:mockModels[$script:mockRow - 1]
    switch ($Key) {
        Down { $script:mockRow++ }
        Up { $script:mockRow-- }
        Right { if ($m.Levels.Count -gt 0) {
            $script:mockLevel = $m.Levels[([array]::IndexOf($m.Levels, (Get-MockLevel $m)) + 1) % $m.Levels.Count] } }
        Left { if ($m.Levels.Count -gt 0) {
            $script:mockLevel = $m.Levels[([array]::IndexOf($m.Levels, (Get-MockLevel $m)) + $m.Levels.Count - 1) % $m.Levels.Count] } }
        default { throw "Capture sent a saving or unexpected key: $Key" }
    }
}
function Wait-WindowsUiText { param($Target, $ExpectedText)
    $text = Get-WindowsUiText $Target
    if ($text -notmatch $ExpectedText) {throw 'Expected UI transition not reached'}
    $text
}
'@ | Set-Content -LiteralPath $mock -Encoding UTF8

try {
    foreach ($mode in @('KeyScreens','All','None')) {
        $global:simulateFinalChange = $false
        $output = Join-Path $scratch $mode
        $null = New-Item -ItemType Directory -Path $output
        $result = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -OutputDirectory $output `
            -ConfigPath 'simulated-config' -ExpectedModelCount 3 -Screenshots $mode | ConvertFrom-Json
        $expectedImages = @{KeyScreens=4; All=13; None=0}[$mode]
        if ($result.CapturedModels.Count -ne 3 -or $result.TextCaptures -ne 13 -or
            $result.Screenshots -ne $expectedImages -or -not $result.ConfigUnchanged) {
            throw "Capture coverage or screenshot policy was incorrect in $mode"
        }
        $first = $result.CapturedModels[0]
        $second = $result.CapturedModels[1]
        $third = $result.CapturedModels[2]
        if (($first.EffortCycle.Level -join ',') -ne 'High,Low,Medium' -or
            (@($first.EffortCycle | Where-Object Default).Level -join ',') -ne 'Medium' -or
            -not $first.CycleComplete) {
            throw 'Starting-level cycle or default marker was not recorded'
        }
        if ($second.Label -ne 'Example Alpha' -or -not $second.Current -or
            (@($second.EffortCycle | Where-Object { $_.Level -eq 'Max' }).Detail -join '') -ne 'Uses more tokens.') {
            throw 'Current marker, label trimming or effort detail was incorrect'
        }
        if (-not $third.Unsupported -or $third.EffortCycle.Count -ne 1) {
            throw 'Unsupported effort was cycled or not recorded'
        }
        Write-Output "PASS $mode traversal with arrow keys only"
    }
    $global:simulateFinalChange = $true
    $output = Join-Path $scratch 'final-change'
    $null = New-Item -ItemType Directory -Path $output
    $failed = $false
    try {
        $null = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -OutputDirectory $output `
            -ConfigPath 'simulated-config' -ExpectedModelCount 3 -Screenshots None -WarningAction SilentlyContinue
    } catch {
        if ($_.Exception.Message -notmatch 'before final verification') {throw}
        $failed = $true
    }
    if (-not $failed) {throw 'A final config change incorrectly reported success'}
    Write-Output 'PASS config change after last model rejects success'

    $failed = $false
    try {
        $null = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -OutputDirectory $output `
            -ConfigPath 'simulated-config' -ExpectedModelCount 3
    } catch {
        if ($_.Exception.Message -notmatch 'new empty evidence directory') {throw}
        $failed = $true
    }
    if (-not $failed) {throw 'Existing evidence was not protected'}
    Write-Output 'PASS refuses to overwrite previous capture evidence'

    $global:simulateFinalChange = $false
    $output = Join-Path $scratch 'count-mismatch'
    $null = New-Item -ItemType Directory -Path $output
    $failed = $false
    try {
        $null = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -OutputDirectory $output `
            -ConfigPath 'simulated-config' -ExpectedModelCount 4 -Screenshots None
    } catch {
        if ($_.Exception.Message -notmatch 'differs from expected coverage') {throw}
        $failed = $true
    }
    if (-not $failed) {throw 'A missing model row was not rejected'}
    Write-Output 'PASS rejects a visible row count that differs from expected coverage'

    $global:mockVisible = 2
    $output = Join-Path $scratch 'scrolled'
    $null = New-Item -ItemType Directory -Path $output
    $result = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -OutputDirectory $output `
        -ConfigPath 'simulated-config' -ExpectedModelCount 3 -Screenshots None | ConvertFrom-Json
    if (($result.CapturedModels.Label -join '|') -ne 'Example Default (recommended)|Example Alpha|Example Mini' -or
        -not $result.CapturedModels[1].Current -or -not $result.CapturedModels[2].Unsupported -or
        (@($result.CapturedModels[0].EffortCycle | Where-Object Default).Level -join ',') -ne 'Medium') {
        throw 'A scrolled list did not yield every row with its effort cycle'
    }
    Write-Output 'PASS scrolled list reads out-of-view rows and returns to the start'

    $output = Join-Path $scratch 'scrolled-count'
    $null = New-Item -ItemType Directory -Path $output
    $failed = $false
    try {
        $null = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -OutputDirectory $output `
            -ConfigPath 'simulated-config' -ExpectedModelCount 2 -Screenshots None
    } catch {
        if ($_.Exception.Message -notmatch 'differs from expected coverage') {throw}
        $failed = $true
    }
    if (-not $failed) {throw 'Out-of-view rows were not counted toward expected coverage'}
    Write-Output 'PASS counts out-of-view rows toward expected coverage'

    $global:mockVisible = $null
    $global:mockStartLevel = 'Max'
    $output = Join-Path $scratch 'shared-effort'
    $null = New-Item -ItemType Directory -Path $output
    $result = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -OutputDirectory $output `
        -ConfigPath 'simulated-config' -ExpectedModelCount 3 -Screenshots None | ConvertFrom-Json
    if (($result.CapturedModels[0].EffortCycle.Level -join ',') -ne 'High,Low,Medium' -or
        ($result.CapturedModels[1].EffortCycle.Level -join ',') -ne 'High,Max,Low,Medium') {
        throw 'A row without the starting level was not cycled from its shown level'
    }
    Write-Output 'PASS restores a picker-wide starting effort that another row lacked'
} finally {
    Remove-Variable -Name mockStartLevel -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable -Name simulateFinalChange -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable -Name mockVisible -Scope Global -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'claude-capture-test-*') {throw 'Unsafe fixture cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
