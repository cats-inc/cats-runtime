<#
.SYNOPSIS
    Exercises Copilot picker capture against a simulated UI; never opens a desktop window or
    starts Copilot.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('copilot-capture-test-' + [Guid]::NewGuid().ToString('N'))
$capture = Join-Path $PSScriptRoot '../scripts/Capture-CopilotPicker.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
# Simulated Copilot 1.0.88 /model picker with the real layout and synthetic model names.
$mP = [string][char]0x276F; $mL = [string][char]0x2190; $mR = [string][char]0x2192; $mCk = [string][char]0x2713
$mDa = [string][char]0x2014; $mMd = [string][char]0x00B7; $mBar = [string][char]0x2503
$mRule = ([string][char]0x2500) * 60
$models = @(
    @{ L = 'Auto'; G = $null; Opts = @('Efficiency', 'Balance', 'Intelligence', 'Fast'); Opt = 1; Tier = $true }
    @{ L = 'Example Recent'; G = 'Recent models'; Ctx = '328K 628K'; Opts = @('Low', 'Medium', 'High'); Opt = 2; Cost = 'Medium'; In = 200 }
    @{ L = 'Example Default'; G = 'Recent models'; Default = $true; Opts = @('None', 'Low', 'Medium'); Opt = 2; Cost = 'Low'; In = 20 }
    @{ L = 'Example Plain'; G = 'Other models'; Cost = 'Low'; In = 100 }
    @{ L = 'example-locked'; G = 'Unavailable models'; Locked = $true }
)
# All simulator state lives in one global table so it cannot collide with capture-script variables.
$global:mk = @{ Models = $models; Row = 0; PaneRow = 0; StaleReads = 0; Open = $true; Group = 'recommended' }
if ($global:mockClosed) { $global:mk.Open = $false }
if ($global:mockGroup) { $global:mk.Group = $global:mockGroup }
$global:mockKeys = @()
function Get-MockPane([int]$Index) {
    $m = $global:mk.Models[$Index]
    if ($m.Tier) { return @('   Auto routes based on your task, real-time system health, and model performance.', '   Optimize for') }
    if ($m.Locked) { return @("   Your plan doesn't include this model.", '   Upgrade your plan to use this model: https://example.invalid') }
    return @("   $($m.L) $mMd $($m.Cost) cost", '     Credits Per 1M Tokens',
        ('     Input                         ........................ {0}' -f $m.In),
        '     Output                         ...................... 500')
}
function Get-MockRow([int]$Index, [bool]$Focused) {
    $m = $global:mk.Models[$Index]; $label = $m.L
    if ($m.Default) { $label += ' (default)' }
    if ($m.Tier) { $label += " $mCk" }
    $option = if ($m.Opts) { $m.Opts[$m.Opt] } else { $mDa }
    if ($Focused) {
        if ($m.Opts) { $option = "$mL $option $mR" }
        if ($m.Tier) { return (" $mP {0,-27}{1}" -f $label, $option) }
        $ctx = if ($m.Ctx) { $m.Ctx } else { $mDa }
        return (" $mP {0,-27}{1,-11}{2}" -f $label, $ctx, $option)
    }
    $ctx = if ($m.Ctx) { ($m.Ctx -split ' ')[0] } else { $mDa }
    return ('   {0,-27}{1,-11}{2}' -f $label, $ctx, $option)
}
function Get-WindowsUiTarget { param($Title, $ProcessName) [pscustomobject]@{ Title = $Title } }
function Set-WindowsUiFocus { param($Target) }
function Get-WindowsUiText { param($Target)
    $s = $global:mk
    $lines = @('  Current   Sessions   Issues', " Tip: /share                                  $mBar", $mRule)
    if (-not $s.Open) { return (@($lines) + @(" $mP ", ' @ files') -join "`n") }
    $paneRow = $s.Row
    if ($s.StaleReads -gt 0) { $s.StaleReads--; $paneRow = $s.PaneRow }
    elseif ($global:mockStuckPane -and $s.Models[$s.Row].L -eq $global:mockStuckPane) { $paneRow = $s.PaneRow }
    else { $s.PaneRow = $s.Row }
    $lines += Get-MockPane $paneRow
    $lines += $mRule, ' Changes apply to this session only.'
    $m = $s.Models[$s.Row]
    $lines += $(if ($m.Tier) { '                            Tier' } else { '                            Context    Reasoning' })
    if ($s.Row -gt 0 -and $s.Models[$s.Row - 1].G -eq $m.G) { $lines += Get-MockRow ($s.Row - 1) $false }
    elseif ($m.G) { $lines += "   $($m.G)                                        $mBar" }
    $lines += ((Get-MockRow $s.Row $true) + "     $mBar")
    $axis = if ($m.Tier) { 'routing profile' } else { 'reasoning effort' }
    $lines += "  $mP  Search models...", (" up/down to navigate $mMd left/right $axis $mMd tab context window $mMd shift+tab group: $($s.Group) $mMd enter to select $mMd esc to")
    $lines -join "`n"
}
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    $s = $global:mk; $m = $s.Models[$s.Row]; $count = $s.Models.Count
    $global:mockKeys += $Key
    if ($global:mockWriteOnKey -eq $global:mockKeys.Count) { Add-Content -LiteralPath $global:mockConfigPath -Value 'x' }
    switch ($Key) {
        'Down' { $s.PaneRow = $s.Row; $s.Row = ($s.Row + 1) % $count; $s.StaleReads = 2 }
        'Up' { $s.PaneRow = $s.Row; $s.Row = ($s.Row + $count - 1) % $count; $s.StaleReads = 2 }
        { $_ -in 'Left', 'Right' } {
            if (-not $m.Opts) { break }
            if ($m.Tier) {
                # Observed Auto graph: Left is a ring E<-B<-I<-F<-E; Right bounces I<->F after Balance.
                $next = if ($Key -eq 'Left') { @{ 0 = 3; 1 = 0; 2 = 1; 3 = 2 } } else { @{ 0 = 1; 1 = 2; 2 = 3; 3 = 2 } }
                $m.Opt = $next[$m.Opt]
            } elseif ($Key -eq 'Left') { $m.Opt = [Math]::Max(0, $m.Opt - 1) }
            else { $m.Opt = [Math]::Min($m.Opts.Count - 1, $m.Opt + 1) }
        }
        default { throw "Capture sent an unexpected key: $Key" }
    }
}
function Save-WindowsUiSnapshot { param($Target, $OutputPrefix)
    Get-WindowsUiText $Target | Set-Content -LiteralPath ($OutputPrefix + '.txt') -Encoding UTF8
    [pscustomobject]@{ Image = $OutputPrefix + '.png' }
}
'@ | Set-Content -LiteralPath $mock -Encoding UTF8

$globals = 'mockClosed', 'mockGroup', 'mockWriteOnKey', 'mockStuckPane', 'mockKeys', 'mockConfigPath', 'mk'
function Reset-Fixture([string]$Name) {
    foreach ($variable in $globals) { Remove-Variable -Name $variable -Scope Global -ErrorAction SilentlyContinue }
    $dir = Join-Path $scratch $Name
    $null = New-Item -ItemType Directory -Path (Join-Path $dir 'evidence')
    $global:mockConfigPath = Join-Path $dir 'config.json'
    [IO.File]::WriteAllText($global:mockConfigPath, '{"recentModelIds":["example"]}')
    return $dir
}
function Invoke-Capture([string]$Dir, [hashtable]$Extra = @{}) {
    $params = @{ UiHelperPath = $mock; WindowTitle = 'Fixture'; OutputDirectory = (Join-Path $Dir 'evidence')
        ConfigPath = $global:mockConfigPath; MaxRows = 10; TimeoutSeconds = 1; Screenshots = 'None' }
    foreach ($key in $Extra.Keys) { $params[$key] = $Extra[$key] }
    & $capture @params | Out-String | ConvertFrom-Json
}
function Read-Evidence([string]$Dir, [string]$Name) {
    @((Get-Content -Raw -LiteralPath (Join-Path $Dir "evidence\$Name") | ConvertFrom-Json) | ForEach-Object { $_ })
}
function Assert-Throws([scriptblock]$Action, [string]$Pattern, [string]$Label) {
    $failed = $false
    try { $null = & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw "$Label failed unexpectedly: $($_.Exception.Message)" }
        $failed = $true
    }
    if (-not $failed) { throw "$Label did not fail." }
}
function Get-Config { [IO.File]::ReadAllText($global:mockConfigPath) }
function Get-Options { ($global:mk.Models | ForEach-Object { if ($_.Opts) { $_.Opts[$_.Opt] } }) -join ',' }

try {
    $dir = Reset-Fixture 'walk'
    $result = Invoke-Capture $dir
    $rows = Read-Evidence $dir 'rows.json'
    $shape = ($rows | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.Label, $_.Group, ($_.Context -join ' '), $_.Option }) -join ';'
    $expected = 'Auto|||Balance;Example Recent|Recent models|328K 628K|High;Example Default|Recent models||Medium;' +
        'Example Plain|Other models||;example-locked|Unavailable models||'
    if ($shape -ne $expected) { throw "Unexpected rows: $shape" }
    if (($result.Default -join ',') -ne 'Example Default' -or ($result.Current -join ',') -ne 'Auto' -or
        ($result.Unavailable -join ',') -ne 'example-locked' -or ($result.ContextRows -join ',') -ne 'Example Recent') {
        throw 'Default, current, unavailable or context rows were not recorded separately.'
    }
    if ($rows[1].CostTier -ne 'Medium' -or $rows[1].Credits.Input -ne 200 -or $rows[2].Credits.Input -ne 20) {
        throw 'A lagging detail pane was recorded for the wrong row.'
    }
    if (@($result.PaneUnmatched).Count -ne 0 -or $result.Available -ne 4) { throw 'Pane matching or the available count failed.' }
    if (@($global:mockKeys | Where-Object { $_ -notin 'Up', 'Down' }).Count -ne 0) { throw 'The walk sent a key other than Up/Down.' }
    if ($global:mk.Row -ne 0 -or (Get-Config) -ne '{"recentModelIds":["example"]}' -or $result.Cycled -ne 0) {
        throw 'The walk did not return to the first row unchanged, or cycled without -CycleOptions.'
    }
    Write-Output 'PASS Up/Down walk records groups, markers, context figures, options and lagging panes'

    $dir = Reset-Fixture 'cycle'
    $result = Invoke-Capture $dir @{ CycleOptions = $true }
    $options = Read-Evidence $dir 'options.json'
    $recent = $options | Where-Object Label -eq 'Example Recent'
    $default = $options | Where-Object Label -eq 'Example Default'
    $auto = $options | Where-Object Label -eq 'Auto'
    if (($recent.Order -join ',') -ne 'Low,Medium,High' -or ($default.Order -join ',') -ne 'None,Low,Medium' -or $recent.Shape -ne 'linear') {
        throw "Linear option order was not recorded: $($recent.Order -join ',') / $($default.Order -join ',')"
    }
    if ($auto.Shape -ne 'irregular' -or ($auto.Left -join ',') -ne 'Balance,Efficiency,Fast,Intelligence,Balance' -or
        ($auto.Right -join ',') -ne 'Balance,Intelligence,Fast,Intelligence') {
        throw "The Auto tier graph was not recorded as observed: $($auto.Left -join ',') / $($auto.Right -join ',')"
    }
    if ($result.Cycled -ne 3 -or (Get-Options) -ne 'Balance,High,Medium' -or $global:mk.Row -ne 0) {
        throw "Cycling did not restore every arrival value on the first row: $(Get-Options)"
    }
    if (@($global:mockKeys | Where-Object { $_ -notin 'Up', 'Down', 'Left', 'Right' }).Count -ne 0) {
        throw 'Cycling sent Enter, Escape or Tab.'
    }
    Write-Output 'PASS -CycleOptions records linear and irregular orders and restores arrival values'

    $dir = Reset-Fixture 'stuck'
    $global:mockStuckPane = 'Example Plain'
    $result = Invoke-Capture $dir
    if (($result.PaneUnmatched -join ',') -ne 'Example Plain') { throw 'A pane that never caught up was not flagged.' }
    $rows = Read-Evidence $dir 'rows.json'
    if ($null -ne $rows[3].CostTier) { throw 'A stale pane was attributed to the highlighted row.' }
    Write-Output 'PASS a detail pane that never matches is flagged instead of misattributed'

    $dir = Reset-Fixture 'config'
    $global:mockWriteOnKey = 3
    Assert-Throws { Invoke-Capture $dir } 'settings file changed' 'A settings change during the walk'
    Write-Output 'PASS a settings change stops the capture before the next key'

    $dir = Reset-Fixture 'closed'
    $global:mockClosed = $true
    Assert-Throws { Invoke-Capture $dir } 'Open the Copilot /model picker' 'A closed picker'
    $dir = Reset-Fixture 'group'
    $global:mockGroup = 'vendor'
    Assert-Throws { Invoke-Capture $dir } 'group: recommended' 'A non-recommended sort'
    $dir = Reset-Fixture 'nonempty'
    Set-Content -LiteralPath (Join-Path $dir 'evidence\previous.txt') -Value 'previous capture'
    Assert-Throws { Invoke-Capture $dir } 'new empty evidence directory' 'An existing evidence directory'
    Write-Output 'PASS rejects a closed picker, another group sort and reused evidence'
} finally {
    foreach ($name in $globals) { Remove-Variable -Name $name -Scope Global -ErrorAction SilentlyContinue }
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'copilot-capture-test-*') { throw 'Unsafe fixture cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
