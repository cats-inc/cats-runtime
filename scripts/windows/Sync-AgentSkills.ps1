<#
.SYNOPSIS
    Sync repository-maintenance skills into local agent discovery paths.

.DESCRIPTION
    Uses developer-skills/ as the canonical source and reconciles only entries
    recorded as cats-runtime-managed. Unrelated local skills are preserved.

.PARAMETER Clean
    Recreate repository-managed mirrors without deleting unrelated local skills.

.PARAMETER Agent
    Sync only Claude Code or the shared Codex/Antigravity/Grok discovery path.

.PARAMETER SourceRoot
    Override developer-skills/. Intended for isolated validation.

.PARAMETER DestinationRoot
    Override the root containing .claude/ and .agents/. Intended for isolated validation.
#>
param(
    [Parameter(Mandatory = $false)]
    [switch]$Clean,

    [Parameter(Mandatory = $false)]
    [ValidateSet("claude", "codex", "antigravity", "grok")]
    [string]$Agent,

    [Parameter(Mandatory = $false)]
    [string]$SourceRoot,

    [Parameter(Mandatory = $false)]
    [string]$DestinationRoot
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SyncEngine = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "..\sync-agent-skills.mjs"))
$NodeArgs = @($SyncEngine)

if ($Clean) {
    $NodeArgs += "--clean"
}
if ($Agent) {
    $NodeArgs += @("--agent", $Agent)
}
if ($SourceRoot) {
    $NodeArgs += @("--source-root", $SourceRoot)
}
if ($DestinationRoot) {
    $NodeArgs += @("--destination-root", $DestinationRoot)
}

& node @NodeArgs
if ($LASTEXITCODE -ne 0) {
    throw "Agent skill sync failed with exit code $LASTEXITCODE."
}
