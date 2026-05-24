import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type {
  WorkspaceSubstrateAction,
  WorkspaceSubstrateApplyPayload,
  WorkspaceSubstrateActionType,
  WorkspaceSubstrateApprovalPayload,
  WorkspaceSubstrateAuditStatus,
  WorkspaceSubstrateAuthorization,
  WorkspaceSubstrateProfileCatalog,
  WorkspaceSubstrateContract,
  WorkspaceSubstrateFinding,
  WorkspaceSubstrateFindingStatus,
  WorkspaceSubstrateHints,
  WorkspaceSubstrateProfileId,
  WorkspaceSubstrateRequest,
  WorkspaceSubstrateResult,
} from '../types.js';
import { buildTextDiffPreview } from '../diff/textDiff.js';

const MANAGED_MARKER = 'cats-runtime:workspace-substrate';
const REVIEW_COPY_SUFFIX = '.bootstrap';
const DEFAULT_STANDARD_AGENTS = ['claude', 'antigravity', 'codex'] as const;
const PRIVILEGED_ACTOR_ROLES = ['boss_cat', 'system', 'owner'] as const;
const LEGACY_A2A_STARTER_FILES = [
  {
    path: 'docs/a2a/agent-card.json.example',
    replacementPath: 'docs/a2a/agent-card.public.json.example',
  },
  {
    path: 'docs/a2a/task.json.example',
    replacementPath: 'docs/a2a/jsonrpc-send-message.request.json.example',
  },
] as const;
type PrivilegedActorRole = (typeof PRIVILEGED_ACTOR_ROLES)[number];

interface WorkspaceTemplateFile {
  path: string;
  content: string;
}

interface PlannedAction extends WorkspaceSubstrateAction {
  writePath?: string;
  deletePath?: string;
  content?: string;
}

function isMissingError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function normalizeWorkspacePath(workspacePath: string): string {
  return resolve(workspacePath);
}

function normalizeProfile(profile?: WorkspaceSubstrateProfileId): WorkspaceSubstrateProfileId {
  return profile || 'standard';
}

function normalizeAgents(
  profile: WorkspaceSubstrateProfileId,
  enabledAgents?: Array<'claude' | 'antigravity' | 'codex'>,
): Array<'claude' | 'antigravity' | 'codex'> {
  if (enabledAgents && enabledAgents.length > 0) {
    return Array.from(new Set(enabledAgents));
  }

  return profile === 'minimal'
    ? []
    : [...DEFAULT_STANDARD_AGENTS];
}

function normalizeIncludeA2A(
  profile: WorkspaceSubstrateProfileId,
  includeA2A?: boolean,
): boolean {
  return includeA2A ?? profile === 'a2a-enabled';
}

function buildWorkspaceSubstrateProfileCatalog(): WorkspaceSubstrateProfileCatalog {
  return {
    defaultProfile: 'standard',
    allowedAgents: [...DEFAULT_STANDARD_AGENTS],
    profiles: [
      {
        id: 'minimal',
        title: 'Minimal',
        description: 'Lean collaboration substrate with shared workspace memory entry points but no agent-specific files by default.',
        defaultEnabledAgents: [],
        includeA2AByDefault: false,
      },
      {
        id: 'standard',
        title: 'Standard',
        description: 'Default collaboration substrate with AGENTS, agent-specific files, and project-memory indexes.',
        defaultEnabledAgents: [...DEFAULT_STANDARD_AGENTS],
        includeA2AByDefault: false,
      },
      {
        id: 'a2a-enabled',
        title: 'A2A Enabled',
        description: 'Standard substrate plus A2A starter artifacts enabled by default for protocol-facing collaboration pilots.',
        defaultEnabledAgents: [...DEFAULT_STANDARD_AGENTS],
        includeA2AByDefault: true,
      },
    ],
  };
}

function markdownMarker(profile: WorkspaceSubstrateProfileId, filePath: string): string {
  return `<!-- ${MANAGED_MARKER} profile=${profile} file=${filePath} -->`;
}

function jsonMarker(profile: WorkspaceSubstrateProfileId, filePath: string): string {
  return `${MANAGED_MARKER} profile=${profile} file=${filePath}`;
}

function scriptMarker(profile: WorkspaceSubstrateProfileId, filePath: string): string {
  return `# ${MANAGED_MARKER} profile=${profile} file=${filePath}`;
}

function humanizeAgent(agent: 'claude' | 'antigravity' | 'codex'): string {
  switch (agent) {
    case 'claude':
      return 'Claude';
    case 'antigravity':
      return 'Antigravity';
    case 'codex':
      return 'Codex';
  }
}

function renderMetadataLines(hints: WorkspaceSubstrateHints | undefined): string[] {
  return [
    `- **Type**: ${hints?.projectType || 'single-project'}`,
    hints?.purpose ? `- **Purpose**: ${hints.purpose}` : undefined,
    hints?.background ? `- **Background**: ${hints.background}` : undefined,
    hints?.technologyLabels?.length
      ? `- **Technology Labels**: ${hints.technologyLabels.join(', ')}`
      : undefined,
    hints?.documentationStyle
      ? `- **Documentation Style**: ${hints.documentationStyle}`
      : undefined,
  ].filter((line): line is string => Boolean(line));
}

function buildAgentsFile(
  profile: WorkspaceSubstrateProfileId,
  hints: WorkspaceSubstrateHints | undefined,
  enabledAgents: Array<'claude' | 'antigravity' | 'codex'>,
): string {
  const metadataLines = renderMetadataLines(hints);
  const agentFiles = enabledAgents
    .map((agent) => `- ${agent.toUpperCase()}.md`)
    .join('\n');

  return [
    markdownMarker(profile, 'AGENTS.md'),
    '# AGENTS.md',
    '',
    '> Runtime-owned collaboration substrate for this workspace.',
    '',
    '## Project Metadata',
    '',
    ...metadataLines,
    '',
    '## Collaboration Rules',
    '',
    '- Read this file first before making changes.',
    '- Read the agent-specific file for your runtime if it exists.',
    '- Keep runtime execution primitives policy-neutral; do not hard-code product workflow decisions.',
    '- Update tests and documentation when changing public behavior.',
    '- Prefer conservative updates over overwriting local customizations.',
    '',
    '## Workspace Entry Points',
    '',
    '- docs/AGENT-GUIDE.md',
    '- docs/terminology.md',
    '- PROGRESS.md',
    ...(agentFiles ? ['', '## Agent-Specific Files', '', agentFiles] : []),
    '',
  ].join('\n');
}

function buildAgentSpecificFile(
  agent: 'claude' | 'antigravity' | 'codex',
  profile: WorkspaceSubstrateProfileId,
): string {
  const name = humanizeAgent(agent);
  const fileName = `${agent.toUpperCase()}.md`;

  return [
    markdownMarker(profile, fileName),
    `# ${fileName}`,
    '',
    `> ${name}-specific collaboration notes for this workspace.`,
    '',
    '## Prerequisites',
    '',
    '- Read AGENTS.md first.',
    '',
    '## Working Rules',
    '',
    '- Keep changes focused and minimal.',
    '- Treat workspace-local instructions as the default authority unless an explicit approved override exists.',
    '- Keep runtime primitives separate from product policy and room orchestration.',
    '- Add or update tests when behavior changes.',
    '',
  ].join('\n');
}

function buildAgentGuide(
  profile: WorkspaceSubstrateProfileId,
  enabledAgents: Array<'claude' | 'antigravity' | 'codex'>,
): string {
  const agentList = enabledAgents.length > 0
    ? enabledAgents.map((agent) => `- ${humanizeAgent(agent)} -> ${agent.toUpperCase()}.md`).join('\n')
    : '- No agent-specific files enabled in this profile.';

  return [
    markdownMarker(profile, 'docs/AGENT-GUIDE.md'),
    '# Agent Guide',
    '',
    '## Quick Start',
    '',
    '1. Read `AGENTS.md`.',
    '2. Read your agent-specific file if one exists.',
    '3. Review `PROGRESS.md` before starting substantial work.',
    '4. Update docs and tests alongside code changes.',
    '',
    '## Agent Files',
    '',
    agentList,
    '',
    '## Operating Principles',
    '',
    '- Workspace substrate is the durable collaboration authority.',
    '- Runtime services own execution primitives; upper layers own approval and workflow policy.',
    '- Existing local customizations should be reviewed, not silently replaced.',
    '',
  ].join('\n');
}

function buildTerminology(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'docs/terminology.md'),
    '# Terminology',
    '',
    '- **Workspace substrate**: durable collaboration files and project-memory entry points maintained at workspace level.',
    '- **Boss Cat**: the coordinating role allowed to approve substrate apply operations and specialist delegation.',
    '- **Specialist Cat**: a focused worker that should consume workspace substrate before acting.',
    '- **Context transplant**: branching into a fresh child session while carrying curated parent context.',
    '- **Lineage**: machine-readable parent/child branch ancestry exposed by runtime inspection.',
    '',
  ].join('\n');
}

function buildProgress(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'PROGRESS.md'),
    '# PROGRESS',
    '',
    '## Current Status',
    '',
    '- Track active work packages here.',
    '',
    '## Next Steps',
    '',
    '- Capture upcoming implementation or review items.',
    '',
    '## Risks',
    '',
    '- Record blockers, review dependencies, or unresolved decisions.',
    '',
  ].join('\n');
}

function buildDocsReadme(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'docs/README.md'),
    '# Documentation Index',
    '',
    '- `docs/AGENT-GUIDE.md`: local operating rules for same-environment agents.',
    '- `docs/terminology.md`: shared vocabulary for protocol, memory, and skills.',
    '- `docs/specs/`: requirements and implementation-tracking truth.',
    '- `docs/plans/`: execution sequencing and progress logs.',
    '- `docs/decisions/`: accepted architecture and governance decisions.',
    '- `docs/research/`: evidence, validation notes, and external source logs.',
    '',
    'Keep these indexes updated when adding durable project-memory artifacts.',
    '',
  ].join('\n');
}

function buildSpecsReadme(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'docs/specs/README.md'),
    '# Specs',
    '',
    '- Use `SPEC-NNN-title.md` for scoped requirements documents.',
    '- Keep each spec aligned with the related plan or implementation stage.',
    '- Update this index when new specs become durable project memory.',
    '',
  ].join('\n');
}

function buildPlansReadme(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'docs/plans/README.md'),
    '# Plans',
    '',
    '- Use `PLAN-NNN-title.md` for execution sequencing and checklists.',
    '- Keep plan status and progress logs truthful to the current repo state.',
    '- Update this index when new plans become durable project memory.',
    '',
  ].join('\n');
}

function buildResearchReadme(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'docs/research/README.md'),
    '# Research',
    '',
    '- Capture protocol comparisons, pilot validation notes, and external-source evidence here.',
    '- Prefer dated filenames for research notes so follow-up validation stays traceable.',
    '- Update this index when research becomes durable project memory.',
    '',
  ].join('\n');
}

function buildDecisionsReadme(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'docs/decisions/README.md'),
    '# Decisions',
    '',
    '- Record accepted architecture or governance decisions as ADR-style markdown files.',
    '- Prefer one durable decision per file so future agents can trace rationale cleanly.',
    '- Update this index when a new decision is accepted.',
    '',
  ].join('\n');
}

function buildSkillsReadme(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'skills/README.md'),
    '# Skills',
    '',
    '- Keep procedural agent instructions in `skills/**/SKILL.md`.',
    '- Do not treat skills as a second project-memory system; durable state belongs in docs and root memory files.',
    '- Update this README when runtime-owned skills are added or retired.',
    '',
  ].join('\n');
}

function buildScriptsReadme(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'scripts/README.md'),
    '# Scripts',
    '',
    '- Keep platform wrappers under `scripts/windows/`, `scripts/linux/`, and `scripts/macos/`.',
    '- Prefer repo-owned helper entrypoints over external bootstrap script dependencies.',
    '- Keep skill-sync entrypoints repo-owned so agent discovery paths do not depend on bootstrap submodules.',
    '- Document significant script contracts here when they become part of durable repo behavior.',
    '',
    '## Collaboration Helpers',
    '',
    '- `scripts/windows/Sync-AgentSkills.ps1` syncs `skills/` into `.claude/skills`, `.agents/skills`, and `.antigravity/skills`.',
    '- `scripts/linux/sync-agent-skills.sh` and `scripts/macos/sync-agent-skills.sh` provide the same sync contract on POSIX hosts.',
    '',
  ].join('\n');
}

function buildWindowsSyncAgentSkillsScript(profile: WorkspaceSubstrateProfileId): string {
  return [
    '<#',
    '.SYNOPSIS',
    '    Sync agent skills from the canonical skills/ directory into local discovery paths.',
    '#>',
    scriptMarker(profile, 'scripts/windows/Sync-AgentSkills.ps1'),
    'param(',
    '  [switch]$Clean,',
    '  [ValidateSet("claude", "codex", "antigravity")]',
    '  [string]$Agent',
    ')',
    '',
    'Set-StrictMode -Version Latest',
    '$ErrorActionPreference = "Stop"',
    '',
    '$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)',
    'while ($ProjectRoot -and -not (Test-Path (Join-Path $ProjectRoot "AGENTS.md"))) {',
    '  $Parent = Split-Path -Parent $ProjectRoot',
    '  if ($Parent -eq $ProjectRoot) { break }',
    '  $ProjectRoot = $Parent',
    '}',
    '',
    'if (-not (Test-Path (Join-Path $ProjectRoot "AGENTS.md"))) {',
    '  throw "Could not find project root (no AGENTS.md found)."',
    '}',
    '',
    '$SkillsDir = Join-Path $ProjectRoot "skills"',
    'if (-not (Test-Path $SkillsDir)) {',
    '  Write-Warning "No skills/ directory found at $SkillsDir"',
    '  return',
    '}',
    '',
    '$AgentPaths = @{',
    '  "claude" = Join-Path $ProjectRoot ".claude" "skills"',
    '  "codex"  = Join-Path $ProjectRoot ".agents" "skills"',
    '  "antigravity" = Join-Path $ProjectRoot ".antigravity" "skills"',
    '}',
    '',
    '$TargetAgents = if ($Agent) { @{ $Agent = $AgentPaths[$Agent] } } else { $AgentPaths }',
    '$SkillDirs = Get-ChildItem -Path $SkillsDir -Directory | Where-Object {',
    '  Test-Path (Join-Path $_.FullName "SKILL.md")',
    '}',
    'if ($SkillDirs.Count -eq 0) {',
    '  Write-Warning "No skills found in $SkillsDir (no directories with SKILL.md)"',
    '  return',
    '}',
    '',
    'foreach ($AgentName in $TargetAgents.Keys) {',
    '  $TargetDir = $TargetAgents[$AgentName]',
    '  if ($Clean -and (Test-Path $TargetDir)) {',
    '    Remove-Item -Path $TargetDir -Recurse -Force',
    '  }',
    '  if (-not (Test-Path $TargetDir)) {',
    '    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null',
    '  }',
    '  foreach ($Skill in $SkillDirs) {',
    '    $SkillTarget = Join-Path $TargetDir $Skill.Name',
    '    if (Test-Path $SkillTarget) {',
    '      Remove-Item -Path $SkillTarget -Recurse -Force',
    '    }',
    '    Copy-Item -Path $Skill.FullName -Destination $TargetDir -Recurse -Force',
    '  }',
    '  Write-Host "Synced $($SkillDirs.Count) skill(s) to $AgentName`: $TargetDir" -ForegroundColor Green',
    '}',
    '',
  ].join('\n');
}

function buildPosixSyncAgentSkillsScript(
  profile: WorkspaceSubstrateProfileId,
  filePath: string,
): string {
  return [
    '#!/usr/bin/env bash',
    scriptMarker(profile, filePath),
    'set -euo pipefail',
    '',
    'clean=false',
    'agent=""',
    '',
    'print_usage() {',
    '  cat <<\'EOF\'',
    'Usage: sync-agent-skills.sh [--clean] [--agent claude|codex|antigravity]',
    'EOF',
    '}',
    '',
    'while [[ $# -gt 0 ]]; do',
    '  case "$1" in',
    '    --clean)',
    '      clean=true',
    '      shift',
    '      ;;',
    '    --agent)',
    '      shift',
    '      if [[ $# -eq 0 ]]; then',
    '        echo "--agent requires a value" >&2',
    '        exit 1',
    '      fi',
    '      case "$1" in',
    '        claude|codex|antigravity)',
    '          agent="$1"',
    '          ;;',
    '        *)',
    '          echo "Unsupported agent: $1" >&2',
    '          exit 1',
    '          ;;',
    '      esac',
    '      shift',
    '      ;;',
    '    -h|--help)',
    '      print_usage',
    '      exit 0',
    '      ;;',
    '    *)',
    '      echo "Unknown argument: $1" >&2',
    '      print_usage >&2',
    '      exit 1',
    '      ;;',
    '  esac',
    'done',
    '',
    'script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'project_root="$(cd "${script_dir}/../.." && pwd)"',
    'while [[ "$project_root" != "/" && ! -f "$project_root/AGENTS.md" ]]; do',
    '  project_root="$(dirname "$project_root")"',
    'done',
    '',
    'if [[ ! -f "$project_root/AGENTS.md" ]]; then',
    '  echo "Could not find project root (no AGENTS.md found)." >&2',
    '  exit 1',
    'fi',
    '',
    'skills_dir="$project_root/skills"',
    'if [[ ! -d "$skills_dir" ]]; then',
    '  echo "No skills/ directory found at $skills_dir" >&2',
    '  exit 0',
    'fi',
    '',
    'resolve_target_dir() {',
    '  case "$1" in',
    '    claude) echo "$project_root/.claude/skills" ;;',
    '    codex) echo "$project_root/.agents/skills" ;;',
    '    antigravity) echo "$project_root/.antigravity/skills" ;;',
    '    *) return 1 ;;',
    '  esac',
    '}',
    '',
    'agents=(claude codex antigravity)',
    'if [[ -n "$agent" ]]; then',
    '  agents=("$agent")',
    'fi',
    '',
    'skill_dirs=()',
    'for entry in "$skills_dir"/*; do',
    '  [[ -d "$entry" ]] || continue',
    '  [[ -f "$entry/SKILL.md" ]] || continue',
    '  skill_dirs+=("$entry")',
    'done',
    '',
    'if [[ ${#skill_dirs[@]} -eq 0 ]]; then',
    '  echo "No skills found in $skills_dir (no directories with SKILL.md)" >&2',
    '  exit 0',
    'fi',
    '',
    'for agent_name in "${agents[@]}"; do',
    '  target_dir="$(resolve_target_dir "$agent_name")"',
    '  if [[ "$clean" == true && -d "$target_dir" ]]; then',
    '    rm -rf "$target_dir"',
    '  fi',
    '  mkdir -p "$target_dir"',
    '  for skill_dir in "${skill_dirs[@]}"; do',
    '    skill_name="$(basename "$skill_dir")"',
    '    rm -rf "$target_dir/$skill_name"',
    '    cp -R "$skill_dir" "$target_dir/"',
    '  done',
    '  printf "Synced %s skill(s) to %s: %s\\n" "${#skill_dirs[@]}" "$agent_name" "$target_dir"',
    'done',
    '',
  ].join('\n');
}

function buildA2aReadme(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'docs/a2a/README.md'),
    '# A2A v1.0 Workspace Starter',
    '',
    'Use these pilot-owned example files as the initial protocol-layer starter',
    'set when this workspace needs A2A-facing artifacts.',
    '',
    '## Files',
    '',
    '- `agent-card.public.json.example`',
    '- `agent-card.authenticated.json.example`',
    '- `jsonrpc-send-message.request.json.example`',
    '- `jsonrpc-get-task.request.json.example`',
    '',
    '## Notes',
    '',
    '- Keep these files standards-aligned and truthful to the repo\'s real capabilities.',
    '- Keep durable handoff and project status in markdown project-memory docs, not here.',
    '- `update-workspace` retires managed legacy JSON starter files from older substrate versions.',
    '- Do not reintroduce the retired generic standalone `task.json.example` model.',
    '',
  ].join('\n');
}

function buildPublicAgentCardExample(profile: WorkspaceSubstrateProfileId): string {
  return JSON.stringify({
    xCatsRuntimeSubstrate: jsonMarker(profile, 'docs/a2a/agent-card.public.json.example'),
    name: 'workspace-agent',
    description: 'Pilot public Agent Card starter for this workspace.',
    supportedInterfaces: [
      {
        url: 'https://agent.example.com/a2a/jsonrpc',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: true,
    },
  }, null, 2) + '\n';
}

function buildAuthenticatedAgentCardExample(profile: WorkspaceSubstrateProfileId): string {
  return JSON.stringify({
    xCatsRuntimeSubstrate: jsonMarker(profile, 'docs/a2a/agent-card.authenticated.json.example'),
    name: 'workspace-agent',
    description: 'Pilot authenticated Agent Card starter for this workspace.',
    supportedInterfaces: [
      {
        url: 'https://agent.example.com/a2a/jsonrpc',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extendedAgentCard: true,
    },
  }, null, 2) + '\n';
}

function buildSendMessageExample(profile: WorkspaceSubstrateProfileId): string {
  return JSON.stringify({
    xCatsRuntimeSubstrate: jsonMarker(profile, 'docs/a2a/jsonrpc-send-message.request.json.example'),
    jsonrpc: '2.0',
    id: 1,
    method: 'SendMessage',
    params: {
      message: {
        messageId: 'starter-message-001',
        role: 'ROLE_USER',
        parts: [
          {
            text: 'Describe the next operator action for this workspace task.',
            mediaType: 'text/plain',
          },
        ],
      },
    },
  }, null, 2) + '\n';
}

function buildGetTaskExample(profile: WorkspaceSubstrateProfileId): string {
  return JSON.stringify({
    xCatsRuntimeSubstrate: jsonMarker(profile, 'docs/a2a/jsonrpc-get-task.request.json.example'),
    jsonrpc: '2.0',
    id: 2,
    method: 'GetTask',
    params: {
      id: 'starter-task-001',
      historyLength: 5,
    },
  }, null, 2) + '\n';
}

function buildTemplates(input: {
  profile: WorkspaceSubstrateProfileId;
  hints?: WorkspaceSubstrateHints;
  enabledAgents: Array<'claude' | 'antigravity' | 'codex'>;
  includeA2A: boolean;
}): WorkspaceTemplateFile[] {
  const files: WorkspaceTemplateFile[] = [
    {
      path: 'AGENTS.md',
      content: buildAgentsFile(input.profile, input.hints, input.enabledAgents),
    },
    {
      path: 'docs/AGENT-GUIDE.md',
      content: buildAgentGuide(input.profile, input.enabledAgents),
    },
    {
      path: 'docs/terminology.md',
      content: buildTerminology(input.profile),
    },
    {
      path: 'docs/README.md',
      content: buildDocsReadme(input.profile),
    },
    {
      path: 'docs/specs/README.md',
      content: buildSpecsReadme(input.profile),
    },
    {
      path: 'docs/plans/README.md',
      content: buildPlansReadme(input.profile),
    },
    {
      path: 'docs/research/README.md',
      content: buildResearchReadme(input.profile),
    },
    {
      path: 'docs/decisions/README.md',
      content: buildDecisionsReadme(input.profile),
    },
    {
      path: 'PROGRESS.md',
      content: buildProgress(input.profile),
    },
    {
      path: 'skills/README.md',
      content: buildSkillsReadme(input.profile),
    },
    {
      path: 'scripts/README.md',
      content: buildScriptsReadme(input.profile),
    },
  ];

  if (input.enabledAgents.length > 0) {
    files.push(
      {
        path: 'scripts/windows/Sync-AgentSkills.ps1',
        content: buildWindowsSyncAgentSkillsScript(input.profile),
      },
      {
        path: 'scripts/linux/sync-agent-skills.sh',
        content: buildPosixSyncAgentSkillsScript(
          input.profile,
          'scripts/linux/sync-agent-skills.sh',
        ),
      },
      {
        path: 'scripts/macos/sync-agent-skills.sh',
        content: buildPosixSyncAgentSkillsScript(
          input.profile,
          'scripts/macos/sync-agent-skills.sh',
        ),
      },
    );
  }

  for (const agent of input.enabledAgents) {
    files.push({
      path: `${agent.toUpperCase()}.md`,
      content: buildAgentSpecificFile(agent, input.profile),
    });
  }

  if (input.includeA2A) {
    files.push(
      {
        path: 'docs/a2a/README.md',
        content: buildA2aReadme(input.profile),
      },
      {
        path: 'docs/a2a/agent-card.public.json.example',
        content: buildPublicAgentCardExample(input.profile),
      },
      {
        path: 'docs/a2a/agent-card.authenticated.json.example',
        content: buildAuthenticatedAgentCardExample(input.profile),
      },
      {
        path: 'docs/a2a/jsonrpc-send-message.request.json.example',
        content: buildSendMessageExample(input.profile),
      },
      {
        path: 'docs/a2a/jsonrpc-get-task.request.json.example',
        content: buildGetTaskExample(input.profile),
      },
    );
  }

  return files;
}

function isManagedContent(content: string): boolean {
  return content.includes(MANAGED_MARKER);
}

function isReadOnlyOperation(operation: WorkspaceSubstrateRequest['operation']): boolean {
  return operation === 'audit-workspace';
}

function isPrivilegedActorRole(
  actorRole: WorkspaceSubstrateAuthorization['actorRole'],
): actorRole is PrivilegedActorRole {
  return actorRole !== undefined
    && PRIVILEGED_ACTOR_ROLES.includes(actorRole as PrivilegedActorRole);
}

function createAuthorization(
  request: WorkspaceSubstrateRequest,
): WorkspaceSubstrateAuthorization {
  const approved = request.authorization?.approved === true;
  const actorRole = request.authorization?.actorRole;
  const applyRequested = request.apply === true;

  if (isReadOnlyOperation(request.operation)) {
    return {
      actorRole,
      approved,
      canApply: false,
      requiresApproval: false,
      reason: applyRequested
        ? 'audit-workspace is read-only; apply requests return preview only.'
        : 'audit-workspace is read-only.',
    };
  }

  const privileged = isPrivilegedActorRole(actorRole);

  if (privileged || approved) {
    return {
      actorRole,
      approved,
      canApply: true,
      requiresApproval: false,
      reason: applyRequested
        ? privileged
          ? `Apply is authorized for actorRole='${actorRole}'.`
          : 'Apply is authorized because approval has been recorded.'
        : 'Actor context may apply mutable workspace substrate changes when requested.',
    };
  }

  return {
    actorRole,
    approved,
    canApply: false,
    requiresApproval: true,
    reason: 'Apply requires Boss Cat, system, owner, or explicit approval.',
  };
}

function createApplyPayload(input: {
  operation: WorkspaceSubstrateRequest['operation'];
  workspacePath: string;
  profile: WorkspaceSubstrateProfileId;
  enabledAgents: Array<'claude' | 'antigravity' | 'codex'>;
  includeA2A: boolean;
  hints?: WorkspaceSubstrateHints;
}): WorkspaceSubstrateApplyPayload | undefined {
  if (isReadOnlyOperation(input.operation)) {
    return undefined;
  }

  return {
    operation: input.operation === 'init-workspace' ? 'init-workspace' : 'update-workspace',
    workspacePath: input.workspacePath,
    profile: input.profile,
    enabledAgents: input.enabledAgents,
    includeA2A: input.includeA2A,
    hints: input.hints,
    apply: true,
  };
}

function classifyAuditStatus(
  findings: WorkspaceSubstrateFinding[],
): WorkspaceSubstrateAuditStatus {
  const counts = {
    missing: findings.filter((finding) => finding.status === 'missing').length,
    present: findings.filter((finding) => finding.status === 'present').length,
    drifted: findings.filter((finding) => finding.status === 'drifted').length,
    conflicting: findings.filter((finding) => finding.status === 'conflicting').length,
  };

  if (counts.conflicting > 0) {
    return 'conflicting';
  }
  if (counts.drifted > 0) {
    return 'drifted';
  }
  if (counts.present === 0 && counts.missing === findings.length) {
    return 'missing';
  }
  if (counts.present === findings.length) {
    return 'present';
  }
  return 'partial';
}

async function readExistingContent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if (isMissingError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function ensureWorkspaceDirectory(path: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) {
      throw new Error(`Workspace path '${path}' is not a directory`);
    }
  } catch (error) {
    if (!isMissingError(error)) {
      throw error;
    }
    await ensureDirectory(path);
  }
}

function toWorkspaceRelative(workspacePath: string, targetPath: string): string {
  const rel = relative(workspacePath, targetPath);
  return rel === '' ? '.' : rel.split('\\').join('/');
}

function createFindingCounts(): Record<WorkspaceSubstrateFindingStatus, number> {
  return {
    missing: 0,
    present: 0,
    drifted: 0,
    conflicting: 0,
  };
}

function createActionCounts(): Record<WorkspaceSubstrateActionType, number> {
  return {
    create: 0,
    update: 0,
    remove: 0,
    skip: 0,
    warn: 0,
    write_sidecar: 0,
  };
}

async function collectLegacyA2aActions(input: {
  workspacePath: string;
  readOnly: boolean;
  canApply: boolean;
}): Promise<{
  findings: WorkspaceSubstrateFinding[];
  actions: PlannedAction[];
}> {
  const findings: WorkspaceSubstrateFinding[] = [];
  const actions: PlannedAction[] = [];

  for (const legacyFile of LEGACY_A2A_STARTER_FILES) {
    const fullPath = join(input.workspacePath, legacyFile.path);
    const existing = await readExistingContent(fullPath);
    if (existing === undefined) {
      continue;
    }

    const actualHash = hashContent(existing);
    if (isManagedContent(existing)) {
      findings.push({
        path: legacyFile.path,
        status: 'drifted',
        reason: `Obsolete runtime-managed legacy A2A starter file should be retired in favor of ${legacyFile.replacementPath}.`,
        managed: true,
        actualHash,
      });
      actions.push({
        type: 'remove',
        path: legacyFile.path,
        outputPath: legacyFile.path,
        mergeStrategy: 'remove_managed',
        reason: `Remove obsolete runtime-managed legacy A2A starter file. Use ${legacyFile.replacementPath} instead.`,
        managed: true,
        actualHash,
        requiresApproval: !input.readOnly && !input.canApply,
        deletePath: fullPath,
      });
      continue;
    }

    findings.push({
      path: legacyFile.path,
      status: 'conflicting',
      reason: `Legacy A2A starter file is no longer runtime-managed and should be reviewed manually. Current starter uses ${legacyFile.replacementPath}.`,
      managed: false,
      actualHash,
    });
    actions.push({
      type: 'warn',
      path: legacyFile.path,
      outputPath: legacyFile.path,
      mergeStrategy: 'noop',
      reason: `Legacy A2A starter file is obsolete. Remove or replace it manually with ${legacyFile.replacementPath}.`,
      managed: false,
      actualHash,
      requiresApproval: false,
    });
  }

  return { findings, actions };
}

export class WorkspaceSubstrateService {
  listProfiles(): WorkspaceSubstrateProfileCatalog {
    return buildWorkspaceSubstrateProfileCatalog();
  }

  async execute(request: WorkspaceSubstrateRequest): Promise<WorkspaceSubstrateResult> {
    const workspacePath = normalizeWorkspacePath(request.workspacePath);
    const profile = normalizeProfile(request.profile);
    const enabledAgents = normalizeAgents(profile, request.enabledAgents);
    const includeA2A = normalizeIncludeA2A(profile, request.includeA2A);
    const eligibility = createAuthorization(request);
    const applyRequested = request.apply === true;
    const readOnly = isReadOnlyOperation(request.operation);
    const templates = buildTemplates({
      profile,
      hints: request.hints,
      enabledAgents,
      includeA2A,
    });

    const findings: WorkspaceSubstrateFinding[] = [];
    const actions: PlannedAction[] = [];

    for (const template of templates) {
      const fullPath = join(workspacePath, template.path);
      const existing = await readExistingContent(fullPath);
      const desiredHash = hashContent(template.content);

      if (existing === undefined) {
        const diff = buildTextDiffPreview(template.path, '', template.content);
        findings.push({
          path: template.path,
          status: 'missing',
          reason: 'Expected substrate file is missing.',
          desiredHash,
        });
        actions.push({
          type: 'create',
          path: template.path,
          outputPath: template.path,
          mergeStrategy: 'create',
          reason: 'Create missing substrate file.',
          desiredHash,
          preview: template.content,
          diff: diff.text,
          diffStats: diff.stats,
          requiresApproval: !readOnly && !eligibility.canApply,
          writePath: fullPath,
          content: template.content,
        });
        continue;
      }

      const actualHash = hashContent(existing);
      if (existing === template.content) {
        findings.push({
          path: template.path,
          status: 'present',
          reason: 'Workspace file already matches the selected substrate profile.',
          managed: isManagedContent(existing),
          actualHash,
          desiredHash,
        });
        actions.push({
          type: 'skip',
          path: template.path,
          outputPath: template.path,
          mergeStrategy: 'noop',
          reason: 'No changes required.',
          managed: isManagedContent(existing),
          actualHash,
          desiredHash,
          diffStats: {
            changed: false,
            addedLines: 0,
            removedLines: 0,
          },
          requiresApproval: false,
        });
        continue;
      }

      if (isManagedContent(existing)) {
        const diff = buildTextDiffPreview(template.path, existing, template.content);
        findings.push({
          path: template.path,
          status: 'drifted',
          reason: 'Runtime-managed substrate file drifted from the selected profile.',
          managed: true,
          actualHash,
          desiredHash,
        });
        actions.push({
          type: 'update',
          path: template.path,
          outputPath: template.path,
          mergeStrategy: 'update_managed',
          reason: 'Update runtime-managed substrate file to converge with the selected profile.',
          managed: true,
          actualHash,
          desiredHash,
          preview: template.content,
          diff: diff.text,
          diffStats: diff.stats,
          requiresApproval: !readOnly && !eligibility.canApply,
          writePath: fullPath,
          content: template.content,
        });
        continue;
      }

      const reviewCopyPath = `${template.path}${REVIEW_COPY_SUFFIX}`;
      const diff = buildTextDiffPreview(template.path, existing, template.content);
      findings.push({
        path: template.path,
        status: 'conflicting',
        reason: 'Existing file appears customized; proposal uses a review copy instead of overwrite.',
        managed: false,
        actualHash,
        desiredHash,
        reviewCopyPath,
      });
      actions.push({
        type: 'write_sidecar',
        path: template.path,
        outputPath: reviewCopyPath,
        mergeStrategy: 'review_copy',
        reason: 'Write a review copy because overwriting the existing file would be unsafe.',
        managed: false,
        actualHash,
        desiredHash,
        preview: template.content,
        diff: diff.text,
        diffStats: diff.stats,
        reviewCopyPath,
        requiresApproval: !readOnly && !eligibility.canApply,
        writePath: join(workspacePath, reviewCopyPath),
        content: template.content,
      });
      actions.push({
        type: 'warn',
        path: template.path,
        outputPath: reviewCopyPath,
        mergeStrategy: 'noop',
        reason: `Review ${reviewCopyPath} before merging substrate changes into ${template.path}.`,
        reviewCopyPath,
        actualHash,
        desiredHash,
        requiresApproval: false,
      });
    }

    if (includeA2A) {
      const legacyA2a = await collectLegacyA2aActions({
        workspacePath,
        readOnly,
        canApply: eligibility.canApply,
      });
      findings.push(...legacyA2a.findings);
      actions.push(...legacyA2a.actions);
    }

    const status = classifyAuditStatus(findings);
    const publicActions = actions.map((action) => ({
      type: action.type,
      path: action.path,
      reason: action.reason,
      outputPath: action.outputPath,
      mergeStrategy: action.mergeStrategy,
      managed: action.managed,
      actualHash: action.actualHash,
      desiredHash: action.desiredHash,
      preview: action.preview,
      diff: action.diff,
      diffStats: action.diffStats,
      reviewCopyPath: action.reviewCopyPath,
      requiresApproval: action.requiresApproval,
    }));
    const changedPaths = Array.from(new Set(
      publicActions
        .filter((action) => (
          action.type === 'create'
          || action.type === 'update'
          || action.type === 'remove'
          || action.type === 'write_sidecar'
        ))
        .map((action) => action.outputPath || action.reviewCopyPath || action.path),
    ));
    const reviewCopyPaths = Array.from(new Set(
      publicActions
        .map((action) => action.reviewCopyPath)
        .filter((path): path is string => Boolean(path)),
    ));
    const pendingApprovalPaths = Array.from(new Set(
      publicActions
        .filter((action) => action.requiresApproval === true)
        .map((action) => action.outputPath || action.reviewCopyPath || action.path),
    ));
    const applyPayload = changedPaths.length > 0
      ? createApplyPayload({
        operation: request.operation,
        workspacePath,
        profile,
        enabledAgents,
        includeA2A,
        hints: request.hints,
      })
      : undefined;
    const approvalRequired = pendingApprovalPaths.length > 0;
    const authorizationReason = readOnly
      ? applyRequested
        ? 'audit-workspace is read-only; preview returned without filesystem changes.'
        : 'audit-workspace is read-only.'
      : changedPaths.length === 0
        ? 'No filesystem changes are pending.'
        : eligibility.canApply
          ? applyRequested
            ? eligibility.reason
            : 'Actor context may apply this workspace substrate plan when requested.'
          : 'Apply requires Boss Cat, system, owner, or explicit approval.';
    const authorization: WorkspaceSubstrateAuthorization = {
      ...eligibility,
      requiresApproval: approvalRequired,
      reason: authorizationReason,
    };
    const contract: WorkspaceSubstrateContract = {
      mode: applyRequested ? 'apply' : 'preview',
      safeDefaultMode: 'preview',
      applyRequested,
      applyDecision: !applyRequested
        ? 'not_requested'
        : readOnly
          ? 'read_only_operation'
          : eligibility.canApply
            ? 'applied'
            : 'blocked',
      readOnly,
    };
    const approval: WorkspaceSubstrateApprovalPayload = {
      required: approvalRequired,
      reason: readOnly
        ? 'audit-workspace never writes; use preview output to choose a later mutable operation.'
        : changedPaths.length === 0
          ? 'No approval payload is needed because the plan contains no filesystem writes.'
          : approvalRequired
            ? 'Apply is blocked until Boss Cat, system, owner, or explicit approval authorizes the plan.'
            : 'Current actor context may apply this plan without additional approval.',
      privilegedActorRoles: [...PRIVILEGED_ACTOR_ROLES],
      blockedPaths: pendingApprovalPaths,
      applyPayload,
    };

    const result: WorkspaceSubstrateResult = {
      operation: request.operation,
      workspacePath,
      profile,
      enabledAgents,
      includeA2A,
      status,
      contract,
      authorization,
      plan: {
        stepCount: publicActions.length,
        changedPaths,
        reviewCopyPaths,
        pendingApprovalPaths,
        requiresApproval: approvalRequired,
        applyPayload,
      },
      approval,
      findings,
      actions: publicActions,
      applied: false,
      summary: {
        expectedFileCount: templates.length,
        changedPaths,
        reviewCopyPaths,
        pendingApprovalPaths,
        findingCounts: createFindingCounts(),
        actionCounts: createActionCounts(),
      },
    };

    for (const finding of findings) {
      result.summary.findingCounts[finding.status] += 1;
    }
    for (const action of publicActions) {
      result.summary.actionCounts[action.type] += 1;
    }

    if (!applyRequested || readOnly || !eligibility.canApply) {
      return result;
    }

    await ensureWorkspaceDirectory(workspacePath);
    for (const action of actions) {
      if (action.deletePath) {
        try {
          await unlink(action.deletePath);
        } catch (error) {
          if (!isMissingError(error)) {
            throw error;
          }
        }
        continue;
      }

      if (!action.writePath || action.content === undefined) {
        continue;
      }

      await ensureDirectory(dirname(action.writePath));
      await writeFile(action.writePath, action.content, 'utf-8');
    }

    return {
      ...result,
      applied: true,
      summary: {
        ...result.summary,
        changedPaths: actions
          .filter((action) => action.writePath || action.deletePath)
          .map((action) => toWorkspaceRelative(
            workspacePath,
            action.writePath ?? action.deletePath!,
          )),
      },
    };
  }
}
