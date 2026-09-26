<#
.SYNOPSIS
    Exercises Auggie picker capture against a simulated UI; never opens a desktop window or starts
    Auggie.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('auggie-capture-test-' + [Guid]::NewGuid().ToString('N'))
$capture = Join-Path $PSScriptRoot '../scripts/Capture-AuggiePicker.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
# Simulated Auggie 0.36.0 /model picker with the real layout and synthetic model names.
$V = [string][char]0x2502; $DOT = [string][char]0x25CF; $UP = [string][char]0x2191; $DN = [string][char]0x2193
$models = @(
    @{ L = 'Example Large'; C = '$$$$'; D = 'Example model for long tasks' }
    @{ L = 'Example Medium'; C = '$$'; D = 'Example model for coding' }
    @{ L = 'Example Small'; C = '$'; D = 'Example model for quick tasks' }
    @{ L = 'Example Default'; C = '$$$'; D = 'Example model marked default' }
    @{ L = 'Example Router'; C = '$$$'; B = '[New] [Auto] '; D = 'Routes between example models' }
    @{ L = 'Example Legacy'; C = '$$'; D = 'Older example model' }
    @{ L = 'Example Mini'; C = '$'; D = 'Example model, 1M context' }
)
# All simulator state lives in one global table so it cannot collide with capture-script variables.
$global:mk = @{ Models = $models; Current = 2; Row = 2; Top = 0; Visible = 3; Mode = 'picker'; History = @()
    BottomSeen = $false; UpSkipped = $false }
if ($global:mockStartMode) { $global:mk.Mode = $global:mockStartMode }
$global:mockKeys = @()
function Set-MockWindow { $s = $global:mk
    if ($s.Row -lt $s.Top) { $s.Top = $s.Row }
    if ($s.Row -ge $s.Top + $s.Visible) { $s.Top = $s.Row - $s.Visible + 1 } }
Set-MockWindow
function Get-WindowsUiTarget { param($Title, $ProcessName) [pscustomobject]@{ Title = $Title } }
function Set-WindowsUiFocus { param($Target) }
function Get-WindowsUiText { param($Target)
    $s = $global:mk; $lines = @('Indexing disabled for current workspace')
    switch ($s.Mode) {
        'picker' {
            $lines += "$V", "$V  Select model for this session", "$V"
            if ($s.Top -gt 0) { $lines += "$V  $UP $($s.Top) more" }
            $end = [Math]::Min($s.Models.Count, $s.Top + $s.Visible) - 1
            foreach ($n in $s.Top..$end) {
                $m = $s.Models[$n]; $label = $m.L
                if ($n -eq $s.Current) { $label += ' (current)' }
                if ($n -eq 3) { $label += ' (default)' }
                $mark = if ($n -eq $s.Row) { "$DOT " } else { '  ' }
                $lines += ("$V  $mark{0,-60}{1}{2}" -f $label, $m.B, $m.C), "$V    $($m.D)", "$V"
            }
            $below = $s.Models.Count - $end - 1
            if ($below -gt 0) { $lines += "$V  $DN $below more" }
            $lines += ' [Up/Down] Navigate [Enter] Select [/] Search [Esc] Cancel'
        }
        'effort' { $lines += "$V  Select reasoning effort", "$V  $DOT high" }
        default {
            $lines += $s.History
            if ($s.Mode -eq 'palette') { $lines += '> /', 'Enter command' }
            elseif ($s.Mode -eq 'palette-model') { $lines += '> /model', 'model Select the model for this session' }
            else { $lines += ' ? to show shortcuts' }
        }
    }
    $lines -join "`n"
}
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    $s = $global:mk; $last = $s.Models.Count - 1
    $global:mockKeys += $Key
    if ($global:mockWriteOnKey -eq $global:mockKeys.Count) { Add-Content -LiteralPath $global:mockConfigPath -Value 'x' }
    switch ($Key) {
        'Down' { if ($s.Row -lt $last) { $s.Row++ }; if ($s.Row -eq $last) { $s.BottomSeen = $true } }
        'Up' { $step = if ($global:mockUpSkip -and $s.BottomSeen -and -not $s.UpSkipped) { $s.UpSkipped = $true; 2 } else { 1 }
            $s.Row = [Math]::Max(0, $s.Row - $step) }
        'Enter' {
            if ($s.Mode -eq 'palette-model') { $s.Mode = 'picker'; $s.Row = $s.Current }
            elseif ($global:mockEffortStep) { $s.Mode = 'effort' }
            else { $s.Current = $s.Row; $s.Mode = 'prompt'; $s.History += "$DOT Using model: $($s.Models[$s.Row].L)" }
        }
        default { throw "Capture sent an unexpected key: $Key" }
    }
    Set-MockWindow
}
function Send-WindowsUiText { param($Target, $Text, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    if ($Text -eq '/' -and $global:mk.Mode -eq 'prompt') { $global:mk.Mode = 'palette' }
    elseif ($Text -eq 'model' -and $global:mk.Mode -eq 'palette') { $global:mk.Mode = 'palette-model' }
    else { throw "Unexpected text: $Text" }
}
function Wait-WindowsUiText { param($Target, $ExpectedText)
    $text = Get-WindowsUiText $Target
    if ($text -notmatch $ExpectedText) { throw 'Expected UI transition not reached' }
    $text
}
function Save-WindowsUiSnapshot { param($Target, $OutputPrefix)
    Get-WindowsUiText $Target | Set-Content -LiteralPath ($OutputPrefix + '.txt') -Encoding UTF8
    [pscustomobject]@{ Image = $OutputPrefix + '.png' }
}
'@ | Set-Content -LiteralPath $mock -Encoding UTF8

$globals = 'mockStartMode', 'mockWriteOnKey', 'mockUpSkip', 'mockEffortStep', 'mockKeys', 'mockConfigPath', 'mk'
function Reset-Fixture([string]$Name) {
    foreach ($variable in $globals) { Remove-Variable -Name $variable -Scope Global -ErrorAction SilentlyContinue }
    $dir = Join-Path $scratch $Name
    $null = New-Item -ItemType Directory -Path (Join-Path $dir 'evidence')
    $global:mockConfigPath = Join-Path $dir 'settings.json'
    [IO.File]::WriteAllText($global:mockConfigPath, '{"model":"example"}')
    return $dir
}
function Invoke-Capture([string]$Dir, [hashtable]$Extra = @{}) {
    $params = @{ UiHelperPath = $mock; WindowTitle = 'Fixture'; OutputDirectory = (Join-Path $Dir 'evidence')
        ConfigPath = $global:mockConfigPath; ExpectedModelCount = 7; TimeoutSeconds = 1 }
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
function Get-Digest { [IO.File]::ReadAllText($global:mockConfigPath) }

try {
    $dir = Reset-Fixture 'walk'
    $result = Invoke-Capture $dir @{ Screenshots = 'None' }
    $rows = @((Get-Content -Raw -LiteralPath (Join-Path $dir 'evidence\rows.json') | ConvertFrom-Json) | ForEach-Object { $_ })
    $labels = ($rows | ForEach-Object Label) -join ','
    if ($result.Rows -ne 7 -or $labels -ne 'Example Large,Example Medium,Example Small,Example Default,Example Router,Example Legacy,Example Mini') {
        throw "Unexpected rows: $labels"
    }
    if (($result.Current -join ',') -ne 'Example Small' -or ($result.Default -join ',') -ne 'Example Default') {
        throw 'The (current) and (default) suffixes were not recorded separately.'
    }
    $router = $rows[4]
    if (($router.Badges -join ',') -ne 'New,Auto' -or $router.Cost -ne '$$$' -or $router.Description -ne 'Routes between example models') {
        throw 'Badges, cost or description were not parsed.'
    }
    if (@($global:mockKeys | Where-Object { $_ -notin 'Up', 'Down' }).Count -ne 0) { throw 'The walk sent a key other than Up/Down.' }
    if ($global:mk.Row -ne 0 -or $global:mk.Mode -ne 'picker' -or $global:mk.Current -ne 2) {
        throw 'The walk did not leave the open picker on the first row without selecting.'
    }
    if ((Get-Digest) -ne '{"model":"example"}' -or -not $result.ConfigUnchanged -or $result.Probed -ne 0) {
        throw 'The walk changed the settings file or probed without -ProbeSelection.'
    }
    Write-Output 'PASS arrow-only walk records every row, suffixes, badges and descriptions'

    $dir = Reset-Fixture 'probe'
    $result = Invoke-Capture $dir @{ ProbeSelection = $true; Screenshots = 'None' }
    $enters = @($global:mockKeys | Where-Object { $_ -eq 'Enter' }).Count
    if (-not $result.AllDirect -or $result.Probed -ne 7 -or $enters -ne 13 -or $global:mk.Current -ne 6) {
        throw "Probe did not select each row directly (probed=$($result.Probed), enters=$enters)."
    }
    Write-Output 'PASS -ProbeSelection reopens /model and records a direct selection for every row'

    $dir = Reset-Fixture 'effort'
    $global:mockEffortStep = $true
    Assert-Throws { Invoke-Capture $dir @{ ProbeSelection = $true; Screenshots = 'None' } } 'did not select it directly' 'An effort step after Enter'
    Write-Output 'PASS an extra screen after Enter stops the probe'

    $dir = Reset-Fixture 'config'
    $global:mockWriteOnKey = 3
    Assert-Throws { Invoke-Capture $dir @{ Screenshots = 'None' } } 'settings file changed' 'A settings change during the walk'
    Write-Output 'PASS a settings change stops the capture before the next key'

    $dir = Reset-Fixture 'count'
    Assert-Throws { Invoke-Capture $dir @{ ExpectedModelCount = 8; ProbeSelection = $true; Screenshots = 'None' } } 'Stop before any probe' 'A wrong expected count'
    if (@($global:mockKeys | Where-Object { $_ -eq 'Enter' }).Count -ne 0) { throw 'A count mismatch still probed.' }
    $dir = Reset-Fixture 'direction'
    $global:mockUpSkip = $true
    Assert-Throws { Invoke-Capture $dir @{ Screenshots = 'None' } } 'Reverse walk expected' 'A list whose order differs by direction'
    $dir = Reset-Fixture 'closed'
    $global:mockStartMode = 'prompt'
    Assert-Throws { Invoke-Capture $dir } 'Open the Auggie /model picker' 'A closed picker'
    $dir = Reset-Fixture 'nonempty'
    Set-Content -LiteralPath (Join-Path $dir 'evidence\previous.txt') -Value 'previous capture'
    Assert-Throws { Invoke-Capture $dir } 'new empty evidence directory' 'An existing evidence directory'
    Write-Output 'PASS rejects wrong counts, direction mismatch, a closed picker and reused evidence'
} finally {
    foreach ($name in $globals) { Remove-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue }
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'auggie-capture-test-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
