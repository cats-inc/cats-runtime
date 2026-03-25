import type {
  ProviderBackend,
  RuntimeSkillManifest,
  SessionHydrationSkillSource,
  SessionHydrationState,
  SessionSkillState,
  SessionWorkspaceState,
  WorkspaceAccess,
  WorkspaceKind,
  WorkspaceIsolationMode,
  WorkspaceMode,
  WorkspaceSubstrateFindingStatus,
  WorkspaceSubstrateProfileId,
} from '../types.js';
import { resolveRuntimeSkillManifest } from '../skills/catalog.js';
import { WorkspaceSubstrateService } from '../runtime/WorkspaceSubstrateService.js';
import { deriveWorkspaceIsolationMode } from '../workspace/sessionWorkspace.js';

const DEFAULT_WORKSPACE_SUBSTRATE_PROFILE: WorkspaceSubstrateProfileId = 'standard';
const DEFAULT_WORKSPACE_SUBSTRATE_SERVICE = new WorkspaceSubstrateService();

export interface WorkspaceHydrationSubstrateService {
  execute: Pick<WorkspaceSubstrateService, 'execute'>['execute'];
}

export interface HydrateSessionStateInput {
  trigger: SessionHydrationState['trigger'];
  sessionId: string;
  providerName: string;
  providerBackend: ProviderBackend;
  runtimeCwd: string;
  workspace?: SessionWorkspaceState;
  workspaceMode?: WorkspaceMode;
  workspaceIsolationMode?: WorkspaceIsolationMode;
  sessionBaseDir: string;
  requestedSkills?: RuntimeSkillManifest;
  existingSkills?: SessionSkillState;
  requestedWorkspaceSourceCwd?: string;
  existingHydration?: SessionHydrationState;
  workspaceSubstrateProfile?: WorkspaceSubstrateProfileId;
  baseInstructionsFile?: string;
  skillsRoot?: string;
  substrateService?: WorkspaceHydrationSubstrateService;
  metadata?: Record<string, unknown>;
  now?: Date;
}

export interface HydrateSessionStateResult {
  skills?: SessionSkillState;
  hydration: SessionHydrationState;
}

interface ResolvedSkillHydration {
  source: SessionHydrationSkillSource;
  skillState: SessionSkillState;
}

export function buildRuntimeSkillManifestFromState(
  skillState: SessionSkillState | undefined,
): RuntimeSkillManifest | undefined {
  if (!skillState || skillState.requestedSkills.length === 0) {
    return undefined;
  }

  return {
    ...(skillState.profileId ? { profileId: skillState.profileId } : {}),
    requestedSkills: skillState.requestedSkillRefs?.length
      ? skillState.requestedSkillRefs.map((skillRef) => {
          // Re-entry should preserve identity/family, but not pin sessions to a
          // historical package fingerprint or version that may drift after a
          // library update. Explicit request-time pinning still works because it
          // bypasses this persisted-state rebuild path.
          if (skillRef.family) {
            return {
              id: skillRef.id,
              family: skillRef.family,
              slug: skillRef.slug,
            };
          }

          return skillRef.id;
        })
      : [...skillState.requestedSkills],
    ...(skillState.context ? { context: structuredClone(skillState.context) } : {}),
    strict: skillState.strict === true,
  };
}

export async function hydrateSessionState(
  input: HydrateSessionStateInput,
): Promise<HydrateSessionStateResult> {
  const now = (input.now ?? new Date()).toISOString();
  const resolvedSkills = resolveSkillHydration(input);
  const workspace = await hydrateWorkspace(input, now);
  const metadata = mergeHydrationMetadata(
    input.existingHydration?.metadata,
    input.metadata,
  );

  return {
    ...(resolvedSkills ? { skills: resolvedSkills.skillState } : {}),
    hydration: {
      trigger: input.trigger,
      updatedAt: now,
      workspace,
      ...(resolvedSkills
        ? {
            skills: {
              source: resolvedSkills.source,
              requestedSkills: [...resolvedSkills.skillState.requestedSkills],
              ...(resolvedSkills.skillState.requestedSkillRefs?.length
                ? {
                    requestedSkillRefs: resolvedSkills.skillState.requestedSkillRefs
                      .map((skillRef) => structuredClone(skillRef)),
                  }
                : {}),
              resolvedSkills: resolvedSkills.skillState.resolvedSkills
                .map((skill) => structuredClone(skill)),
              appliedSkillIds: [...resolvedSkills.skillState.appliedSkillIds],
              provider: resolvedSkills.skillState.delivery.provider,
              backend: resolvedSkills.skillState.delivery.backend,
              preferredMode: resolvedSkills.skillState.delivery.preferredMode,
              mode: resolvedSkills.skillState.delivery.mode,
              status: resolvedSkills.skillState.delivery.status,
              warnings: [...resolvedSkills.skillState.warnings],
            },
          }
        : {}),
      ...(metadata ? { metadata } : {}),
    },
  };
}

function mergeHydrationMetadata(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !next) {
    return undefined;
  }

  if (!existing) {
    return structuredClone(next);
  }

  if (!next) {
    return structuredClone(existing);
  }

  return {
    ...structuredClone(existing),
    ...structuredClone(next),
  };
}

function resolveSkillHydration(
  input: HydrateSessionStateInput,
): ResolvedSkillHydration | undefined {
  const requestedManifest = input.requestedSkills;
  const persistedManifest = buildRuntimeSkillManifestFromState(input.existingSkills);
  const source = requestedManifest ? 'request' : persistedManifest ? 'session_state' : undefined;
  const manifest = requestedManifest ?? persistedManifest;
  if (!manifest || !source) {
    return undefined;
  }

  const skillState = resolveRuntimeSkillManifest(manifest, {
    sessionId: input.sessionId,
    providerName: input.providerName,
    providerBackend: input.providerBackend,
    cwd: input.runtimeCwd,
    workspaceMode: input.workspaceMode,
    sessionBaseDir: input.sessionBaseDir,
    baseInstructionsFile: input.baseInstructionsFile,
    skillsRoot: input.skillsRoot,
    now: input.now,
  });
  if (!skillState) {
    return undefined;
  }

  return {
    source,
    skillState,
  };
}

async function hydrateWorkspace(
  input: HydrateSessionStateInput,
  checkedAt: string,
): Promise<SessionHydrationState['workspace']> {
  const sourceCwd = resolveWorkspaceSourceCwd(input);
  const sourceOfTruth = sourceCwd && sourceCwd !== input.runtimeCwd
    ? 'source_workspace'
    : 'runtime_cwd';
  const auditPath = sourceOfTruth === 'source_workspace'
    ? sourceCwd!
    : input.runtimeCwd;
  const warnings: string[] = [];

  if (sourceOfTruth === 'source_workspace') {
    warnings.push(
      'The runtime cwd is an isolated sandbox; re-entry should hydrate from the source workspace.',
    );
  } else if (input.workspaceMode === 'isolated') {
    warnings.push(
      'This isolated runtime cwd has no separate source workspace recorded; treat it as session-scoped state only.',
    );
  }

  const profile = input.workspaceSubstrateProfile
    ?? input.existingHydration?.workspace.substrate.profile
    ?? DEFAULT_WORKSPACE_SUBSTRATE_PROFILE;
  const substrate = await auditWorkspaceSubstrate(
    input.substrateService ?? DEFAULT_WORKSPACE_SUBSTRATE_SERVICE,
    auditPath,
    profile,
    checkedAt,
    warnings,
  );

  return {
    kind: resolveWorkspaceKind(input),
    access: resolveWorkspaceAccess(input),
    isolationMode: input.workspaceIsolationMode ?? deriveWorkspaceIsolationMode(input.workspaceMode),
    runtimeCwd: input.runtimeCwd,
    ...(sourceCwd ? { sourceCwd } : {}),
    sourceOfTruth,
    substrate,
    warnings,
  };
}

function resolveWorkspaceSourceCwd(
  input: HydrateSessionStateInput,
): string | undefined {
  const requested = normalizeOptionalPath(input.requestedWorkspaceSourceCwd);
  if ((input.workspace?.kind ?? resolveWorkspaceKind(input)) === 'sandbox') {
    return requested ?? normalizeOptionalPath(input.existingHydration?.workspace.sourceCwd);
  }

  return requested ?? input.runtimeCwd;
}

function resolveWorkspaceKind(
  input: HydrateSessionStateInput,
): WorkspaceKind {
  if (input.workspace?.kind) {
    return input.workspace.kind;
  }
  if (input.workspaceIsolationMode === 'worktree') {
    return 'worktree';
  }
  if (input.workspaceMode === 'isolated') {
    return 'sandbox';
  }
  return 'source';
}

function resolveWorkspaceAccess(
  input: HydrateSessionStateInput,
): WorkspaceAccess {
  return input.workspace?.access ?? (input.workspaceMode === 'read_only' ? 'read_only' : 'read_write');
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

async function auditWorkspaceSubstrate(
  substrateService: WorkspaceHydrationSubstrateService,
  workspacePath: string,
  profile: WorkspaceSubstrateProfileId,
  checkedAt: string,
  warnings: string[],
): Promise<SessionHydrationState['workspace']['substrate']> {
  try {
    const result = await substrateService.execute({
      operation: 'audit-workspace',
      workspacePath,
      profile,
    });

    return {
      auditPath: workspacePath,
      profile,
      status: result.status,
      checkedAt,
      changedPaths: [...result.summary.changedPaths],
      reviewCopyPaths: [...result.summary.reviewCopyPaths],
      findingCounts: {
        missing: result.summary.findingCounts.missing,
        present: result.summary.findingCounts.present,
        drifted: result.summary.findingCounts.drifted,
        conflicting: result.summary.findingCounts.conflicting,
      },
    };
  } catch (error) {
    if (!isRecoverableWorkspaceAuditError(error)) {
      throw error;
    }

    warnings.push(
      `Workspace substrate audit failed for '${workspacePath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {
      auditPath: workspacePath,
      profile,
      status: 'conflicting',
      checkedAt,
      changedPaths: [],
      reviewCopyPaths: [],
      findingCounts: createEmptyFindingCounts(),
    };
  }
}

function createEmptyFindingCounts(): Record<WorkspaceSubstrateFindingStatus, number> {
  return {
    missing: 0,
    present: 0,
    drifted: 0,
    conflicting: 0,
  };
}

function isRecoverableWorkspaceAuditError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (
    error instanceof TypeError
    || error instanceof ReferenceError
    || error instanceof SyntaxError
    || error instanceof RangeError
    || error instanceof EvalError
    || error instanceof URIError
  ) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  if (typeof code === 'string' && code.length > 0) {
    return true;
  }

  return error.message.startsWith('Workspace path ');
}
