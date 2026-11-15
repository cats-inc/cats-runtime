<#
.SYNOPSIS
    Exercises the Claude row-status reader against a simulated UI; never opens a desktop or CLI.
#>
$ErrorActionPreference = 'Stop'
$scratchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../tmp'))
$scratch = Join-Path $scratchRoot ('claude-row-status-test-' + [Guid]::NewGuid().ToString('N'))
$subject = Join-Path $PSScriptRoot '../scripts/Read-ClaudePickerRowStatus.ps1'
$null = New-Item -ItemType Directory -Path $scratch -Force
$mock = Join-Path $scratch 'ui.ps1'
@'
# Simulated Claude Code screen: a prompt, the /model picker or the /status panel.
$script:mockMode = if ($global:mockStartInPicker) { 'picker' } else { 'prompt' }
$script:mockTyped = ''
$script:mockHistory = @()
$script:mockSession = 2
$script:mockHighlight = 2
$script:mockSPressed = 0
# $global:mockGroupAfter adds an unnumbered "More models" group row after that row (2.1.319+). The
# picker opens it collapsed unless the session row is inside it.
$script:mockOnGroup = $false
$script:mockExpanded = $false
$script:mockGroupEnters = 0
$script:mockRows = @(
    @{ Label='Default (recommended)'; Desc='Example One'; Status='Default (Example One)' }
    @{ Label='Example Alpha'; Desc='Example Two'; Status='alpha (example-alpha-1)' }
    @{ Label='Example Beta'; Desc='Example Three'; Status='example-beta-2' }
)
function Get-WindowsUiTarget { param($Title, $ProcessName); [pscustomobject]@{Title=$Title} }
function Assert-WindowsUiFocus($Target) { }
function Get-FileHash { param($LiteralPath, $Algorithm)
    [pscustomobject]@{Hash=$(if ($global:mockConfigChangeAfterS -and $script:mockSPressed -gt 0) {'changed'} else {'baseline'})}
}
function Get-WindowsUiText($Target) {
    $mark = [char]0x276F; $nbsp = [char]0xA0; $check = [char]0x2714
    $lines = @('Claude Code v9.9.9', '') + $script:mockHistory
    switch ($script:mockMode) {
        'picker' {
            $lines += "$mark$nbsp/model"
            $lines += @('', '  Select model', '  Switch between models.', '')
            $group = $global:mockGroupAfter
            $shown = if ($group -and -not $script:mockExpanded) { $group } else { $script:mockRows.Count }
            for ($i=0; $i -lt $shown; $i++) {
                $r = $script:mockRows[$i]
                $lead = if ($i + 1 -eq $script:mockHighlight -and -not $script:mockOnGroup) { "  $mark$nbsp" } else { '    ' }
                $label = if ($i + 1 -eq $script:mockSession) { "$($r.Label) $check" } else { $r.Label }
                $lines += "$lead$($i + 1).  $label    $($r.Desc)"
                if ($group -and $i + 1 -eq $group) {
                    $triangle = if ($script:mockExpanded) { [char]0x25BE } else { [char]0x25B8 }
                    $groupLead = if ($script:mockOnGroup) { "  $mark " } else { '    ' }
                    $lines += "$groupLead$triangle   More models"
                }
            }
            if ($script:mockOnGroup) {
                $action = if ($script:mockExpanded) { 'collapse' } else { 'expand' }
                $lines += @('', "  Enter to $action $([char]0xB7) Esc to cancel")
            } else {
                $lines += @('', "  Enter to set as default $([char]0xB7) s to use this session only $([char]0xB7) Esc to cancel")
            }
        }
        'status' {
            $lines += "$mark$nbsp/status"
            $lines += @('  Settings  Status   Config', '  Version:           9.9.9',
                "  Model:             $($script:mockRows[$script:mockSession - 1].Status)", '  Esc to cancel')
        }
        default { $lines += "$mark$nbsp$($script:mockTyped)" }
    }
    return ($lines -join "`n")
}
function Send-WindowsUiText { param($Target, $Text, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    if ($script:mockMode -eq 'prompt') { $script:mockTyped += $Text; return }
    if ($script:mockMode -eq 'picker' -and $Text -eq 's') {
        if ($script:mockOnGroup) { throw 's was sent on the More models row' }
        $script:mockSession = $script:mockHighlight
        $script:mockSPressed++
        $script:mockHistory += @("$([char]0x276F)$([char]0xA0)/model",
            "  $([char]0x23BF)  Set model to $($script:mockRows[$script:mockSession - 1].Label) for this session only", '')
        $script:mockMode = 'prompt'
        return
    }
    throw "Unexpected text '$Text' in $($script:mockMode)"
}
function Send-WindowsUiKey { param($Target, $Key, $ExpectedText)
    if ((Get-WindowsUiText $Target) -notmatch $ExpectedText) { throw 'Incorrect before-state guard' }
    switch ("$($script:mockMode):$Key") {
        'prompt:Enter' {
            if ($script:mockTyped -eq '/model') {
                $script:mockMode = 'picker'; $script:mockHighlight = $script:mockSession; $script:mockOnGroup = $false
                $script:mockExpanded = [bool]($global:mockGroupAfter -and $script:mockSession -gt $global:mockGroupAfter)
            }
            elseif ($script:mockTyped -eq '/status') { $script:mockMode = 'status' }
            else { throw "Unexpected command $($script:mockTyped)" }
            $script:mockTyped = ''
        }
        'picker:Up' {
            $group = $global:mockGroupAfter
            if ($script:mockOnGroup) { $script:mockOnGroup = $false }
            elseif ($group -and $script:mockExpanded -and $script:mockHighlight -eq $group + 1) {
                $script:mockHighlight = $group; $script:mockOnGroup = $true
            } else { $script:mockHighlight-- }
        }
        'picker:Down' {
            $group = $global:mockGroupAfter
            if ($script:mockOnGroup) {
                if ($script:mockExpanded) { $script:mockOnGroup = $false; $script:mockHighlight++ }
            } elseif ($group -and $script:mockHighlight -eq $group) { $script:mockOnGroup = $true }
            else { $script:mockHighlight++ }
        }
        'picker:Enter' {
            if (-not $script:mockOnGroup) { throw 'Reader sent Enter on a model row' }
            $script:mockExpanded = -not $script:mockExpanded
            $global:mockGroupEnters++
        }
        'status:Escape' {
            $script:mockHistory += @("$([char]0x276F)$([char]0xA0)/status", "  $([char]0x23BF)  Status dialog dismissed", '')
            $script:mockMode = 'prompt'
        }
        default { throw "Reader sent a saving or unexpected key: $($script:mockMode):$Key" }
    }
}
function Wait-WindowsUiText { param($Target, $ExpectedText, $TimeoutMilliseconds)
    $text = Get-WindowsUiText $Target
    if ($text -notmatch $ExpectedText) { throw 'Expected UI transition not reached' }
    $text
}
'@ | Set-Content -LiteralPath $mock -Encoding UTF8

try {
    $output = Join-Path $scratch 'rows.json'
    $result = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -Rows '3,1,2' `
        -OutputFile $output -ConfigPath 'simulated-config' | ConvertFrom-Json
    # Windows PowerShell 5.1 emits a JSON array as one object; enumerate it before counting.
    $saved = @(Get-Content -LiteralPath $output -Raw | ConvertFrom-Json | ForEach-Object { $_ })
    if (($result.Rows.StatusModel -join '|') -ne 'example-beta-2|Default (Example One)|alpha (example-alpha-1)' -or
        ($result.Rows.Label -join '|') -ne 'Example Beta|Default (recommended)|Example Alpha' -or
        $result.Rows[0].Confirmation -ne 'Set model to Example Beta for this session only' -or
        $result.Rows[0].Version -ne '9.9.9' -or -not $result.ConfigUnchanged -or $saved.Count -ne 3) {
        throw 'Row values, labels, confirmations or the saved result were incorrect'
    }
    Write-Output 'PASS reads each row value from /status without Enter in the picker'

    $failed = $false
    try {
        $null = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -Rows '2' `
            -OutputFile $output -ConfigPath 'simulated-config'
    } catch {
        if ($_.Exception.Message -notmatch 'new output file') {throw}
        $failed = $true
    }
    if (-not $failed) {throw 'An existing result file was not protected'}
    Write-Output 'PASS refuses to overwrite previous results'

    $global:mockConfigChangeAfterS = $true
    $failed = $false
    try {
        $null = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -Rows '3' `
            -OutputFile (Join-Path $scratch 'changed.json') -ConfigPath 'simulated-config'
    } catch {
        if ($_.Exception.Message -notmatch 'Config changed after s on row 3') {throw}
        $failed = $true
    }
    if (-not $failed) {throw 'A settings change after s was not rejected'}
    Write-Output 'PASS stops when the settings file changes'
    $global:mockConfigChangeAfterS = $false

    $global:mockGroupAfter = 2
    $global:mockGroupEnters = 0
    $result = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -Rows '3,1,2' `
        -OutputFile (Join-Path $scratch 'group.json') -ConfigPath 'simulated-config' | ConvertFrom-Json
    if (($result.Rows.StatusModel -join '|') -ne 'example-beta-2|Default (Example One)|alpha (example-alpha-1)' -or
        ($result.Rows.Label -join '|') -ne 'Example Beta|Default (recommended)|Example Alpha' -or
        $global:mockGroupEnters -ne 1) {
        throw 'A row under the More models group was not reached or the group was not expanded once'
    }
    Write-Output 'PASS expands a collapsed More models row and steps over an expanded one'
    $global:mockGroupAfter = $null

    $global:mockStartInPicker = $true
    $failed = $false
    try {
        $null = & $subject -UiHelperPath $mock -WindowTitle 'Fixture' -Rows '2' `
            -OutputFile (Join-Path $scratch 'picker.json') -ConfigPath 'simulated-config'
    } catch {
        if ($_.Exception.Message -notmatch 'empty Claude Code prompt') {throw}
        $failed = $true
    }
    if (-not $failed) {throw 'A start inside the picker was not rejected'}
    Write-Output 'PASS requires an empty prompt at the start'
} finally {
    Remove-Variable -Name mockConfigChangeAfterS -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable -Name mockStartInPicker -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable -Name mockGroupAfter -Scope Global -ErrorAction SilentlyContinue
    Remove-Variable -Name mockGroupEnters -Scope Global -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($scratch)
    if (-not $resolved.StartsWith($scratchRoot + [IO.Path]::DirectorySeparatorChar) -or
        (Split-Path -Leaf $resolved) -notlike 'claude-row-status-test-*') {throw 'Unsafe fixture cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
