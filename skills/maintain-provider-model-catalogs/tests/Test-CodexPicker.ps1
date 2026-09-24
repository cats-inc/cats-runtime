<#
.SYNOPSIS
    Exercises Codex capture against an isolated simulated UI; never opens a desktop or CLI.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('codex-capture-test-' + [Guid]::NewGuid().ToString('N'))
$subject = Join-Path $PSScriptRoot '../scripts/Capture-CodexPicker.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
$script:menu = 'models'
$script:model = 1
$script:level = 1
$script:hashReads = 0
function Get-WindowsUiTarget { param($Title, $ProcessName); [pscustomobject]@{Title=$Title} }
function Assert-WindowsUiFocus($Target) { }
function Get-FileHash { param($LiteralPath, $Algorithm)
    $script:hashReads++
    [pscustomobject]@{Hash=$(if ($global:simulateFinalChange -and $script:hashReads -ge 4) {'changed'} else {'baseline'})}
}
function Get-WindowsUiText($Target) {
    $arrow = [char]0x203a
    if ($script:menu -eq 'models') {
        $a = if ($script:model -eq 1) {$arrow} else {' '}
        $b = if ($script:model -eq 2) {$arrow} else {' '}
        return "Select Model and Effort`n$a 1. Example Alpha (default)  First model`n$b 2. Example Beta  Second model`nenter select $([char]0xb7) esc back"
    }
    if ($script:menu -eq 'advanced') { return "Advanced Reasoning`n$arrow 1. Max  Advanced level`nenter default $([char]0xb7) esc back" }
    $name = if ($script:model -eq 1) {'Example Alpha'} else {'Example Beta'}
    $a = if ($script:level -eq 1) {$arrow} else {' '}
    $b = if ($script:level -eq 2) {$arrow} else {' '}
    $rows = "$a 1. Low (default)  Fast"
    if ($script:model -eq 1) { $rows += "`n$b 2. More reasoning$([char]0x2026)  Usage warning" }
    return "Select Reasoning Level for $name`n$rows`nenter default $([char]0xb7) esc back"
}
function Save-WindowsUiSnapshot { param($Target, $OutputPrefix)
    $text = Get-WindowsUiText $Target
    $text | Set-Content -LiteralPath ($OutputPrefix + '.txt')
    [pscustomobject]@{Text=$text}
}
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    switch ($Key) {
        Down { if ($script:menu -eq 'models') {$script:model++} else {$script:level++} }
        Up { if ($script:menu -eq 'models') {$script:model--} else {$script:level--} }
        Enter {
            if ($script:menu -eq 'models') {$script:menu='effort'; $script:level=1}
            elseif ($script:menu -eq 'effort' -and $script:model -eq 1 -and $script:level -eq 2) {$script:menu='advanced'}
            else {throw 'Capture attempted to confirm a final effort'}
        }
        Escape { if ($script:menu -eq 'advanced') {$script:menu='effort'} else {$script:menu='models'} }
        default { throw 'Unexpected capture key' }
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
            -ConfigPath 'simulated-config' -ExpectedModelCount 2 -Screenshots $mode | ConvertFrom-Json
        $expectedImages = @{KeyScreens=4; All=8; None=0}[$mode]
        if ($result.CapturedModels.Count -ne 2 -or $result.TextCaptures -ne 8 -or
            $result.Screenshots -ne $expectedImages -or -not $result.ConfigUnchanged) {
            throw 'Capture coverage or screenshot policy was incorrect'
        }
        Write-Output "PASS $mode traversal without confirming an effort"
    }
    $global:simulateFinalChange = $true
    $output = Join-Path $scratch 'final-change'
    $null = New-Item -ItemType Directory -Path $output
    $failed = $false
    try {
        $null = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -OutputDirectory $output `
            -ConfigPath 'simulated-config' -ExpectedModelCount 2 -Screenshots None -WarningAction SilentlyContinue
    } catch {
        if ($_.Exception.Message -notmatch 'before final verification') {throw}
        $failed = $true
    }
    if (-not $failed) {throw 'A final config change incorrectly reported success'}
    Write-Output 'PASS config change after last model rejects success'

    $failed = $false
    try {
        $null = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -OutputDirectory $output `
            -ConfigPath 'simulated-config' -ExpectedModelCount 2
    } catch {
        if ($_.Exception.Message -notmatch 'new empty evidence directory') {throw}
        $failed = $true
    }
    if (-not $failed) {throw 'Existing evidence was not protected'}
    Write-Output 'PASS refuses to overwrite previous capture evidence'
} finally {
    Remove-Variable -Name simulateFinalChange -Scope Global -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'codex-capture-test-*') {throw 'Unsafe fixture cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
