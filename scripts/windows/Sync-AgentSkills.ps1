<#
.SYNOPSIS
    Syncs skills from the canonical skills/ directory to each agent's discovery path.

.DESCRIPTION
    Copies skill directories from the project's skills/ directory to the agent-specific
    discovery paths (.claude/skills/, .agents/skills/, .gemini/skills/), including any
    supporting files under each skill (e.g., scripts/, references/, assets/).

    This script follows the Agent Skills open standard (agentskills.io).

.PARAMETER Clean
    Remove existing skills in target directories before syncing.

.PARAMETER Agent
    Only sync to a specific agent (claude, codex, gemini). If not specified, syncs to all.

.EXAMPLE
    .\Sync-AgentSkills.ps1
    Syncs all skills to all agent discovery paths.

.EXAMPLE
    .\Sync-AgentSkills.ps1 -Agent claude
    Syncs skills only to .claude/skills/.

.EXAMPLE
    .\Sync-AgentSkills.ps1 -Clean
    Cleans target directories before syncing.
#>
param(
    [Parameter(Mandatory = $false)]
    [switch]$Clean,

    [Parameter(Mandatory = $false)]
    [ValidateSet("claude", "codex", "gemini")]
    [string]$Agent
)

$ErrorActionPreference = "Stop"

# Find project root (directory containing AGENTS.md)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

# Walk up to find AGENTS.md if script is not at expected depth
while ($ProjectRoot -and -not (Test-Path (Join-Path $ProjectRoot "AGENTS.md"))) {
    $Parent = Split-Path -Parent $ProjectRoot
    if ($Parent -eq $ProjectRoot) { break }
    $ProjectRoot = $Parent
}

if (-not (Test-Path (Join-Path $ProjectRoot "AGENTS.md"))) {
    throw "Could not find project root (no AGENTS.md found)."
}

$SkillsDir = Join-Path $ProjectRoot "skills"

if (-not (Test-Path $SkillsDir)) {
    Write-Warning "No skills/ directory found at $SkillsDir"
    return
}

# Define agent discovery paths
$AgentPaths = @{
    "claude" = Join-Path $ProjectRoot ".claude" "skills"
    "codex"  = Join-Path $ProjectRoot ".agents" "skills"
    "gemini" = Join-Path $ProjectRoot ".gemini" "skills"
}

# Filter to specific agent if requested
if ($Agent) {
    $TargetAgents = @{ $Agent = $AgentPaths[$Agent] }
}
else {
    $TargetAgents = $AgentPaths
}

# Discover skills (directories containing SKILL.md)
$SkillDirs = Get-ChildItem -Path $SkillsDir -Directory | Where-Object {
    Test-Path (Join-Path $_.FullName "SKILL.md")
}

if ($SkillDirs.Count -eq 0) {
    Write-Warning "No skills found in $SkillsDir (no directories with SKILL.md)"
    return
}

Write-Host "Found $($SkillDirs.Count) skill(s): $($SkillDirs.Name -join ', ')" -ForegroundColor Cyan

foreach ($AgentName in $TargetAgents.Keys) {
    $TargetDir = $TargetAgents[$AgentName]

    # Clean if requested
    if ($Clean -and (Test-Path $TargetDir)) {
        Remove-Item -Path $TargetDir -Recurse -Force
        Write-Host "  Cleaned: $TargetDir" -ForegroundColor Yellow
    }

    # Create target directory
    if (-not (Test-Path $TargetDir)) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    }

    foreach ($Skill in $SkillDirs) {
        $SkillTarget = Join-Path $TargetDir $Skill.Name

        if (Test-Path $SkillTarget) {
            Remove-Item -Path $SkillTarget -Recurse -Force
        }

        Copy-Item -Path $Skill.FullName -Destination $TargetDir -Recurse -Force
    }

    Write-Host "  Synced $($SkillDirs.Count) skill(s) to $AgentName`: $TargetDir" -ForegroundColor Green
}

Write-Host "`nSync complete. Synced $($SkillDirs.Count) skill(s) to $($TargetAgents.Count) agent path(s)." -ForegroundColor Cyan
