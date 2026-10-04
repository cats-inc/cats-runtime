<#
.SYNOPSIS
    Offline synthetic traversal/guard tests; starts no CLI and sends no native input.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('agy-picker-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
$script:row = 0
function Get-WindowsUiTarget { param($Title, $ProcessName); @{Title=$Title} }
function Assert-WindowsUiFocus($Target) { }
function Get-FileHash { param($LiteralPath, $Algorithm); @{Hash=$(if ($global:changed -and $script:row -eq 1) {'changed'} else {'baseline'})} }
function Get-WindowsUiText($Target) {
    $lines = @('private@example.invalid', 'Switch Model', '', '  Search:', '  -----', '')
    for ($i = 0; $i -lt 3; $i++) {
        $label = @('Example Alpha','Example Beta','Example Fixed')[ $i ]
        $lead = if ($script:row -eq $i) {'> '} else {'  '}
        $lines += $lead + $label
    }
    if ($script:row -lt 2) { $lines += @('', '  Effort  slider', '    low   medium   high') }
    if (-not $global:truncated) { $lines += 'Keyboard: Navigate enter Select esc Go Back' }
    $lines -join "`n"
}
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Wrong guard' }
    switch ($Key) { Down {$script:row++} Up {$script:row--} default {throw 'Unexpected saving/toggle key'} }
}
function Wait-WindowsUiText { param($Target, $ExpectedText)
    $text = Get-WindowsUiText $Target
    if ($text -notmatch $ExpectedText) { throw 'Transition failed' }
    $text
}
'@ | Set-Content -LiteralPath $mock -Encoding UTF8
try {
    foreach ($case in @('normal', 'changed', 'truncated')) {
        $global:changed = $case -eq 'changed'
        $global:truncated = $case -eq 'truncated'
        $output = Join-Path $scratch $case
        $null = New-Item -ItemType Directory -Path $output
        $failed = $false
        try {
            $result = & (Join-Path $PSScriptRoot '../scripts/Capture-AntigravityPicker.ps1') `
                -UiHelperPath $mock -WindowTitle Fixture -OutputDirectory $output -ConfigPath unused `
                -ModelLabels @('Example Alpha','Example Beta','Example Fixed') | ConvertFrom-Json
        } catch {
            if ($case -eq 'normal') { throw }
            $failed = $true
        }
        if (($case -ne 'normal') -ne $failed) { throw "Unexpected outcome: $case" }
        if ($case -eq 'normal') {
            if ($result.TextCaptures -ne 3 -or -not $result.ConfigUnchanged) { throw 'Incomplete capture' }
            if ((Get-Content (Join-Path $output 'row-01.txt') -Raw) -match 'private@') { throw 'Account banner retained' }
            if ((Get-Content (Join-Path $output 'row-03.txt') -Raw) -match 'Effort') { throw 'Invented effort for fixed row' }
        }
        Write-Output "PASS $case"
    }
} finally {
    # The only recursive target is this generated child of the repository's private tmp root.
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
