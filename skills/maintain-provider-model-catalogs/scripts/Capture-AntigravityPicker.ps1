<#
.SYNOPSIS
    Reads each Antigravity picker row's visible effort slider with guarded arrow keys.
.DESCRIPTION
    Start at the first row of an inspected, fully visible Switch Model picker in a dedicated
    foreground Windows Terminal. Pass its complete ordered labels from the initial observation.
    Saves only the picker region (not the account banner) as UTF-8 text, then returns to the
    first row. Never presses Enter, cycles effort, launches a CLI, or infers IDs/defaults.
    Text is private evidence: normalize and review it before retaining a catalog fixture.
.PARAMETER UiHelperPath
    Path to desktop-ui-automation/scripts/windows/WindowsUi.ps1.
.PARAMETER WindowTitle
    Unique title of the already inspected Windows Terminal window.
.PARAMETER OutputDirectory
    Existing empty private capture directory.
.PARAMETER ConfigPath
    Actual CLI settings file; checked before every key and after traversal. Hash separately
    before launch to distinguish startup/trust writes from picker navigation.
.PARAMETER ModelLabels
    Complete ordered labels observed in the picker, without its current-selection marker.
.EXAMPLE
    .\Capture-AntigravityPicker.ps1 -UiHelperPath $helper -WindowTitle $title `
        -OutputDirectory $evidence -ConfigPath $settings -ModelLabels $observedLabels
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$WindowTitle,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$ConfigPath,
    [Parameter(Mandatory)][string[]]$ModelLabels
)
$ErrorActionPreference = 'Stop'
. $UiHelperPath
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container) -or
    @(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -ne 0) {
    throw 'Use an existing empty private evidence directory.'
}
if ($ModelLabels.Count -eq 0 -or @($ModelLabels | Select-Object -Unique).Count -ne $ModelLabels.Count) {
    throw 'Provide the complete ordered, unique picker labels.'
}
$baseline = (Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash
$target = Get-WindowsUiTarget -Title $WindowTitle -ProcessName WindowsTerminal
function Assert-Config {
    if ((Get-FileHash -LiteralPath $ConfigPath -Algorithm SHA256).Hash -cne $baseline) {
        throw 'Settings changed during capture; stop without restoring over a concurrent writer.'
    }
}
function Highlight([int]$Index) {
    '(?m)^>\s+' + [regex]::Escape($ModelLabels[$Index]) + '\s*(?:\(current\))?\s*$'
}
function Read-Region([int]$Index) {
    Assert-WindowsUiFocus $target
    $text = Get-WindowsUiText $target
    $start = $text.LastIndexOf('Switch Model')
    if ($start -lt 0) { throw 'The model picker is not visible.' }
    $region = $text.Substring($start)
    $footer = [regex]::Match($region, '(?m)^Keyboard:.*enter Select.*esc Go Back[^\r\n]*')
    if (-not $footer.Success -or $region -notmatch (Highlight $Index)) {
        throw 'The expected row or complete picker footer is missing.'
    }
    $last = -1
    foreach ($label in $ModelLabels) {
        $row = [regex]::Match($region, '(?m)^[> ]\s+' + [regex]::Escape($label) + '\s*(?:\(current\))?\s*$')
        if (-not $row.Success -or $row.Index -le $last) { throw 'Model list changed or is truncated.' }
        $last = $row.Index
    }
    $region.Substring(0, $footer.Index + $footer.Length)
}
function Move-Row([string]$Key, [int]$From, [int]$To) {
    Assert-Config
    $null = Read-Region $From
    Send-WindowsUiKey $target -Key $Key -ExpectedText (Highlight $From)
    $null = Wait-WindowsUiText $target -ExpectedText (Highlight $To)
}
for ($i = 0; $i -lt $ModelLabels.Count; $i++) {
    if ($i -gt 0) { Move-Row Down ($i - 1) $i }
    $region = Read-Region $i
    $region | Set-Content -LiteralPath (Join-Path $OutputDirectory ('row-{0:D2}.txt' -f ($i + 1))) -Encoding UTF8
}
for ($i = $ModelLabels.Count - 1; $i -gt 0; $i--) { Move-Row Up $i ($i - 1) }
Assert-Config
@{ Models = $ModelLabels; ConfigUnchanged = $true; TextCaptures = $ModelLabels.Count } | ConvertTo-Json
