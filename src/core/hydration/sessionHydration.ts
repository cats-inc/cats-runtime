import type {
  ProviderBackend,
  RuntimeSkillManifest,
  SessionHydrationSkillSource,
  SessionHydrationState,
  SessionSkillState,
  WorkspaceMode,
  WorkspaceSubstrateFindingStatus,
  WorkspaceSubstrateProfileId,
} from '../types.js';
import { resolveRuntimeSkillManifest } from '../skills/catalog.js';
import { WorkspaceSubstrateService } from '../runtime/WorkspaceSubstrateService.js';

const DEFAULT_WORKSPACE_SUBSTRATE_PROFILE: WorkspaceSubstrateProfileId = 'standard';
const workspaceSubstrate = new WorkspaceSubstrateService();

export interface HydrateSessionStateInput {
  trigger: SessionHydrationState['trigger'];
  sessionId: string;
  providerName: string;
  providerBackend: ProviderBackend;
  runtimeCwd: string;
  workspaceMode?: WorkspaceMode;
  sessionBaseDir: string;
  requestedSkills?: RuntimeSkillManifest;
  existingSkills?: SessionSkillState;
  requestedWorkspaceSourceCwd?: string;
  existingHydration?: SessionHydrationState;
  workspaceSubstrateProfile?: WorkspaceSubstrateProfileId;
  baseInstructionsFile?: string;
  skillsRoot?: string;
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
    requestedSkills: [...skillState.requestedSkills],
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
              provider: resolvedSkills.skillState.delivery.provider,
              backend: resolvedSkills.skillState.delivery.backend,
              preferredMode: resolvedSkills.skillState.delivery.preferredMode,
              mode: resolvedSkills.skillState.delivery.mode,
              status: resolvedSkills.skillState.delivery.status,
              warnings: [...resolvedSkills.skillState.warnings],
            },
          }
        : {}),
      ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {}),
    },
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
  const substrate = await auditWorkspaceSubstrate(auditPath, profile, checkedAt, warnings);

  return {
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
  if (input.workspaceMode === 'isolated') {
    return requested ?? normalizeOptionalPath(input.existingHydration?.workspace.sourceCwd);
  }

  return requested ?? input.runtimeCwd;
}

function normalizeOptionalPath(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

async function auditWorkspaceSubstrate(
  workspacePath: string,
  profile: WorkspaceSubstrateProfileId,
  checkedAt: string,
  warnings: string[],
): Promise<SessionHydrationState['workspace']['substrate']> {
  try {
    const result = await workspaceSubstrate.execute({
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
