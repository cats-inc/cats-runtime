<#
.SYNOPSIS
    Exercises Kiro picker capture and settings restore against a simulated UI; never opens a
    desktop window or starts Kiro.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('kiro-capture-test-' + [Guid]::NewGuid().ToString('N'))
$capture = Join-Path $PSScriptRoot '../scripts/Capture-KiroPicker.ps1'
$restore = Join-Path $PSScriptRoot '../scripts/Restore-KiroPickerConfig.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
# Simulated Kiro 2.24.1 /model picker with the real layout and synthetic model ids.
$script:mockRow = if ($global:mockStartRow) { $global:mockStartRow } else { 0 }
$script:mockTop = 0
$script:mockVisible = 4
$script:mockFocus = 'list'
$script:mockAxis = $null
$script:mockDowns = 0
$script:mockUpSkipped = $false
$script:mockSaved = [ordered]@{}
$effortNote = 'Sets deliberation level.'
$thinkingNote = 'Shows reasoning before answering.'
$na = 'Not available for this model.'
$script:mockModels = @(
    @{ Id = 'route-auto'; Rate = '1.00x'; Desc = 'Example routing row'; Active = $true; Axes = [ordered]@{
        thinking = @{ Value = 'n/a'; Ring = @(); Note = $na }; effort = @{ Value = 'n/a'; Ring = @(); Note = $na } } }
    @{ Id = 'example-think'; Rate = '2.00x'; Desc = 'Example model with thinking'; Active = $false; Axes = [ordered]@{
        thinking = @{ Value = 'default'; Ring = @('on', 'off'); Note = $thinkingNote }
        effort = @{ Value = 'default'; Ring = @('low', 'medium', 'high', 'max'); Note = $effortNote } } }
    @{ Id = 'example-always'; Rate = '2.20x'; Desc = 'Example model with a saved effort'; Active = $false; Axes = [ordered]@{
        thinking = @{ Value = 'n/a'; Ring = @(); Note = 'Always on for this model.' }
        effort = @{ Value = 'high'; Ring = @('low', 'medium', 'high', 'max'); Note = $effortNote } } }
    @{ Id = 'example-none'; Rate = '1.10x'; Desc = 'Example model with none'; Active = $false; Axes = [ordered]@{
        thinking = @{ Value = 'n/a'; Ring = @(); Note = $na }
        effort = @{ Value = 'default'; Ring = @('none', 'low', 'medium'); Note = $effortNote } } }
    @{ Id = 'example-plain-1'; Rate = '0.40x'; Desc = 'Example model without settings'; Active = $false; Axes = [ordered]@{
        thinking = @{ Value = 'n/a'; Ring = @(); Note = $na }; effort = @{ Value = 'n/a'; Ring = @(); Note = $na } } }
    @{ Id = 'example-plain-2'; Rate = '0.05x'; Desc = 'Another example model'; Active = $false; Axes = [ordered]@{
        thinking = @{ Value = 'n/a'; Ring = @(); Note = $na }; effort = @{ Value = 'n/a'; Ring = @(); Note = $na } } }
)

function Get-MockAxisDisplay($Model, [string]$Axis) {
    if ($Axis -eq 'effort' -and $Model.Axes['thinking'].Value -eq 'off') {
        return @('n/a', 'Not available while thinking is off.')
    }
    $entry = $Model.Axes[$Axis]
    return @($entry.Value, $entry.Note)
}
function Get-MockSelectable($Model) {
    @($Model.Axes.Keys | Where-Object { (Get-MockAxisDisplay $Model $_)[0] -ne 'n/a' })
}
function Set-MockLast { $global:mockLastFocus = $script:mockFocus; $global:mockLastRow = $script:mockRow }
function Get-WindowsUiTarget { param($Title, $ProcessName) [pscustomobject]@{ Title = $Title } }
function Assert-WindowsUiFocus($Target) { }
function Get-WindowsUiTitledWindows { param($Title) if ($global:mockWindowClosed) { @() } else { @('owned window') } }
function Get-WindowsUiInputState($Target) { 'mock-input-state' }
function Assert-WindowsUiInputState($Target, $State) { }
function Get-WindowsUiText($Target) {
    $mark = [string][char]0x276F; $dot = [string][char]0x00B7; $rule = ([string][char]0x2500) * 60
    $arrows = [string][char]0x2191 + [char]0x2193; $toggle = [string][char]0x2190 + [char]0x2192
    $enter = [string][char]0x21B5
    $lines = @("kiro_default $dot route-auto $dot 4%", '', ([string][char]0x203A + ' /model'),
        'Select model:   type to search', '')
    $count = $script:mockModels.Count
    if ($script:mockRow -lt $script:mockTop) { $script:mockTop = $script:mockRow }
    if ($script:mockRow -gt $script:mockTop + $script:mockVisible - 1) { $script:mockTop = $script:mockRow - $script:mockVisible + 1 }
    $last = [Math]::Min($count, $script:mockTop + $script:mockVisible) - 1
    for ($i = $script:mockTop; $i -le $last; $i++) {
        $model = $script:mockModels[$i]
        $lead = if ($script:mockFocus -eq 'list' -and $i -eq $script:mockRow) { "$mark " } else { '  ' }
        $desc = if ($model.Active) { $model.Desc + ' [active]' } else { $model.Desc }
        $lines += $lead + $model.Id.PadRight(21) + ($model.Rate + ' credits').PadRight(17) + $desc + '      '
    }
    if ($count - 1 - $last -gt 0) { $lines += "(+$($count - 1 - $last) more)" }
    $lines += $rule
    $model = $script:mockModels[$script:mockRow]
    $selected = if ($model.Active) { 'selected ' } else { '' }
    $lines += (" Settings for ${selected}model: " + $model.Id).PadRight(90) + 'tab to switch panels '
    $lines += ''
    foreach ($axis in $model.Axes.Keys) {
        $shown = Get-MockAxisDisplay $model $axis
        $lead = if ($script:mockFocus -eq 'settings' -and $script:mockAxis -eq $axis) { "$mark " } else { '  ' }
        $lines += $lead + $axis.PadRight(10) + $shown[0].PadRight(9) + $shown[1]
    }
    $lines += $rule
    if ($script:mockFocus -eq 'list') {
        $lines += " esc to close $dot $arrows to navigate $dot $enter to select $dot tab to switch panels"
    } else {
        $nav = if (@(Get-MockSelectable $model).Count -gt 1) { "$arrows to navigate $dot " } else { '' }
        $lines += " esc to close $dot $nav$toggle to toggle $dot $enter back to models $dot tab to switch panels"
    }
    $lines += ''
    return ($lines -join "`n")
}
function Save-WindowsUiSnapshot { param($Target, $OutputPrefix)
    $text = Get-WindowsUiText $Target
    $text | Set-Content -LiteralPath ($OutputPrefix + '.txt') -Encoding UTF8
    Set-Content -LiteralPath ($OutputPrefix + '.png') -Value 'simulated image'
    [pscustomobject]@{ Text = $text; Image = $OutputPrefix + '.png'; Bounds = '0,0,1129,635' }
}
function Move-MockAxis([int]$Delta) {
    $selectable = @(Get-MockSelectable $script:mockModels[$script:mockRow])
    $index = [array]::IndexOf($selectable, $script:mockAxis) + $Delta
    if ($index -ge 0 -and $index -lt $selectable.Count) { $script:mockAxis = $selectable[$index] }
}
function Invoke-MockToggle($Model) {
    $entry = $Model.Axes[$script:mockAxis]
    $position = [array]::IndexOf($entry.Ring, $entry.Value)
    $entry.Value = if ($position -lt 0) { $entry.Ring[0] } else { $entry.Ring[($position + 1) % $entry.Ring.Count] }
    if ($script:mockAxis -eq 'effort' -and $Model.Axes['thinking'].Value -eq 'default' -and @('high', 'max') -contains $entry.Value) {
        $Model.Axes['thinking'].Value = 'on'
    }
    if (-not $script:mockSaved.Contains($Model.Id)) { $script:mockSaved[$Model.Id] = [ordered]@{} }
    $script:mockSaved[$Model.Id][$script:mockAxis] = $entry.Value
    # Kiro persists each toggle immediately, without Enter.
    @{ 'chat.modelDefaults' = $script:mockSaved } | ConvertTo-Json -Depth 5 |
        Set-Content -LiteralPath $global:mockConfigPath -Encoding UTF8
}
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    $model = $script:mockModels[$script:mockRow]
    switch ($Key) {
        'Down' {
            if ($script:mockFocus -eq 'settings') { Move-MockAxis 1 } else {
                $script:mockDowns++
                $script:mockRow = ($script:mockRow + 1) % $script:mockModels.Count
                if ($global:mockExternalWriteOnDown -eq $script:mockDowns) {
                    Add-Content -LiteralPath $global:mockConfigPath -Value '// external edit'
                }
            }
        }
        'Up' {
            if ($script:mockFocus -eq 'settings') { Move-MockAxis -1 } else {
                $step = if ($global:mockUpSkip -and -not $script:mockUpSkipped) { $script:mockUpSkipped = $true; 2 } else { 1 }
                $script:mockRow = [Math]::Max(0, $script:mockRow - $step)
            }
        }
        'Right' {
            if ($script:mockFocus -ne 'settings') { throw 'Right was sent outside the settings panel' }
            Invoke-MockToggle $model
        }
        default { throw "Capture sent a selecting, closing or unexpected key: $Key" }
    }
    Set-MockLast
}
function Invoke-WindowsUiKeyInput { param([uint16]$Code, [bool]$Control)
    if ($Code -ne 9 -or $Control) { throw "Capture sent an unexpected raw key: $Code" }
    $global:mockTabs = [int]$global:mockTabs + 1
    if ($script:mockFocus -eq 'list') {
        $script:mockFocus = 'settings'
        $script:mockAxis = @(Get-MockSelectable $script:mockModels[$script:mockRow])[0]
    } else {
        $script:mockFocus = 'list'
        $script:mockAxis = $null
    }
    Set-MockLast
}
function Wait-WindowsUiText { param($Target, $ExpectedText)
    $text = Get-WindowsUiText $Target
    if ($text -notmatch $ExpectedText) { throw 'Expected UI transition not reached' }
    $text
}
'@ | Set-Content -LiteralPath $mock -Encoding UTF8

$baselineText = '{"chat.modelDefaults":{"example-always":{"effort":"high"}}}'
function Get-Digest([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
    return 'absent'
}
function Reset-Fixture([string]$Name, [switch]$NoConfig) {
    foreach ($variable in 'mockExternalWriteOnDown', 'mockUpSkip', 'mockStartRow', 'mockWindowClosed', 'mockTabs',
        'mockLastFocus', 'mockLastRow') {
        Remove-Variable -Name $variable -Scope Global -ErrorAction SilentlyContinue
    }
    $dir = Join-Path $scratch $Name
    $null = New-Item -ItemType Directory -Path (Join-Path $dir 'evidence')
    $global:mockConfigPath = Join-Path $dir 'cli.json'
    if (-not $NoConfig) { [IO.File]::WriteAllText($global:mockConfigPath, $baselineText) }
    return $dir
}
function Invoke-Capture([string]$Dir, [hashtable]$Extra = @{}) {
    $params = @{ UiHelperPath = $mock; WindowTitle = 'Fixture'; OutputDirectory = (Join-Path $Dir 'evidence')
        ConfigPath = $global:mockConfigPath; ExpectedModelCount = 6; SettleMilliseconds = 20; Screenshots = 'None' }
    foreach ($key in $Extra.Keys) { $params[$key] = $Extra[$key] }
    & $capture @params 3>$null | Out-String | ConvertFrom-Json
}
function Invoke-Restore([string]$Dir) {
    & $restore -UiHelperPath $mock -StatePath (Join-Path $Dir 'evidence\config-state.json') | Out-String | ConvertFrom-Json
}
function Assert-Throws([scriptblock]$Action, [string]$Pattern, [string]$Label) {
    $failed = $false
    try { $null = & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "$Label failed unexpectedly: $($_.Exception.Message)" }
        $failed = $true
    }
    if (-not $failed) { throw "$Label did not fail." }
}
function Get-Values($Items) { (@($Items) | ForEach-Object { $_ }) -join ',' }

try {
    $source = Get-Content -Raw -LiteralPath $capture
    if ($source -match "-Key\s+['""]?(Enter|Escape)\b" -or $source -match '\[uint16\]\s*(13|27)\b') {
        throw 'The capture script contains an Enter or Escape key send.'
    }
    if ((Get-Content -Raw -LiteralPath $restore) -match 'Send-WindowsUi(Key|Text)|Invoke-WindowsUi(Key|Char)Input') {
        throw 'The restore script sends input.'
    }
    Write-Output 'PASS scripts contain no Enter/Escape sends and restore sends no input'

    $ids = 'route-auto,example-think,example-always,example-none,example-plain-1,example-plain-2'
    foreach ($mode in @('KeyScreens', 'All', 'None')) {
        $dir = Reset-Fixture $mode
        $baseline = Get-Digest $global:mockConfigPath
        $result = Invoke-Capture $dir @{ Screenshots = $mode }
        $expectedImages = @{ KeyScreens = 4; All = 26; None = 0 }[$mode]
        if ((Get-Values $result.Rows.Id) -ne $ids -or $result.TextCaptures -ne 26 -or
            $result.Screenshots -ne $expectedImages -or $result.Toggles -ne 15 -or
            -not $result.RestoreRequired -or -not $result.OrderCheckedBothDirections) {
            throw "Coverage, screenshot policy or toggle count was incorrect in $mode."
        }
        $auto = $result.Rows[0]
        if (-not $auto.Active -or $auto.Rate -ne '1.00x credits' -or $auto.Description -ne 'Example routing row' -or
            @($auto.Cycles).Count -ne 0 -or
            (Get-Values ($auto.Arrival | ForEach-Object { $_.Axis + '=' + $_.Value })) -ne 'thinking=n/a,effort=n/a') {
            throw 'The routing row was not read as displayed.'
        }
        $think = @($result.Rows[1].Cycles)
        $off = @($think[1].Sequence | Where-Object { $_.Value -eq 'off' })[0]
        if ($think.Count -ne 2 -or $think[0].Axis -ne 'effort' -or $think[0].Start -ne 'default' -or
            $think[0].StartInCycle -or (Get-Values $think[0].Cycle) -ne 'low,medium,high,max' -or
            $think[1].Axis -ne 'thinking' -or $think[1].Start -ne 'on' -or -not $think[1].StartInCycle -or
            (Get-Values $think[1].Cycle) -ne 'on,off' -or (Get-Values $off.Panel) -ne 'thinking=off,effort=n/a') {
            throw 'Effort/thinking rings or their coupling were not recorded.'
        }
        $always = @($result.Rows[2].Cycles)
        if ($always.Count -ne 1 -or $always[0].Start -ne 'high' -or -not $always[0].StartInCycle -or
            (Get-Values $always[0].Cycle) -ne 'high,max,low,medium') {
            throw 'A saved start value inside the ring was not recorded.'
        }
        $none = @($result.Rows[3].Cycles)
        if ($none[0].Start -ne 'default' -or (Get-Values $none[0].Cycle) -ne 'none,low,medium' -or
            @($result.Rows[4].Cycles).Count -ne 0) {
            throw 'A per-model ring or an n/a row was recorded incorrectly.'
        }
        if ($global:mockLastFocus -ne 'list' -or $global:mockLastRow -ne 0) {
            throw 'The picker was not left open at its first row.'
        }
        if ((Get-Digest $global:mockConfigPath) -eq $baseline) { throw 'Simulated toggles did not reach the settings file.' }
        Write-Output "PASS $mode capture reads every row, per-model rings and both directions"

        if ($mode -eq 'KeyScreens') {
            $afterCapture = Get-Digest $global:mockConfigPath
            Assert-Throws { Invoke-Restore $dir } 'still open' 'Restore with the capture window open'
            if ((Get-Digest $global:mockConfigPath) -ne $afterCapture) { throw 'A refused restore changed the settings file.' }
            $global:mockWindowClosed = $true
            $restored = Invoke-Restore $dir
            if ($restored.Outcome -ne 'restored' -or (Get-Digest $global:mockConfigPath) -ne $baseline) {
                throw 'Restore did not return the baseline settings file.'
            }
            if ((Invoke-Restore $dir).Outcome -ne 'already-baseline') { throw 'A repeated restore was not a no-op.' }
            Write-Output 'PASS restore waits for the window to close, returns the baseline and is idempotent'
        }
    }

    $dir = Reset-Fixture 'read-only'
    $baseline = Get-Digest $global:mockConfigPath
    $result = Invoke-Capture $dir @{ Axes = '' }
    if ($result.Toggles -ne 0 -or $result.RestoreRequired -or [int]$global:mockTabs -ne 0 -or
        $result.TextCaptures -ne 8 -or (Get-Digest $global:mockConfigPath) -ne $baseline -or
        (Get-Values ($result.Rows[1].Arrival | ForEach-Object { $_.Value })) -ne 'default,default') {
        throw 'A read-only capture toggled settings or missed arrival values.'
    }
    Write-Output 'PASS empty -Axes reads rows without Tab, toggles or settings writes'

    $dir = Reset-Fixture 'concurrent'
    $global:mockExternalWriteOnDown = 3
    Assert-Throws { Invoke-Capture $dir } 'without a toggle by this helper' 'A concurrent settings edit'
    $state = Get-Content -Raw -LiteralPath (Join-Path $dir 'evidence\config-state.json') | ConvertFrom-Json
    if ($state.status -ne 'stopped') { throw 'A stopped capture did not record its state.' }
    $global:mockWindowClosed = $true
    Assert-Throws { Invoke-Restore $dir } 'last recorded toggle' 'Restore after a concurrent edit'
    if ((Get-Content -Raw -LiteralPath $global:mockConfigPath) -notmatch 'external edit') {
        throw 'Restore overwrote a concurrent edit.'
    }
    Write-Output 'PASS a concurrent settings edit stops capture and blocks restore'

    $dir = Reset-Fixture 'absent' -NoConfig
    $result = Invoke-Capture $dir
    if (-not $result.RestoreRequired -or -not (Test-Path -LiteralPath $global:mockConfigPath)) {
        throw 'Toggles against an absent settings file were not tracked.'
    }
    $global:mockWindowClosed = $true
    if ((Invoke-Restore $dir).Outcome -ne 'removed' -or (Test-Path -LiteralPath $global:mockConfigPath)) {
        throw 'Restore did not remove a settings file that was absent at baseline.'
    }
    Write-Output 'PASS restore removes a settings file created during capture'

    $dir = Reset-Fixture 'count'
    Assert-Throws { Invoke-Capture $dir @{ ExpectedModelCount = 5 } } 'differ from expected coverage' 'A wrong expected count'
    $dir = Reset-Fixture 'start-row'
    $global:mockStartRow = 1
    Assert-Throws { Invoke-Capture $dir } 'first visible row' 'A start away from the first row'
    $dir = Reset-Fixture 'direction'
    $global:mockUpSkip = $true
    Assert-Throws { Invoke-Capture $dir @{ Axes = '' } } 'order differs by direction' 'A list whose order differs by direction'
    $dir = Reset-Fixture 'nonempty'
    Set-Content -LiteralPath (Join-Path $dir 'evidence\previous.txt') -Value 'previous capture'
    Assert-Throws { Invoke-Capture $dir } 'new empty evidence directory' 'An existing evidence directory'
    Write-Output 'PASS rejects wrong counts, a moved start row, direction mismatch and reused evidence'
} finally {
    foreach ($name in 'mockExternalWriteOnDown', 'mockUpSkip', 'mockStartRow', 'mockWindowClosed', 'mockTabs',
        'mockLastFocus', 'mockLastRow', 'mockConfigPath') {
        Remove-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue
    }
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'kiro-capture-test-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
