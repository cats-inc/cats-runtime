<#
.SYNOPSIS
    Restores the Kiro settings file backed up by Capture-KiroPicker.ps1 after the owned Kiro exits.
.DESCRIPTION
    Reads config-state.json from a Capture-KiroPicker.ps1 evidence directory. Refuses while any
    window with the capture title still exists. Refuses when the settings file differs from the
    last digest the capture observed: another program, or Kiro itself on exit, changed it after
    the helper's last toggle, so it must be compared by hand instead of overwritten. Otherwise
    writes the backup through a temporary file in the same directory, or removes a file that did
    not exist at baseline, and checks the result against the baseline SHA-256. The backup is kept.
    Already-restored files are left untouched. Uses the desktop-ui-automation Windows helper only
    to look up the window title; sends no input.
.PARAMETER UiHelperPath
    Path to desktop-ui-automation/scripts/windows/WindowsUi.ps1 in a canonical or active skill.
.PARAMETER StatePath
    config-state.json written by Capture-KiroPicker.ps1 in the private evidence directory.
.EXAMPLE
    .\Restore-KiroPickerConfig.ps1 -UiHelperPath $uiHelper -StatePath (Join-Path $evidenceDir 'config-state.json')
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UiHelperPath,
    [Parameter(Mandatory)][string]$StatePath
)
$ErrorActionPreference = 'Stop'
. $UiHelperPath
$StatePath = (Resolve-Path -LiteralPath $StatePath).ProviderPath
$state = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
if ($state.schema -ne 'cats.kiro-picker-config-state/1') { throw 'Not a Kiro picker config state file.' }
foreach ($field in @('configPath', 'windowTitle', 'baselineDigest', 'lastObservedDigest')) {
    if (-not [string]$state.$field) { throw "The state file lacks '$field'." }
}
$configPath = [string]$state.configPath

function Get-ConfigDigest {
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        return (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
    }
    return 'absent'
}

if (@(Get-WindowsUiTitledWindows -Title ([string]$state.windowTitle)).Count -ne 0) {
    throw 'The capture window is still open. Exit the owned Kiro and let its window close before restoring.'
}
$current = Get-ConfigDigest
if ($current -eq $state.baselineDigest) {
    $outcome = 'already-baseline'
} elseif ($current -ne $state.lastObservedDigest) {
    throw ('The settings file changed after the capture''s last recorded toggle (another program, ' +
        'or Kiro on exit). Not restoring; compare it with the backup by hand.')
} elseif ($state.baselineExists) {
    $evidenceDir = Split-Path -Parent $StatePath
    $backup = [IO.Path]::GetFullPath((Join-Path $evidenceDir ([string]$state.backupFile)))
    if (-not $backup.StartsWith($evidenceDir + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The backup path leaves the evidence directory.'
    }
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $state.baselineDigest) {
        throw 'The backup no longer matches the baseline digest. Not restoring.'
    }
    $temporary = Join-Path (Split-Path -Parent $configPath) ('.' + (Split-Path -Leaf $configPath) +
        '.cats-restore-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    Copy-Item -LiteralPath $backup -Destination $temporary
    try {
        if ($current -eq 'absent') { Move-Item -LiteralPath $temporary -Destination $configPath }
        else { [IO.File]::Replace($temporary, $configPath, [NullString]::Value) }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
    $outcome = 'restored'
} else {
    Remove-Item -LiteralPath $configPath
    $outcome = 'removed'
}
$final = Get-ConfigDigest
if ($final -ne $state.baselineDigest) {
    throw 'The settings file does not match the baseline digest after restoring; inspect it by hand.'
}
$state | Add-Member -NotePropertyName status -NotePropertyValue $outcome -Force
$state | Add-Member -NotePropertyName restoredAt -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
$state | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
[pscustomobject]@{ Outcome = $outcome; MatchesBaseline = $true; BaselineDigest = $state.baselineDigest } |
    ConvertTo-Json
