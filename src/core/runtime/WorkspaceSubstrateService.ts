import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  stat,
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
  WorkspaceSubstrateContract,
  WorkspaceSubstrateDiffStats,
  WorkspaceSubstrateFinding,
  WorkspaceSubstrateFindingStatus,
  WorkspaceSubstrateHints,
  WorkspaceSubstrateProfileId,
  WorkspaceSubstrateRequest,
  WorkspaceSubstrateResult,
} from '../types.js';

const MANAGED_MARKER = 'cats-runtime:workspace-substrate';
const REVIEW_COPY_SUFFIX = '.bootstrap';
const DEFAULT_STANDARD_AGENTS = ['claude', 'gemini', 'codex'] as const;
const PRIVILEGED_ACTOR_ROLES = ['boss_cat', 'system', 'owner'] as const;

interface WorkspaceTemplateFile {
  path: string;
  content: string;
}

interface DiffPreview {
  text: string;
  stats: WorkspaceSubstrateDiffStats;
}

interface PlannedAction extends WorkspaceSubstrateAction {
  writePath?: string;
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
  enabledAgents?: Array<'claude' | 'gemini' | 'codex'>,
): Array<'claude' | 'gemini' | 'codex'> {
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

function markdownMarker(profile: WorkspaceSubstrateProfileId, filePath: string): string {
  return `<!-- ${MANAGED_MARKER} profile=${profile} file=${filePath} -->`;
}

function jsonMarker(profile: WorkspaceSubstrateProfileId, filePath: string): string {
  return `${MANAGED_MARKER} profile=${profile} file=${filePath}`;
}

function humanizeAgent(agent: 'claude' | 'gemini' | 'codex'): string {
  switch (agent) {
    case 'claude':
      return 'Claude';
    case 'gemini':
      return 'Gemini';
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
  enabledAgents: Array<'claude' | 'gemini' | 'codex'>,
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
  agent: 'claude' | 'gemini' | 'codex',
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
  enabledAgents: Array<'claude' | 'gemini' | 'codex'>,
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

function buildA2aReadme(profile: WorkspaceSubstrateProfileId): string {
  return [
    markdownMarker(profile, 'docs/a2a/README.md'),
    '# A2A Workspace Starter',
    '',
    'Use these example files as the initial contract when this workspace exposes agent-to-agent interfaces.',
    '',
    '## Files',
    '',
    '- `agent-card.json.example`',
    '- `task.json.example`',
    '',
    '## Notes',
    '',
    '- Keep examples aligned with the actual runtime surface.',
    '- Treat these files as coordination artifacts, not product workflow policy.',
    '',
  ].join('\n');
}

function buildAgentCardExample(profile: WorkspaceSubstrateProfileId): string {
  return JSON.stringify({
    xCatsRuntimeSubstrate: jsonMarker(profile, 'docs/a2a/agent-card.json.example'),
    name: 'workspace-agent',
    description: 'Example A2A agent card for this workspace.',
    capabilities: ['execute', 'observe'],
    endpoint: 'http://127.0.0.1:3110',
  }, null, 2) + '\n';
}

function buildTaskExample(profile: WorkspaceSubstrateProfileId): string {
  return JSON.stringify({
    xCatsRuntimeSubstrate: jsonMarker(profile, 'docs/a2a/task.json.example'),
    task: {
      id: 'task-example',
      intent: 'inspect_workspace',
      input: {
        workspacePath: '.',
      },
    },
  }, null, 2) + '\n';
}

function buildTemplates(input: {
  profile: WorkspaceSubstrateProfileId;
  hints?: WorkspaceSubstrateHints;
  enabledAgents: Array<'claude' | 'gemini' | 'codex'>;
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
      path: 'PROGRESS.md',
      content: buildProgress(input.profile),
    },
  ];

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
        path: 'docs/a2a/agent-card.json.example',
        content: buildAgentCardExample(input.profile),
      },
      {
        path: 'docs/a2a/task.json.example',
        content: buildTaskExample(input.profile),
      },
    );
  }

  return files;
}

function isManagedContent(content: string): boolean {
  return content.includes(MANAGED_MARKER);
}

function splitLinesForDiff(content: string): string[] {
  return content === '' ? [] : content.split('\n');
}

function buildDiff(path: string, before: string, after: string): DiffPreview {
  if (before === after) {
    return {
      text: `--- ${path}\n+++ ${path}\n@@ no changes @@`,
      stats: {
        changed: false,
        addedLines: 0,
        removedLines: 0,
      },
    };
  }

  const beforeLines = splitLinesForDiff(before);
  const afterLines = splitLinesForDiff(after);
  let start = 0;
  while (
    start < beforeLines.length
    && start < afterLines.length
    && beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= start
    && afterEnd >= start
    && beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const removed = beforeLines.slice(start, beforeEnd + 1).map((line) => `-${line}`);
  const added = afterLines.slice(start, afterEnd + 1).map((line) => `+${line}`);
  const beforeCount = Math.max(0, beforeEnd - start + 1);
  const afterCount = Math.max(0, afterEnd - start + 1);

  return {
    text: [
      `--- ${path}`,
      `+++ ${path}`,
      `@@ -${start + 1},${beforeCount} +${start + 1},${afterCount} @@`,
      ...removed,
      ...added,
    ].join('\n'),
    stats: {
      changed: true,
      addedLines: added.length,
      removedLines: removed.length,
    },
  };
}

function isReadOnlyOperation(operation: WorkspaceSubstrateRequest['operation']): boolean {
  return operation === 'audit-workspace';
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

  const privileged = actorRole === 'boss_cat' || actorRole === 'system' || actorRole === 'owner';

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
  enabledAgents: Array<'claude' | 'gemini' | 'codex'>;
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
    skip: 0,
    warn: 0,
    write_sidecar: 0,
  };
}

export class WorkspaceSubstrateService {
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
        const diff = buildDiff(template.path, '', template.content);
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
        const diff = buildDiff(template.path, existing, template.content);
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
      const diff = buildDiff(template.path, existing, template.content);
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
        .filter((action) => action.type === 'create' || action.type === 'update' || action.type === 'write_sidecar')
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
      privilegedActorRoles: [...PRIVILEGED_ACTOR_ROLES] as Array<'boss_cat' | 'system' | 'owner'>,
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
          .filter((action) => action.writePath)
          .map((action) => toWorkspaceRelative(workspacePath, action.writePath!)),
      },
    };
  }
}
