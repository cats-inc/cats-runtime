#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Invoke the repo-owned cats-runtime workspace substrate helper.

.DESCRIPTION
    Wraps `dist/bin/workspaceSubstrate.js` so
    Windows users can audit, initialize, or update collaboration substrate
    files without depending on external bootstrap repos.

.PARAMETER Operation
    Substrate operation to run: audit, init, or update.

.PARAMETER WorkspacePath
    Target workspace path. Defaults to the current directory.

.PARAMETER Profile
    Workspace substrate profile to use. Defaults to standard.

.PARAMETER Agent
    One or more enabled agents to include in the substrate plan.

.PARAMETER IncludeA2A
    Force A2A starter artifacts on.

.PARAMETER NoIncludeA2A
    Force A2A starter artifacts off.

.PARAMETER Apply
    Apply changes instead of previewing only.

.PARAMETER ActorRole
    Actor role for approval semantics.

.PARAMETER Approved
    Mark approval as already granted.

.EXAMPLE
    .\scripts\windows\Invoke-WorkspaceSubstrate.ps1 -Operation audit -WorkspacePath .

.EXAMPLE
    .\scripts\windows\Invoke-WorkspaceSubstrate.ps1 -Operation update -WorkspacePath . -Profile a2a-enabled -Agent codex -Apply -ActorRole boss_cat
#>

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('audit', 'init', 'update')]
    [string]$Operation,

    [Parameter(Mandatory = $false)]
    [string]$WorkspacePath = (Get-Location).Path,

    [Parameter(Mandatory = $false)]
    [ValidateSet('minimal', 'standard', 'a2a-enabled')]
    [string]$Profile = 'standard',

    [Parameter(Mandatory = $false)]
    [ValidateSet('claude', 'gemini', 'codex')]
    [string[]]$Agent = @(),

    [Parameter(Mandatory = $false)]
    [switch]$IncludeA2A,

    [Parameter(Mandatory = $false)]
    [switch]$NoIncludeA2A,

    [Parameter(Mandatory = $false)]
    [switch]$Apply,

    [Parameter(Mandatory = $false)]
    [ValidateSet('boss_cat', 'specialist_cat', 'system', 'owner', 'product_host', 'operator')]
    [string]$ActorRole,

    [Parameter(Mandatory = $false)]
    [switch]$Approved,

    [Parameter(Mandatory = $false)]
    [ValidateSet('single-project', 'monorepo')]
    [string]$ProjectType,

    [Parameter(Mandatory = $false)]
    [string]$Purpose,

    [Parameter(Mandatory = $false)]
    [string]$Background,

    [Parameter(Mandatory = $false)]
    [string[]]$TechnologyLabel = @(),

    [Parameter(Mandatory = $false)]
    [string]$DocumentationStyle
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$binPath = Join-Path $root 'dist\bin\workspaceSubstrate.js'

if (-not (Test-Path $binPath)) {
    throw "Missing $binPath. Run 'npm run build' in cats-runtime first."
}

$arguments = @(
    $binPath,
    '--operation', $Operation,
    '--workspace-path', $WorkspacePath,
    '--profile', $Profile
)

foreach ($entry in $Agent) {
    $arguments += @('--agent', $entry)
}

if ($IncludeA2A) {
    $arguments += '--include-a2a'
}

if ($NoIncludeA2A) {
    $arguments += '--no-include-a2a'
}

if ($Apply) {
    $arguments += '--apply'
}

if ($ActorRole) {
    $arguments += @('--actor-role', $ActorRole)
}

if ($Approved) {
    $arguments += '--approved'
}

if ($ProjectType) {
    $arguments += @('--project-type', $ProjectType)
}

if ($Purpose) {
    $arguments += @('--purpose', $Purpose)
}

if ($Background) {
    $arguments += @('--background', $Background)
}

foreach ($label in $TechnologyLabel) {
    $arguments += @('--technology-label', $label)
}

if ($DocumentationStyle) {
    $arguments += @('--documentation-style', $DocumentationStyle)
}

& node @arguments
exit $LASTEXITCODE
