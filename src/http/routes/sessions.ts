import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Hono } from 'hono';
import {
  getRuntimeBrowserService,
  getProviderCompatibilityService,
  getRuntimeMeteringService,
  getRuntimeSessionManager,
  type AppContext,
} from '../app.js';
import {
  isProviderNotConfiguredError,
  isUnknownProviderInstanceError,
  type ProviderInstanceConfig,
} from '../../backends/cli/config.js';
import type { SessionsIndex } from '../../backends/cli/discovery/types.js';
import type { PreparedFileDeletion } from '../../backends/cli/pool/SessionRegistry.js';
import type {
  SessionInfo,
  SessionInvocationContext,
} from '../../backends/cli/pool/types.js';
import type {
  RuntimeSessionMaintenanceAction,
  RuntimeSessionMaintenanceFollowThroughOutcome,
  RuntimeSessionMaintenanceHookPayload,
  RuntimeSessionMaintenanceRequest,
  RuntimeSessionLifecycleCleanupSummary,
  SessionArtifact,
  SessionBranchCapabilityTruth,
  SessionBranchRequest,
  SessionContextTransplant,
  ProviderSpawnOptions,
  SessionReusePolicy,
  SessionStatus,
  SessionWorkspaceState,
  WorktreeCleanupPolicy,
  WorkspaceAccess,
  WorkspaceKind,
  WorkspaceIsolationMode,
  WorkspaceMode,
} from '../../core/types.js';
import {
  toSessionView,
  toSessionViews,
} from '../../backends/cli/pool/sessionView.js';
import { buildToolPolicyInspection } from '../../core/tools/LocalToolRuntime.js';
import {
  SessionScanner,
} from '../../backends/cli/discovery/SessionScanner.js';
import {
  CodexSessionScanner,
} from '../../backends/cli/discovery/CodexSessionScanner.js';
import {
  CopilotSessionScanner,
} from '../../backends/cli/discovery/CopilotSessionScanner.js';
import {
  GeminiSessionScanner,
} from '../../backends/cli/discovery/GeminiSessionScanner.js';
import {
  PiSessionScanner,
} from '../../backends/cli/discovery/PiSessionScanner.js';
import {
  resolveFileBackedProviderPath,
} from '../../backends/cli/providerPaths.js';
import {
  getCursorNative,
  getGooseNative,
  getKiloNative,
  getKiroNative,
  getOpencodeNative,
  getAuggieSessions,
  getClaudeProjectsDir,
  getCodexSessionsDir,
  getCopilotSessionsDir,
  getGeminiSessionsDir,
} from '../providerServices.js';
import { resolvePiResumeTarget } from '../../backends/cli/pi/resume.js';
import { JunieSessionScanner } from '../../backends/cli/junie/JunieSessionScanner.js';
import {
  getProviderDefaultTarget,
  listConfiguredProviders,
  resolveProviderTarget,
  type ProviderTargetDescriptor,
} from '../../core/providerCatalog.js';
import { resolveSessionProviderTarget } from '../providerTargets.js';
import { buildSessionProviderTargetSummary } from '../sessionProviderTarget.js';
import {
  attachBranchMetadata,
  buildSessionBranchObservability,
  buildSessionSelfBranchCapabilityTruth,
  buildChildLineage,
  buildContextTransplantInstructions,
  buildDefaultContextTransplant,
  getSessionContextTransplant,
  getSessionLineage,
  resolveSessionBranchDecision,
  summarizeContextTransplant,
} from '../../core/runtime/sessionBranching.js';
import { buildSessionInspection } from '../../core/runtime/sessionInspection.js';
import {
  canRuntimeCompactSessionTranscript,
  compactRuntimeManagedTranscript,
} from '../../core/runtime/sessionCompaction.js';
import {
  runManualSessionDiscovery,
  type ManualSessionDiscoveryTarget,
} from '../../core/runtime/manualSessionDiscovery.js';
import type { ProviderModelSelection } from '../../core/models/providerSelectionResolution.js';
import {
  canonicalizeProviderModelSelection,
  createLegacyModelSelection,
  isLegacyCompatibleExplicitSelection,
  parseProviderModelSelection,
  resolveProviderSelection,
  sameProviderModelSelection,
} from '../../core/models/providerSelectionResolution.js';
import { normalizeProviderCatalogModelId } from '../../core/models/providerModelCatalog.js';
import { cloneProviderControls } from '../../core/models/providerControlUtils.js';
import {
  buildRuntimeExecutionStrategySessionPatch,
  readRuntimeExecutionStrategyEffectiveStrategy,
  readRuntimeExecutionStrategyRequest,
  readRuntimeExecutionStrategyState,
} from '../../core/runtime/strategies/state.js';
import { hydrateSessionState } from '../../core/hydration/sessionHydration.js';
import {
  extractHydrationMetadata,
  parseInvocationContext,
  parseOptionalString,
  parseRuntimeExecutionStrategyRequest,
  parseRuntimeSkillManifest,
  parseStringArray,
} from '../parsing.js';
import { toRuntimeSkillErrorResponse } from '../runtimeSkillErrors.js';
import {
  cleanupSessionWorkspace,
  copyWorkspaceSnapshot,
  deriveWorkspaceIsolationMode,
  prepareSessionWorkspace,
  type PrepareSessionWorkspaceResult,
} from '../../core/workspace/sessionWorkspace.js';

interface SessionRouteEnv {
  Variables: {
    ctx: AppContext;
  };
}

export const sessionRoutes = new Hono<SessionRouteEnv>();
const PLAYGROUND_WORKSPACE_PREFIX = 'playground-room-';
const PLAYGROUND_WORKSPACE_ROOT = 'playground-workspaces';

const REUSE_POLICIES = new Set<SessionReusePolicy>([
  'create_new',
  'prefer_existing',
  'require_existing',
]);
const LARGE_WORKSPACE_SNAPSHOT_FILE_WARNING_THRESHOLD = 2_000;
const LARGE_WORKSPACE_SNAPSHOT_BYTE_WARNING_THRESHOLD = 50 * 1024 * 1024;

type NativeCleanupResult = boolean | 'stale_config';

interface ParsedMaintenanceRequestBody {
  reason?: string;
  hookPayloads: RuntimeSessionMaintenanceHookPayload[];
}

function buildUnavailableBranchCapabilityTruth(
  reason: string,
): SessionBranchCapabilityTruth {
  return {
    nativeFork: {
      supported: false,
      compatible: false,
      available: false,
      errorKind: 'capability_unavailable',
      reason,
    },
    contextTransplant: {
      supported: true,
    },
  };
}

function resolvePlaygroundWorkspacePath(
  sessionBaseDir: string,
  workspaceId: string,
): string {
  return join(sessionBaseDir, PLAYGROUND_WORKSPACE_ROOT, workspaceId);
}

function isValidPlaygroundWorkspaceId(workspaceId: string): boolean {
  return /^[a-z0-9-]+$/i.test(workspaceId);
}

function resolveSessionBranching(
  ctx: AppContext,
  session: SessionInfo,
  options: {
    includeCapabilities?: boolean;
  } = {},
) {
  const lineage = getSessionLineage(session);
  const transplant = getSessionContextTransplant(session);

  let capabilityTruth: SessionBranchCapabilityTruth | undefined;
  if (options.includeCapabilities !== false) {
    const runtime = getRuntimeSessionManager(ctx);
    try {
      const caps = runtime.getCapabilities(
        session.providerName,
        session.providerInstanceId,
        session.providerBackend,
      );
      capabilityTruth = buildSessionSelfBranchCapabilityTruth(session, caps);
    } catch (error) {
      capabilityTruth = buildUnavailableBranchCapabilityTruth(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return buildSessionBranchObservability({
    ...(capabilityTruth ? { capabilityTruth } : {}),
    lineage,
    transplant,
  });
}

function resolveSessionToolPolicyInspection(
  ctx: AppContext,
  session: SessionInfo,
) {
  if (session.providerBackend !== 'api' && session.providerBackend !== 'local') {
    return undefined;
  }

  const defaultTarget = getProviderDefaultTarget(ctx.config, session.providerName);
  const resolvedInstanceId = session.providerInstanceId || defaultTarget?.instance;

  try {
    const target = resolveProviderTarget(
      ctx.config,
      session.providerName,
      resolvedInstanceId ? `${session.providerBackend}/${resolvedInstanceId}` : undefined,
    );
    return buildToolPolicyInspection({
      toolProfile: target.remoteInstance?.toolProfile,
      workspaceMode: session.workspaceMode,
      permissionMode: session.permissionMode,
      allowedTools: session.allowedTools,
    });
  } catch {
    return buildToolPolicyInspection({
      workspaceMode: session.workspaceMode,
      permissionMode: session.permissionMode,
      allowedTools: session.allowedTools,
    });
  }
}

function serializeSession(ctx: AppContext, session: SessionInfo) {
  const runtime = getRuntimeSessionManager(ctx);
  const browserSessions = getRuntimeBrowserService(ctx).listSessions({
    runtimeSessionId: session.id,
  });
  const view = toSessionView(session, {
    attached: runtime.isAttached(session.id),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });
  const lineage = getSessionLineage(session);
  const branching = resolveSessionBranching(ctx, session);
  const wakeup = ctx.wakeup?.getSessionWakeState(session.id);
  const toolPolicy = resolveSessionToolPolicyInspection(ctx, session);
  const inspection = buildSessionInspection({
    session,
    view,
    trackedState: runtime.getTrackedState(session.id),
    metering: getRuntimeMeteringService(ctx).buildSessionSnapshot(session),
    wakeupPending: Boolean(wakeup?.pending),
    browserSessions,
    toolPolicy,
  });
  const strategyRequest = readRuntimeExecutionStrategyRequest(session);
  const strategyState = readRuntimeExecutionStrategyState(session);
  const providerTarget = buildSessionProviderTargetSummary(ctx, session);
  const { maintenanceState: _maintenanceState, strategy: _strategy, ...publicView } = view;
  return {
    ...publicView,
    providerTarget,
    requestedStrategy: strategyRequest?.requestedStrategy,
    acceptanceCriteria: strategyRequest?.acceptanceCriteria,
    strategyContext: strategyRequest?.strategyContext,
    correlation: strategyRequest?.correlation,
    effectiveStrategy: readRuntimeExecutionStrategyEffectiveStrategy(session),
    strategyState,
    inspection,
    branching,
    ...(wakeup ? { wakeup } : {}),
    ...(lineage ? { lineage } : {}),
  };
}

function serializeLifecycleSession(
  ctx: AppContext,
  session: SessionInfo,
  action: 'close' | 'cancel' | 'reset',
) {
  return {
    action,
    ...serializeSession(ctx, session),
  };
}

function serializeSessions(
  ctx: AppContext,
  sessions: SessionInfo[],
  options: {
    includeBranchCapabilities?: boolean;
  } = {},
) {
  const runtime = getRuntimeSessionManager(ctx);
  const metering = getRuntimeMeteringService(ctx);
  const views = toSessionViews(sessions, {
    isAttached: (session) => runtime.isAttached(session.id),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });
  return views.map((view, index) => {
    const browserSessions = getRuntimeBrowserService(ctx).listSessions({
      runtimeSessionId: sessions[index].id,
    });
    const lineage = getSessionLineage(sessions[index]);
    const branching = resolveSessionBranching(ctx, sessions[index], {
      includeCapabilities: options.includeBranchCapabilities,
    });
    const wakeup = ctx.wakeup?.getSessionWakeState(sessions[index].id);
    const toolPolicy = resolveSessionToolPolicyInspection(ctx, sessions[index]);
    const strategyRequest = readRuntimeExecutionStrategyRequest(sessions[index]);
    const strategyState = readRuntimeExecutionStrategyState(sessions[index]);
    const providerTarget = buildSessionProviderTargetSummary(ctx, sessions[index], {
      expensiveCliCapabilities: false,
    });
    const { maintenanceState: _maintenanceState, strategy: _strategy, ...publicView } = view;
    return {
      ...publicView,
      providerTarget,
      requestedStrategy: strategyRequest?.requestedStrategy,
      acceptanceCriteria: strategyRequest?.acceptanceCriteria,
      strategyContext: strategyRequest?.strategyContext,
      correlation: strategyRequest?.correlation,
      effectiveStrategy: readRuntimeExecutionStrategyEffectiveStrategy(sessions[index]),
      strategyState,
      inspection: buildSessionInspection({
        session: sessions[index],
        view,
        trackedState: runtime.getTrackedState(sessions[index].id),
        metering: metering.buildSessionSnapshot(sessions[index]),
        wakeupPending: Boolean(wakeup?.pending),
        browserSessions,
        toolPolicy,
      }),
      branching,
      ...(wakeup ? { wakeup } : {}),
      ...(lineage ? { lineage } : {}),
    };
  });
}

async function listManualDiscoverySessions(
  ctx: AppContext,
  target: ManualSessionDiscoveryTarget,
) {
  switch (target.provider) {
    case 'cursor':
      return getCursorNative(ctx, target.instanceId).listAllSessions({
        startIfNeeded: true,
      });
    case 'kiro':
      return getKiroNative(ctx, target.instanceId).listAllSessions({
        startIfNeeded: true,
      });
    case 'kilo':
      return getKiloNative(ctx, target.instanceId).listAllSessions({
        startIfNeeded: true,
      });
    case 'opencode':
      return getOpencodeNative(ctx, target.instanceId).listAllSessions({
        startIfNeeded: true,
      });
    case 'goose':
      return getGooseNative(ctx, target.instanceId).listAllSessions();
  }
}

function resolveRequestedProviderTarget(
  ctx: AppContext,
  providerName: string,
  instanceId?: string,
): ProviderTargetDescriptor {
  return resolveProviderTarget(ctx.config, providerName, instanceId);
}

function resolveCliProviderTarget(
  ctx: AppContext,
  providerName: string,
  instanceId?: string,
): ProviderTargetDescriptor {
  return resolveProviderTarget(
    ctx.config,
    providerName,
    instanceId ? `cli/${instanceId}` : undefined,
  );
}

interface ResolvedSessionModelState {
  model?: string;
  modelSelection?: ProviderModelSelection;
  modelResolution?: SessionInfo['modelResolution'];
  warnings: string[];
}

function buildSpawnOptions(input: {
  cwd: string;
  workspaceMode?: WorkspaceMode;
  model?: string;
  modelResolution?: SessionInfo['modelResolution'];
  resumeSessionId?: string;
  instructionsFile?: string;
  permissionMode?: SessionInfo['permissionMode'];
  allowedTools?: string[];
  forkSession?: boolean;
}): ProviderSpawnOptions {
  const modelControls = cloneProviderControls(input.modelResolution?.controls);
  return {
    cwd: input.cwd,
    ...(input.workspaceMode ? { workspaceMode: input.workspaceMode } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(modelControls ? { modelControls } : {}),
    ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
    ...(input.instructionsFile ? { instructionsFile: input.instructionsFile } : {}),
    ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}),
    ...(input.forkSession ? { forkSession: input.forkSession } : {}),
  };
}

function shouldRetrySessionSelectionWithoutPreset(message: string): boolean {
  return /Unknown preset '/u.test(message)
    || /Preset '.*' is not applicable to entry '/u.test(message);
}

function removePresetFromSelection(
  selection: ProviderModelSelection,
): ProviderModelSelection {
  const normalized = canonicalizeProviderModelSelection(selection);
  const { presetId: _presetId, ...withoutPreset } = normalized;
  return withoutPreset;
}

function normalizeLegacyModelForTarget(
  target: ProviderTargetDescriptor,
  legacyModel: string | undefined,
): string | undefined {
  return normalizeProviderCatalogModelId(target, legacyModel) ?? undefined;
}

function normalizeSelectionAliasesForTarget(
  target: ProviderTargetDescriptor,
  selection: ProviderModelSelection | undefined,
): ProviderModelSelection | undefined {
  if (!selection) {
    return undefined;
  }

  const normalized = canonicalizeProviderModelSelection(selection);
  const normalizedEntryId = normalizeProviderCatalogModelId(target, normalized.entryId);
  return {
    ...normalized,
    ...(normalizedEntryId ? { entryId: normalizedEntryId } : {}),
  };
}

function sessionMatchesTarget(
  session: Pick<SessionInfo, 'providerName' | 'providerBackend' | 'providerInstanceId'>,
  target: ProviderTargetDescriptor,
): boolean {
  return session.providerName === target.providerName
    && (session.providerBackend || 'cli') === target.backend
    && (session.providerInstanceId || 'default') === target.instanceId;
}

async function resolveRequestedSessionModelState(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
  input: {
    legacyModel?: string;
    selection?: ProviderModelSelection;
    enforceLegacyMatch?: boolean;
    fallbackToLegacyModelOnResolutionError?: boolean;
    preserveSelectionOnFallback?: boolean;
  },
): Promise<ResolvedSessionModelState> {
  const normalizedLegacyModel = normalizeLegacyModelForTarget(target, input.legacyModel);
  const effectiveSelection = normalizeSelectionAliasesForTarget(
    target,
    input.selection
      ?? (normalizedLegacyModel ? createLegacyModelSelection(normalizedLegacyModel) : undefined),
  );
  if (!effectiveSelection) {
    return { warnings: [] };
  }

  const knowledge = await ctx.providerModelCatalog.getAdvancedKnowledgeForTarget(target);
  const buildCompatibilityFallback = (
    legacyModel: string,
    warning: string,
  ): ResolvedSessionModelState => ({
    model: legacyModel,
    modelSelection: input.preserveSelectionOnFallback
      ? canonicalizeProviderModelSelection(input.selection ?? effectiveSelection)
      : createLegacyModelSelection(legacyModel),
    modelResolution: {
      entryId: legacyModel,
      model: legacyModel,
      entryMode: 'explicit',
      supportTier: knowledge.supportTier,
      warnings: [warning],
    },
    warnings: [warning],
  });
  let resolved;
  let compatibilityWarnings: string[] = [];
  try {
    resolved = resolveProviderSelection(knowledge, effectiveSelection);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.selection?.presetId && shouldRetrySessionSelectionWithoutPreset(message)) {
      const sanitizedSelection = removePresetFromSelection(input.selection);
      resolved = resolveProviderSelection(knowledge, sanitizedSelection);
      compatibilityWarnings = [
        `Preset '${input.selection.presetId}' is no longer available for `
        + `${target.providerName}/${target.backend}/${target.instanceId}; continuing without it.`,
      ];
    } else {
      if (
        normalizedLegacyModel
        && (
          !input.selection
          || isLegacyCompatibleExplicitSelection(
            normalizeSelectionAliasesForTarget(target, input.selection),
            normalizedLegacyModel,
          )
        )
        && /Unknown catalog entry/.test(message)
      ) {
        return buildCompatibilityFallback(
          normalizedLegacyModel,
          `Legacy model '${normalizedLegacyModel}' is not present in the advanced catalog; `
          + 'preserving it as a compatibility passthrough.',
        );
      }
      if (normalizedLegacyModel && input.fallbackToLegacyModelOnResolutionError) {
        return buildCompatibilityFallback(
          normalizedLegacyModel,
          `Structured model selection could not be resolved; preserving legacy model `
          + `'${normalizedLegacyModel}' as a compatibility fallback (${message}).`,
        );
      }
      throw error;
    }
  }

  if (
    input.enforceLegacyMatch !== false
    && normalizedLegacyModel
    && input.selection
    && normalizedLegacyModel !== resolved.resolution.model
  ) {
    throw new Error(
      `Legacy model '${normalizedLegacyModel}' does not match resolved structured selection `
      + `'${resolved.resolution.model}'`,
    );
  }

  const warnings = [...compatibilityWarnings, ...resolved.resolution.warnings];

  return {
    model: resolved.resolution.model,
    modelSelection: resolved.selection,
    modelResolution: {
      ...resolved.resolution,
      warnings,
    },
    warnings,
  };
}

async function refreshSessionModelStateForTarget(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
  session: SessionInfo,
): Promise<SessionInfo> {
  if (!session.modelSelection) {
    return session;
  }

  const refreshed = await resolveRequestedSessionModelState(ctx, target, {
    legacyModel: session.model,
    selection: session.modelSelection,
    enforceLegacyMatch: false,
    fallbackToLegacyModelOnResolutionError: true,
    preserveSelectionOnFallback: true,
  });
  ctx.registry.updateSessionMetadata(session.id, {
    model: refreshed.model,
    modelSelection: refreshed.modelSelection,
    modelResolution: refreshed.modelResolution,
  });

  return ctx.registry.get(session.id) ?? session;
}

function buildDeleteCleanupSummary(input: {
  workerDetached: boolean;
  wakeupsCleared: boolean;
  browserSessionsCleared?: number;
  workspaceCleaned: boolean;
  worktreeDetached?: boolean;
  worktreeCleanupPolicy?: WorktreeCleanupPolicy;
  worktreeMergedPaths?: number;
  managedTranscriptDeleted: boolean;
  providerDiscoveryCleared: boolean;
  providerDiscoveryDeleteMode?: RuntimeSessionLifecycleCleanupSummary['providerDiscoveryDeleteMode'];
  providerDiscoveryHydration?: RuntimeSessionLifecycleCleanupSummary['providerDiscoveryHydration'];
  registryDropped: boolean;
}): RuntimeSessionLifecycleCleanupSummary {
  return {
    workerDetached: input.workerDetached,
    wakeupsCleared: input.wakeupsCleared,
    ...(input.browserSessionsCleared !== undefined
      ? { browserSessionsCleared: input.browserSessionsCleared }
      : {}),
    workspaceCleaned: input.workspaceCleaned,
    ...(input.worktreeDetached !== undefined ? { worktreeDetached: input.worktreeDetached } : {}),
    ...(input.worktreeCleanupPolicy ? { worktreeCleanupPolicy: input.worktreeCleanupPolicy } : {}),
    ...(input.worktreeMergedPaths !== undefined ? { worktreeMergedPaths: input.worktreeMergedPaths } : {}),
    managedTranscriptDeleted: input.managedTranscriptDeleted,
    providerDiscoveryCleared: input.providerDiscoveryCleared,
    ...(input.providerDiscoveryDeleteMode
      ? { providerDiscoveryDeleteMode: input.providerDiscoveryDeleteMode }
      : {}),
    ...(input.providerDiscoveryHydration
      ? { providerDiscoveryHydration: input.providerDiscoveryHydration }
      : {}),
    registryDropped: input.registryDropped,
  };
}

async function clearBrowserSessionsForRuntimeSession(
  ctx: AppContext,
  sessionId: string,
): Promise<number> {
  return getRuntimeBrowserService(ctx).clearRuntimeSessions(sessionId);
}

async function primeCliCompatibility(
  ctx: AppContext,
  target: ProviderTargetDescriptor | undefined,
): Promise<void> {
  if (!ctx.compatibility || !target || target.backend !== 'cli' || !target.cliInstance) {
    return;
  }

  const compatibility = getProviderCompatibilityService(ctx);
  if (typeof compatibility.assessCliTarget !== 'function') {
    return;
  }

  await compatibility.assessCliTarget(target, {
    purpose: 'execution',
  });
}

function parseReusePolicy(value: unknown): SessionReusePolicy | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim() as SessionReusePolicy;
  return REUSE_POLICIES.has(normalized) ? normalized : undefined;
}

function parseWorkspaceIsolationMode(value: unknown): WorkspaceIsolationMode | undefined {
  return value === 'shared' || value === 'isolated' || value === 'worktree'
    ? value
    : undefined;
}

function parseWorkspaceKind(value: unknown): WorkspaceKind | undefined {
  return value === 'source' || value === 'sandbox' || value === 'worktree'
    ? value
    : undefined;
}

function parseWorkspaceAccess(value: unknown): WorkspaceAccess | undefined {
  return value === 'read_write' || value === 'read_only'
    ? value
    : undefined;
}

function resolveRequestedWorkspaceContract(input: {
  workspaceKind?: WorkspaceKind;
  workspaceAccess?: WorkspaceAccess;
  workspaceMode?: WorkspaceMode;
  workspaceIsolation?: WorkspaceIsolationMode;
}): {
  workspaceKind?: WorkspaceKind;
  workspaceAccess?: WorkspaceAccess;
  workspaceIsolationMode?: WorkspaceIsolationMode;
} {
  const workspaceIsolationMode = input.workspaceIsolation
    ?? (input.workspaceMode ? deriveWorkspaceIsolationMode(input.workspaceMode) : undefined);
  return {
    workspaceKind: input.workspaceKind
      ?? (workspaceIsolationMode === 'isolated'
        ? 'sandbox'
        : workspaceIsolationMode === 'worktree'
          ? 'worktree'
          : workspaceIsolationMode === 'shared'
            ? 'source'
            : undefined),
    workspaceAccess: input.workspaceAccess
      ?? (input.workspaceMode === 'read_only' ? 'read_only' : input.workspaceMode ? 'read_write' : undefined),
    workspaceIsolationMode,
  };
}

function parseWorktreeCleanupPolicy(value: unknown): WorktreeCleanupPolicy | undefined {
  return value === 'discard' || value === 'merge' || value === 'preserve'
    ? value
    : undefined;
}

function readOptionalWorktreeCleanupPolicy(
  record: Record<string, unknown>,
  key = 'worktreeCleanupPolicy',
): WorktreeCleanupPolicy | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) {
    return undefined;
  }

  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  const policy = parseWorktreeCleanupPolicy(value);
  if (!policy) {
    throw new Error(`${key} must be one of: discard, merge, preserve`);
  }

  return policy;
}

function parseMaintenanceHookPayloads(value: unknown): RuntimeSessionMaintenanceHookPayload[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const payloads: RuntimeSessionMaintenanceHookPayload[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const kind = parseOptionalString(record.kind);
    if (!kind) {
      continue;
    }

    payloads.push({
      kind,
      ...(Object.prototype.hasOwnProperty.call(record, 'payload')
        ? { payload: record.payload }
        : {}),
    });
  }

  return payloads;
}

function cloneMaintenanceHookPayloads(
  hookPayloads: RuntimeSessionMaintenanceHookPayload[] | undefined,
): RuntimeSessionMaintenanceHookPayload[] {
  return hookPayloads?.map((payload) => ({
    ...payload,
    ...(Object.prototype.hasOwnProperty.call(payload, 'payload')
      ? { payload: structuredClone(payload.payload) }
      : {}),
  })) || [];
}

function parseMaintenanceRequestBody(value: unknown): ParsedMaintenanceRequestBody | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const reason = parseOptionalString(record.reason);
  const hookPayloads = parseMaintenanceHookPayloads(record.hookPayloads);
  if (!reason && hookPayloads.length === 0) {
    return undefined;
  }

  return {
    ...(reason ? { reason } : {}),
    hookPayloads,
  };
}

function parseSessionArtifactArray(value: unknown): SessionArtifact[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const artifacts: SessionArtifact[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const id = parseOptionalString(record.id);
    if (!id) {
      continue;
    }

    artifacts.push({
      id,
      kind: parseOptionalString(record.kind),
      label: parseOptionalString(record.label),
      path: parseOptionalString(record.path),
      uri: parseOptionalString(record.uri),
      mediaType: parseOptionalString(record.mediaType),
      createdAt: parseOptionalString(record.createdAt),
      sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : undefined,
      metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : undefined,
    });
  }

  return artifacts.length > 0 ? artifacts : undefined;
}

function parseContextTransplant(value: unknown): SessionContextTransplant | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const transcriptExcerptEntries: NonNullable<SessionContextTransplant['transcriptExcerpt']> = [];
  if (Array.isArray(record.transcriptExcerpt)) {
    for (const entry of record.transcriptExcerpt) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const excerptRecord = entry as Record<string, unknown>;
      const role = excerptRecord.role === 'user' || excerptRecord.role === 'assistant'
        ? excerptRecord.role
        : undefined;
      const content = parseOptionalString(excerptRecord.content);
      if (!role || !content) {
        continue;
      }
      transcriptExcerptEntries.push({ role, content });
    }
  }

  const transplant: SessionContextTransplant = {
    summary: parseOptionalString(record.summary),
    checkpoint: parseOptionalString(record.checkpoint),
    transcriptExcerpt: transcriptExcerptEntries.length > 0 ? transcriptExcerptEntries : undefined,
    structuredBlocks: Array.isArray(record.structuredBlocks) ? record.structuredBlocks : undefined,
    artifacts: parseSessionArtifactArray(record.artifacts),
    labels: parseStringArray(record.labels),
    metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? record.metadata as Record<string, unknown>
      : undefined,
  };

  return Object.values(transplant).some((entry) => entry !== undefined)
    ? transplant
    : undefined;
}

function selectBranchTargetInstance(
  session: SessionInfo,
  requestedProviderName: string,
  requestedInstance?: string,
): string | undefined {
  if (requestedInstance) {
    return requestedInstance;
  }

  if (requestedProviderName !== session.providerName) {
    return undefined;
  }

  if (session.providerBackend && session.providerInstanceId) {
    return `${session.providerBackend}/${session.providerInstanceId}`;
  }

  return session.providerInstanceId;
}

function serializeLineageRelation(
  session: SessionInfo,
  relativeToSessionId: string,
) {
  const lineage = getSessionLineage(session);
  const relativeIndex = lineage?.chain.findIndex((entry) => entry.sessionId === relativeToSessionId) ?? -1;
  return {
    id: session.id,
    providerName: session.providerName,
    status: session.status,
    parentSessionId: lineage?.parentSessionId,
    rootSessionId: lineage?.rootSessionId ?? session.id,
    branchMode: lineage?.branchMode,
    createdAt: lineage?.createdAt ?? session.createdAt,
    depth: lineage?.depth ?? 0,
    relativeDepth: relativeIndex >= 0
      ? lineage!.chain.length - 1 - relativeIndex
      : 0,
  };
}

function sortSessionsByTimestamp(sessions: SessionInfo[]): SessionInfo[] {
  return [...sessions].sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
}

function parseIncludeBranchCapabilities(value: string | undefined): boolean {
  return value === 'full';
}

function findReusableSession(
  ctx: AppContext,
  providerTarget: ProviderTargetDescriptor,
  providerName: string,
  sessionKey: string,
): SessionInfo | undefined {
  return ctx.registry.list({ provider: providerName }).find((session) =>
    session.sessionKey === sessionKey
      && session.providerBackend === providerTarget.backend
      && session.providerInstanceId === providerTarget.instanceId,
  );
}

function resolveCliProviderInstance(target: ProviderTargetDescriptor): ProviderInstanceConfig {
  if (!target.cliInstance) {
    throw new Error(
      `Provider '${target.providerName}' target '${target.backend}/${target.instanceId}' `
      + 'does not resolve to a CLI instance',
    );
  }

  return target.cliInstance;
}

function getSessionWorkspaceSourceCwd(
  session: Pick<SessionInfo, 'cwd' | 'hydration'>
    & Partial<Pick<SessionInfo, 'workspace' | 'workspaceMode' | 'workspaceIsolation'>>,
): string | undefined {
  const workspaceKind = resolveSessionWorkspaceKind(session);
  return session.workspace?.sourceCwd
    ?? session.workspaceIsolation?.sourceCwd
    ?? session.hydration?.workspace.sourceCwd
    ?? (workspaceKind === 'sandbox' ? undefined : session.cwd);
}

function resolveForkWorkspaceSourceCwd(
  session: Pick<SessionInfo, 'cwd' | 'hydration'>
    & Partial<Pick<SessionInfo, 'workspace' | 'workspaceMode' | 'workspaceIsolation'>>,
  requestedCwd: string | undefined,
  forkCwd: string,
  forkWorkspaceKind: WorkspaceKind | undefined,
): string | undefined {
  if (forkWorkspaceKind === 'sandbox') {
    return requestedCwd ?? getSessionWorkspaceSourceCwd(session);
  }

  return requestedCwd ?? getSessionWorkspaceSourceCwd(session) ?? forkCwd;
}

function buildMaintenanceRequest(
  session: Pick<SessionInfo, 'id' | 'cwd' | 'hydration'>
    & Partial<Pick<SessionInfo, 'workspace' | 'workspaceMode' | 'workspaceIsolation'>>,
  action: RuntimeSessionMaintenanceAction,
  requestBody?: ParsedMaintenanceRequestBody,
  worktreeDisposition?: WorktreeCleanupPolicy,
): RuntimeSessionMaintenanceRequest {
  const isolationMode = resolveSessionWorkspaceIsolationMode(session);
  const sourceCwd = getSessionWorkspaceSourceCwd(session);
  const worktreePath = session.workspace?.kind === 'worktree'
    ? session.workspace.worktree?.worktreePath
    : session.workspaceIsolation?.mode === 'worktree'
      ? session.workspaceIsolation.worktree?.worktreePath
      : undefined;
  const workspaceKind = resolveSessionWorkspaceKind(session);
  const workspaceAccess = resolveSessionWorkspaceAccess(session);

  return {
    action,
    sessionId: session.id,
    requestedAt: new Date().toISOString(),
    workspaceKind,
    workspaceAccess,
    workspaceMode: session.workspaceMode ?? 'shared',
    isolationMode,
    runtimeCwd: session.workspace?.runtimeCwd ?? session.cwd,
    ...(sourceCwd ? { sourceCwd } : {}),
    ...(worktreePath ? { worktreePath } : {}),
    ...(requestBody?.reason ? { reason: requestBody.reason } : {}),
    ...(worktreeDisposition ? { worktreeDisposition } : {}),
    hookPayloads: cloneMaintenanceHookPayloads(requestBody?.hookPayloads),
  };
}

function mergeStructuredMetadata(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!left && !right) {
    return undefined;
  }
  return {
    ...(left ? structuredClone(left) : {}),
    ...(right ? structuredClone(right) : {}),
  };
}

function buildWorkspaceSnapshotMetadata(
  snapshot: Awaited<ReturnType<typeof copyWorkspaceSnapshot>>,
): Record<string, unknown> {
  const warningCodes: string[] = [];
  if (snapshot.copiedFileCount >= LARGE_WORKSPACE_SNAPSHOT_FILE_WARNING_THRESHOLD) {
    warningCodes.push('large_file_count');
  }
  if (snapshot.copiedByteCount >= LARGE_WORKSPACE_SNAPSHOT_BYTE_WARNING_THRESHOLD) {
    warningCodes.push('large_byte_count');
  }

  return {
    workspaceSnapshot: {
      copiedFileCount: snapshot.copiedFileCount,
      copiedByteCount: snapshot.copiedByteCount,
      skippedGitMetadata: snapshot.skippedGitMetadata,
      status: warningCodes.length > 0 ? 'large' : 'captured',
      plan: {
        strategy: 'one_shot_snapshot',
        boundedSyncAvailable: false,
        readiness: warningCodes.length > 0 ? 'follow_up_required' : 'snapshot_ok',
        nextAction: warningCodes.length > 0 ? 'prefer_shared_or_worktree' : 'none',
        thresholds: {
          fileWarningCount: LARGE_WORKSPACE_SNAPSHOT_FILE_WARNING_THRESHOLD,
          byteWarningCount: LARGE_WORKSPACE_SNAPSHOT_BYTE_WARNING_THRESHOLD,
        },
      },
      ...(warningCodes.length > 0 ? { warningCodes } : {}),
    },
  };
}

function describeWorkspaceSnapshotWarning(
  snapshot: Awaited<ReturnType<typeof copyWorkspaceSnapshot>>,
): string | undefined {
  const warningCodes: string[] = [];
  if (snapshot.copiedFileCount >= LARGE_WORKSPACE_SNAPSHOT_FILE_WARNING_THRESHOLD) {
    warningCodes.push(`${snapshot.copiedFileCount} files`);
  }
  if (snapshot.copiedByteCount >= LARGE_WORKSPACE_SNAPSHOT_BYTE_WARNING_THRESHOLD) {
    const sizeMb = Math.round((snapshot.copiedByteCount / (1024 * 1024)) * 10) / 10;
    warningCodes.push(`${sizeMb} MB`);
  }
  if (warningCodes.length === 0) {
    return undefined;
  }

  return `Fork workspace snapshot copied a large workspace (${warningCodes.join(', ')}). `
    + 'Use shared/worktree isolation or a future bounded sync path for very large repos.';
}

function buildMaintenanceFollowThrough(
  session: Pick<SessionInfo, 'id'>,
  action: RuntimeSessionMaintenanceAction,
  phase: 'pre_reset' | 'pre_compaction' | 'pre_flush',
  outcome: RuntimeSessionMaintenanceFollowThroughOutcome,
  requestBody?: ParsedMaintenanceRequestBody,
): Parameters<ReturnType<typeof getRuntimeSessionManager>['recordMaintenanceFollowThrough']>[0] {
  return {
    action,
    phase,
    sessionId: session.id,
    observedAt: new Date().toISOString(),
    outcome,
    ...(requestBody?.reason ? { reason: requestBody.reason } : {}),
    hookPayloads: cloneMaintenanceHookPayloads(requestBody?.hookPayloads),
  };
}

function persistTrackedMaintenanceState(ctx: AppContext, sessionId: string): void {
  const maintenanceState = getRuntimeSessionManager(ctx).getTrackedState(sessionId)?.maintenance;
  if (!maintenanceState) {
    return;
  }

  ctx.registry.updateSessionMetadata(sessionId, {
    maintenanceState,
  });
}

function recordSessionMaintenanceRequest(
  ctx: AppContext,
  session: Pick<SessionInfo, 'id' | 'cwd' | 'workspaceMode' | 'workspaceIsolation' | 'hydration'>,
  action: RuntimeSessionMaintenanceAction,
  requestBody?: ParsedMaintenanceRequestBody,
  worktreeDisposition?: WorktreeCleanupPolicy,
): RuntimeSessionMaintenanceRequest {
  const request = buildMaintenanceRequest(session, action, requestBody, worktreeDisposition);
  const recorded = getRuntimeSessionManager(ctx).recordMaintenanceRequest(request);
  persistTrackedMaintenanceState(ctx, session.id);
  return recorded;
}

function recordSessionMaintenanceFollowThrough(
  ctx: AppContext,
  session: Pick<SessionInfo, 'id'>,
  action: RuntimeSessionMaintenanceAction,
  phase: 'pre_reset' | 'pre_compaction' | 'pre_flush',
  outcome: RuntimeSessionMaintenanceFollowThroughOutcome,
  requestBody?: ParsedMaintenanceRequestBody,
) {
  const followThrough = buildMaintenanceFollowThrough(
    session,
    action,
    phase,
    outcome,
    requestBody,
  );
  const recorded = getRuntimeSessionManager(ctx).recordMaintenanceFollowThrough(followThrough);
  persistTrackedMaintenanceState(ctx, session.id);
  return recorded;
}

function recordSessionLifecycle(
  ctx: AppContext,
  sessionId: string,
  input: Parameters<ReturnType<typeof getRuntimeSessionManager>['recordLifecycle']>[1],
) {
  const lifecycle = getRuntimeSessionManager(ctx).recordLifecycle(sessionId, input);
  persistTrackedMaintenanceState(ctx, sessionId);
  return lifecycle;
}

function recordSessionCompaction(
  ctx: AppContext,
  sessionId: string,
  record: Parameters<ReturnType<typeof getRuntimeSessionManager>['recordCompaction']>[1],
) {
  const compaction = getRuntimeSessionManager(ctx).recordCompaction(sessionId, record);
  persistTrackedMaintenanceState(ctx, sessionId);
  return compaction;
}

async function hydrateSessionForTarget(
  ctx: AppContext,
  options: {
    trigger: 'create' | 'resume' | 'fork' | 'message';
    sessionId: string;
    providerTarget: ProviderTargetDescriptor;
    cwd: string;
    workspace?: SessionWorkspaceState;
    workspaceMode?: WorkspaceMode;
    workspaceIsolationMode?: WorkspaceIsolationMode;
    requestedSkills?: ReturnType<typeof parseRuntimeSkillManifest>['manifest'];
    existingSkills?: SessionInfo['skills'];
    existingHydration?: SessionInfo['hydration'];
    workspaceSourceCwd?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return hydrateSessionState({
    trigger: options.trigger,
    sessionId: options.sessionId,
    providerName: options.providerTarget.providerName,
    providerBackend: options.providerTarget.backend,
    runtimeCwd: options.cwd,
    workspace: options.workspace,
    workspaceMode: options.workspaceMode,
    workspaceIsolationMode: options.workspaceIsolationMode,
    sessionBaseDir: ctx.config.sessionBaseDir,
    requestedSkills: options.requestedSkills,
    existingSkills: options.existingSkills,
    requestedWorkspaceSourceCwd: options.workspaceSourceCwd,
    existingHydration: options.existingHydration,
    baseInstructionsFile: options.providerTarget.cliInstance?.piInstructionsFile,
    metadata: options.metadata,
  });
}

async function rehydratePersistedSessionState(
  ctx: AppContext,
  session: SessionInfo,
): Promise<SessionInfo> {
  const providerTarget = resolveSessionProviderTarget(ctx.config, session);
  const hydrated = await hydrateSessionForTarget(ctx, {
    trigger: 'resume',
    sessionId: session.id,
    providerTarget,
    cwd: session.cwd,
    workspace: session.workspace,
    workspaceMode: session.workspaceMode,
    workspaceIsolationMode: resolveSessionWorkspaceIsolationMode(session),
    existingSkills: session.skills,
    existingHydration: session.hydration,
    workspaceSourceCwd: getSessionWorkspaceSourceCwd(session),
  });

  ctx.registry.updateSessionMetadata(session.id, {
    skills: hydrated.skills,
    hydration: hydrated.hydration,
  });
  return ctx.registry.get(session.id) ?? session;
}

function resolveSessionWorkspaceIsolationMode(
  session: Partial<Pick<SessionInfo, 'workspace' | 'workspaceIsolation' | 'workspaceMode'>>,
): WorkspaceIsolationMode {
  return session.workspaceIsolation?.mode
    ?? (session.workspace?.kind === 'sandbox'
      ? 'isolated'
      : session.workspace?.kind === 'worktree'
        ? 'worktree'
        : session.workspace?.kind === 'source'
          ? 'shared'
          : deriveWorkspaceIsolationMode(session.workspaceMode));
}

function resolveSessionWorkspaceKind(
  session: Partial<Pick<SessionInfo, 'workspace' | 'workspaceIsolation' | 'workspaceMode'>>,
): WorkspaceKind {
  return session.workspace?.kind
    ?? (resolveSessionWorkspaceIsolationMode(session) === 'isolated'
      ? 'sandbox'
      : resolveSessionWorkspaceIsolationMode(session) === 'worktree'
        ? 'worktree'
        : 'source');
}

function resolveSessionWorkspaceAccess(
  session: Partial<Pick<SessionInfo, 'workspace' | 'workspaceMode'>>,
): WorkspaceAccess {
  return session.workspace?.access
    ?? ((session.workspaceMode ?? 'shared') === 'read_only' ? 'read_only' : 'read_write');
}

async function prepareWorkspaceCleanupState(
  session: Pick<SessionInfo, 'id' | 'workspace' | 'workspaceMode' | 'workspaceIsolation'>,
  worktreeCleanupPolicy: WorktreeCleanupPolicy | undefined,
  ctx: AppContext,
) {
  return cleanupSessionWorkspace({
    sessionId: session.id,
    sessionBaseDir: ctx.config.sessionBaseDir,
    workspace: session.workspace,
    workspaceMode: session.workspaceMode,
    workspaceIsolation: session.workspaceIsolation,
    worktreeCleanupPolicy,
  });
}

class RetainedWorktreeCleanupHydrationError extends Error {
  constructor(
    message: string,
    readonly cleanup: Awaited<ReturnType<typeof cleanupSessionWorkspace>>,
  ) {
    super(message);
    this.name = 'RetainedWorktreeCleanupHydrationError';
  }
}

export async function executeRetainedWorktreeCleanup(
  ctx: AppContext,
  session: SessionInfo,
  options: {
    worktreeCleanupPolicy?: WorktreeCleanupPolicy;
    rehydratePersistedState?: boolean;
  } = {},
): Promise<{
    cleanup: Awaited<ReturnType<typeof cleanupSessionWorkspace>>;
    sessionAfterCleanup: SessionInfo;
    settledReset?: Awaited<ReturnType<typeof settleRetainedResetAfterCleanup>>;
    settledDelete?: Awaited<ReturnType<typeof settleRetainedDeleteAfterCleanup>>;
  }> {
  const cleanup = await prepareWorkspaceCleanupState(
    session,
    options.worktreeCleanupPolicy,
    ctx,
  );
  let sessionAfterCleanup = persistWorkspaceCleanupState(ctx, session.id, cleanup) ?? session;
  if (
    options.rehydratePersistedState !== false
    && (cleanup.nextCwd !== undefined || cleanup.nextWorkspaceIsolation !== undefined)
  ) {
    try {
      sessionAfterCleanup = await rehydratePersistedSessionState(ctx, sessionAfterCleanup);
    } catch (error) {
      throw new RetainedWorktreeCleanupHydrationError(
        `Retained worktree cleanup changed workspace state but failed to refresh hydration: ${error}`,
        cleanup,
      );
    }
  }

  const settledReset = cleanup.status === 'completed'
    ? await settleRetainedResetAfterCleanup(ctx, sessionAfterCleanup, cleanup)
    : undefined;
  const settledDelete = cleanup.status === 'completed'
    ? await settleRetainedDeleteAfterCleanup(ctx, sessionAfterCleanup, cleanup)
    : undefined;

  return {
    cleanup,
    sessionAfterCleanup,
    ...(settledReset ? { settledReset } : {}),
    ...(settledDelete ? { settledDelete } : {}),
  };
}

async function discardPreparedWorkspace(
  ctx: AppContext,
  session: Pick<SessionInfo, 'id' | 'workspace' | 'workspaceMode' | 'workspaceIsolation'>,
): Promise<void> {
  await cleanupSessionWorkspace({
    sessionId: session.id,
    sessionBaseDir: ctx.config.sessionBaseDir,
    workspace: session.workspace,
    workspaceMode: session.workspaceMode,
    workspaceIsolation: session.workspaceIsolation,
    worktreeCleanupPolicy: 'discard',
  });
}

function persistWorkspaceCleanupState(
  ctx: AppContext,
  sessionId: string,
  cleanup: Awaited<ReturnType<typeof cleanupSessionWorkspace>>,
): SessionInfo | undefined {
  if (
    cleanup.nextCwd === undefined
    && cleanup.nextWorkspace === undefined
    && cleanup.nextWorkspaceIsolation === undefined
  ) {
    return ctx.registry.get(sessionId);
  }

  const updated = ctx.registry.updateWorkspace(sessionId, {
    ...(cleanup.nextCwd !== undefined ? { cwd: cleanup.nextCwd } : {}),
    ...(cleanup.nextWorkspace !== undefined ? { workspace: cleanup.nextWorkspace } : {}),
    ...(cleanup.nextWorkspaceIsolation !== undefined
      ? { workspaceIsolation: cleanup.nextWorkspaceIsolation }
      : {}),
  });
  if (!updated) {
    return undefined;
  }
  return ctx.registry.get(sessionId);
}

async function settleRetainedResetAfterCleanup(
  ctx: AppContext,
  session: SessionInfo,
  cleanup: Awaited<ReturnType<typeof cleanupSessionWorkspace>>,
): Promise<{
    lifecycle: ReturnType<typeof recordSessionLifecycle>;
    maintenance: ReturnType<typeof serializeSession>['inspection']['maintenance'];
    session: ReturnType<typeof serializeSession>;
  } | undefined> {
  const lastLifecycle = session.maintenanceState?.lastLifecycle;
  if (!lastLifecycle || lastLifecycle.action !== 'reset' || lastLifecycle.status !== 'retained') {
    return undefined;
  }

  const runtime = getRuntimeSessionManager(ctx);
  const id = session.id;
  const browserSessionsCleared = await clearBrowserSessionsForRuntimeSession(ctx, id);
  ctx.registry.clearProviderResumeState(id);
  ctx.registry.setProviderState(id, undefined);
  ctx.registry.updateSessionMetadata(id, { hydration: undefined });
  runtime.clearProviderState(id);
  runtime.markClosed(id);
  const wakeupResult = ctx.wakeup?.clearSession(id);
  const lifecycle = recordSessionLifecycle(ctx, id, {
    action: 'reset',
    boundary: 'hard_reset',
    status: 'completed',
    reasonCodes: ['manual_reset', 'retained_cleanup_completed'],
    cleanup: {
      workerDetached: !runtime.isAttached(id),
      providerResumeCleared: true,
      providerStateCleared: true,
      wakeupsCleared: (wakeupResult?.removedCount ?? 0) > 0,
      browserSessionsCleared,
      workspaceCleaned: cleanup.workspaceCleaned,
      ...(cleanup.worktreeDetached !== undefined ? { worktreeDetached: cleanup.worktreeDetached } : {}),
      ...(cleanup.policy ? { worktreeCleanupPolicy: cleanup.policy } : {}),
      worktreeMergedPaths: cleanup.mergedPathCount,
    },
    clearExecutionState: true,
  });
  const serialized = serializeSession(ctx, ctx.registry.get(id) ?? session);
  return {
    lifecycle,
    maintenance: serialized.inspection.maintenance,
    session: serialized,
  };
}

async function finalizeDeleteAfterWorkspaceCleanup(
  ctx: AppContext,
  session: SessionInfo,
  input: {
    workspaceCleaned: boolean;
    worktreeDetached?: boolean;
    resolvedCleanupPolicy?: WorktreeCleanupPolicy;
    worktreeMergedPaths?: number;
  },
): Promise<{
    status: 'deleted' | 'retained';
    hadTranscript: boolean;
    fileDeleted: boolean;
    nativeDeleted: boolean;
    maintenance: ReturnType<typeof recordSessionLifecycle>;
    session?: ReturnType<typeof serializeSession>;
    reason?: string;
  }> {
  const runtime = getRuntimeSessionManager(ctx);
  const id = session.id;
  const hasNativeSessionState = tracksNativeSessionState(session);
  const hasProviderDiscoveryState = tracksProviderDiscoveryState(session);
  const workerDetached = !runtime.isAttached(id);
  const providerDiscoveryHydration = hasProviderDiscoveryState
    ? await hydrateProviderDiscoverySourcePathForDelete(ctx, session)
    : undefined;

  const preparedManagedTranscripts = ctx.registry.prepareManagedTranscriptDeletion(id);
  const preparedProviderDiscovery = prepareProviderDiscoveryDeletion(ctx, session);
  const providerDiscoveryDeleteMode = hasProviderDiscoveryState
    ? (preparedProviderDiscovery.hadFiles ? 'full' : 'registry_only')
    : undefined;
  const hadTranscript = preparedManagedTranscripts.hadFiles
    || preparedProviderDiscovery.hadFiles
    || hasNativeSessionState
    || hasProviderDiscoveryState;

  if (!preparedManagedTranscripts.ready || !preparedProviderDiscovery.ready) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    const maintenance = recordSessionLifecycle(ctx, id, {
      action: 'delete',
      boundary: 'permanent_delete',
      status: 'retained',
      reasonCodes: ['cleanup_staging_failed'],
      cleanup: {
        workerDetached,
        workspaceCleaned: input.workspaceCleaned,
        ...(input.worktreeDetached !== undefined ? { worktreeDetached: input.worktreeDetached } : {}),
        ...(input.resolvedCleanupPolicy
          ? { worktreeCleanupPolicy: input.resolvedCleanupPolicy }
          : {}),
        ...(input.worktreeMergedPaths !== undefined
          ? { worktreeMergedPaths: input.worktreeMergedPaths }
          : {}),
        ...(providerDiscoveryDeleteMode ? { providerDiscoveryDeleteMode } : {}),
        ...(providerDiscoveryHydration ? { providerDiscoveryHydration } : {}),
      },
    });
    return {
      status: 'retained',
      hadTranscript,
      fileDeleted: false,
      nativeDeleted: false,
      reason: 'Session files are locked or in use. Nothing was removed.',
      maintenance,
      session: serializeSession(ctx, ctx.registry.get(id) ?? session),
    };
  }

  let nativeDeleted: NativeCleanupResult = false;
  try {
    if (hasNativeSessionState) {
      nativeDeleted = await deleteNativeSessionState(ctx, session);
    }
  } catch (error) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    throw new Error(`Failed to delete native ${session.providerName} session: ${error}`);
  }

  let providerDiscoveryDeleted = false;
  try {
    if (hasProviderDiscoveryState) {
      providerDiscoveryDeleted = await verifyProviderDiscoveryStateDeleted(ctx, session);
    }
  } catch (error) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    throw new Error(`Failed to verify ${session.providerName} discovery cleanup: ${error}`);
  }

  const nativeCleanupSucceeded = !hasNativeSessionState
    || nativeDeleted === true
    || nativeDeleted === 'stale_config';
  const providerDiscoveryCleanupSucceeded = !hasProviderDiscoveryState || providerDiscoveryDeleted;
  if (!nativeCleanupSucceeded || !providerDiscoveryCleanupSucceeded) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    const maintenance = recordSessionLifecycle(ctx, id, {
      action: 'delete',
      boundary: 'permanent_delete',
      status: 'retained',
      reasonCodes: ['cleanup_verification_failed'],
      cleanup: {
        workerDetached,
        workspaceCleaned: input.workspaceCleaned,
        ...(input.worktreeDetached !== undefined ? { worktreeDetached: input.worktreeDetached } : {}),
        ...(input.resolvedCleanupPolicy
          ? { worktreeCleanupPolicy: input.resolvedCleanupPolicy }
          : {}),
        ...(input.worktreeMergedPaths !== undefined
          ? { worktreeMergedPaths: input.worktreeMergedPaths }
          : {}),
        ...(providerDiscoveryDeleteMode ? { providerDiscoveryDeleteMode } : {}),
        ...(providerDiscoveryHydration ? { providerDiscoveryHydration } : {}),
      },
    });
    return {
      status: 'retained',
      hadTranscript,
      fileDeleted: false,
      nativeDeleted: false,
      reason: 'Session cleanup could not be verified. Nothing was removed.',
      maintenance,
      session: serializeSession(ctx, ctx.registry.get(id) ?? session),
    };
  }

  const worker = runtime.get(id);
  if (worker?.active) {
    try {
      await runtime.close(session, 'delete');
      ctx.registry.updateStatus(id, 'closed');
    } catch (error) {
      preparedManagedTranscripts.rollback();
      preparedProviderDiscovery.rollback();
      throw new Error(`Failed to close session before delete: ${error}`);
    }
  }

  let browserSessionsCleared = 0;
  try {
    browserSessionsCleared = await clearBrowserSessionsForRuntimeSession(ctx, id);
  } catch (error) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    throw new Error(`Failed to clear browser sessions before delete: ${error}`);
  }

  const managedDeletion = preparedManagedTranscripts.finalize();
  const providerDeletion = preparedProviderDiscovery.finalize();
  const wakeupResult = ctx.wakeup?.clearSession(id);
  const maintenance = recordSessionLifecycle(ctx, id, {
    action: 'delete',
    boundary: 'permanent_delete',
    status: 'completed',
    reasonCodes: ['session_deleted'],
    cleanup: buildDeleteCleanupSummary({
      workerDetached: !runtime.isAttached(id),
      wakeupsCleared: (wakeupResult?.removedCount ?? 0) > 0,
      browserSessionsCleared,
      workspaceCleaned: input.workspaceCleaned,
      ...(input.worktreeDetached !== undefined ? { worktreeDetached: input.worktreeDetached } : {}),
      ...(input.resolvedCleanupPolicy
        ? { worktreeCleanupPolicy: input.resolvedCleanupPolicy }
        : {}),
      ...(input.worktreeMergedPaths !== undefined
        ? { worktreeMergedPaths: input.worktreeMergedPaths }
        : {}),
      managedTranscriptDeleted: managedDeletion.fileDeleted,
      providerDiscoveryCleared: providerDeletion.fileDeleted,
      ...(providerDiscoveryDeleteMode ? { providerDiscoveryDeleteMode } : {}),
      ...(providerDiscoveryHydration ? { providerDiscoveryHydration } : {}),
      registryDropped: true,
    }),
    clearExecutionState: true,
  });
  ctx.registry.unregister(id);
  runtime.dropSession(id);
  ctx.registry.flush();

  return {
    status: 'deleted',
    hadTranscript,
    fileDeleted: managedDeletion.fileDeleted || providerDeletion.fileDeleted,
    nativeDeleted: hasNativeSessionState ? nativeDeleted === true : false,
    maintenance,
  };
}

async function settleRetainedDeleteAfterCleanup(
  ctx: AppContext,
  session: SessionInfo,
  cleanup: Awaited<ReturnType<typeof cleanupSessionWorkspace>>,
): Promise<Awaited<ReturnType<typeof finalizeDeleteAfterWorkspaceCleanup>> | undefined> {
  const lastLifecycle = session.maintenanceState?.lastLifecycle;
  if (!lastLifecycle || lastLifecycle.action !== 'delete' || lastLifecycle.status !== 'retained') {
    return undefined;
  }

  return finalizeDeleteAfterWorkspaceCleanup(ctx, session, {
    workspaceCleaned: cleanup.workspaceCleaned,
    worktreeDetached: cleanup.worktreeDetached,
    resolvedCleanupPolicy: cleanup.policy,
    worktreeMergedPaths: cleanup.mergedPathCount,
  });
}

function describeRetainedWorktreeCleanup(
  cleanup: Awaited<ReturnType<typeof cleanupSessionWorkspace>>,
): string {
  if (cleanup.reasonCodes.includes('worktree_preserved')) {
    return 'Worktree cleanup was intentionally preserved for manual handling. Session state was kept for retry.';
  }

  return 'Worktree cleanup could not be completed. Session state was kept for retry.';
}

function buildWorkspaceCleanupPath(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}/workspace/cleanup`;
}

function resolveCompactionRequestStatus(
  maintenance: ReturnType<typeof buildSessionInspection>['maintenance'],
  acknowledgeHooks: boolean,
): {
  status: 'not_ready' | 'deferred' | 'pending_hooks' | 'ready_for_external_compaction';
  reasonCodes: string[];
  hookStatus: 'none' | 'pending' | 'acknowledged' | 'completed';
} {
  const hookGate = resolveMaintenanceHookGate(
    maintenance,
    'compact',
    'pre_compaction',
    acknowledgeHooks,
  );

  if (maintenance.compaction.status === 'not_ready') {
    return {
      status: 'not_ready',
      reasonCodes: [...maintenance.compaction.reasonCodes],
      hookStatus: 'none',
    };
  }

  if (maintenance.compaction.status === 'recommended') {
    return {
      status: 'deferred',
      reasonCodes: [...maintenance.compaction.reasonCodes],
      hookStatus: hookGate.hookStatus,
    };
  }

  if (hookGate.hooksPending && !hookGate.hooksAcknowledged) {
    return {
      status: 'pending_hooks',
      reasonCodes: [...hookGate.reasonCodes, ...maintenance.compaction.reasonCodes],
      hookStatus: hookGate.hookStatus,
    };
  }

  return {
    status: 'ready_for_external_compaction',
    reasonCodes: [...maintenance.compaction.reasonCodes],
    hookStatus: hookGate.hookStatus,
  };
}

function parseCompactionFollowThroughOutcome(
  value: unknown,
): RuntimeSessionMaintenanceFollowThroughOutcome | undefined {
  return value === 'acknowledged' || value === 'retry_requested' || value === 'completed'
    ? value
    : undefined;
}

function parseMaintenanceFollowThroughAction(
  value: unknown,
): 'reset' | 'delete' | 'cleanup_workspace' | 'compact' | undefined {
  return value === 'reset'
    || value === 'delete'
    || value === 'cleanup_workspace'
    || value === 'compact'
    ? value
    : undefined;
}

function parseMaintenanceFollowThroughPhase(
  value: unknown,
): 'pre_reset' | 'pre_compaction' | 'pre_flush' | undefined {
  return value === 'pre_reset' || value === 'pre_compaction' || value === 'pre_flush'
    ? value
    : undefined;
}

function supportsMaintenanceFollowThrough(
  action: 'reset' | 'delete' | 'cleanup_workspace' | 'compact',
  phase: 'pre_reset' | 'pre_compaction' | 'pre_flush',
): boolean {
  switch (action) {
    case 'reset':
      return phase === 'pre_reset';
    case 'delete':
    case 'cleanup_workspace':
      return phase === 'pre_flush';
    case 'compact':
      return phase === 'pre_compaction';
    default:
      return false;
  }
}

function getPendingMaintenanceHooks(
  maintenance: ReturnType<typeof buildSessionInspection>['maintenance'],
  phase: 'pre_reset' | 'pre_compaction' | 'pre_flush',
) {
  switch (phase) {
    case 'pre_reset':
      return maintenance.hooks.preReset.pending;
    case 'pre_flush':
      return maintenance.hooks.preFlush.pending;
    case 'pre_compaction':
    default:
      return maintenance.hooks.preCompaction.pending;
  }
}

function getMaintenanceFollowThrough(
  maintenance: ReturnType<typeof buildSessionInspection>['maintenance'],
  action: 'reset' | 'delete' | 'cleanup_workspace' | 'compact',
  phase: 'pre_reset' | 'pre_compaction' | 'pre_flush',
) {
  const history = maintenance.followThroughHistory?.length
    ? maintenance.followThroughHistory
    : maintenance.lastFollowThrough
      ? [maintenance.lastFollowThrough]
      : [];
  let latest: (typeof history)[number] | undefined;
  for (const followThrough of history) {
    if (followThrough.action !== action || followThrough.phase !== phase) {
      continue;
    }
    if (!latest || followThrough.observedAt > latest.observedAt) {
      latest = followThrough;
    }
  }
  return latest;
}

function resolveMaintenanceHookGate(
  maintenance: ReturnType<typeof buildSessionInspection>['maintenance'],
  action: 'reset' | 'delete' | 'cleanup_workspace' | 'compact',
  phase: 'pre_reset' | 'pre_compaction' | 'pre_flush',
  acknowledgeHooks = false,
): {
  hooksPending: boolean;
  hooksAcknowledged: boolean;
  hookStatus: 'none' | 'pending' | 'acknowledged' | 'completed';
  reasonCodes: string[];
} {
  const followThrough = getMaintenanceFollowThrough(maintenance, action, phase);
  const hooksPending = getPendingMaintenanceHooks(maintenance, phase).length > 0;
  const hooksAcknowledged = acknowledgeHooks
    || followThrough?.outcome === 'acknowledged'
    || followThrough?.outcome === 'completed';
  const hookStatus: 'none' | 'pending' | 'acknowledged' | 'completed' = !hooksPending
    ? 'none'
    : followThrough?.outcome === 'completed'
      ? 'completed'
      : hooksAcknowledged
        ? 'acknowledged'
        : 'pending';

  return {
    hooksPending,
    hooksAcknowledged,
    hookStatus,
    reasonCodes: hooksPending && !hooksAcknowledged ? [`${phase}_hooks_pending`] : [],
  };
}

function buildMaintenanceHookConflict(
  action: 'reset' | 'delete' | 'cleanup_workspace' | 'compact',
  phase: 'pre_reset' | 'pre_compaction' | 'pre_flush',
  serialized: ReturnType<typeof serializeSession>,
  hookGate: ReturnType<typeof resolveMaintenanceHookGate>,
) {
  return {
    error: `This session still has pending ${phase} hooks for action '${action}'.`,
    action,
    phase,
    status: 'pending_hooks' as const,
    hookStatus: hookGate.hookStatus,
    reasonCodes: [...hookGate.reasonCodes],
    maintenance: serialized.inspection.maintenance,
    session: serialized,
  };
}

function applyPreparedWorkspace(
  ctx: AppContext,
  sessionId: string,
  prepared: PrepareSessionWorkspaceResult,
): SessionInfo | undefined {
  const updated = ctx.registry.updateWorkspace(sessionId, {
    cwd: prepared.cwd,
    workspace: prepared.workspace,
    workspaceMode: prepared.workspaceMode,
    workspaceIsolation: prepared.workspaceIsolation,
    permissionMode: prepared.permissionMode,
  });
  if (!updated) {
    return undefined;
  }
  return ctx.registry.get(sessionId);
}

async function ensureSessionWorkspacePrepared(
  ctx: AppContext,
  session: SessionInfo,
): Promise<SessionInfo> {
  const isolationMode = resolveSessionWorkspaceIsolationMode(session);
  if (isolationMode !== 'worktree') {
    return session;
  }

  const worktreePath = session.workspaceIsolation?.worktree?.worktreePath;
  if (worktreePath && existsSync(worktreePath)) {
    return session;
  }

  const prepared = await prepareSessionWorkspace({
    sessionId: session.id,
    sessionBaseDir: ctx.config.sessionBaseDir,
    cwd: getSessionWorkspaceSourceCwd(session),
    workspaceKind: 'worktree',
    workspaceAccess: resolveSessionWorkspaceAccess(session),
    workspaceMode: session.workspaceMode,
    workspaceIsolationMode: 'worktree',
    permissionMode: session.permissionMode,
  });
  const updatedSession = applyPreparedWorkspace(ctx, session.id, prepared);
  if (updatedSession) {
    return updatedSession;
  }

  await discardPreparedWorkspace(ctx, {
    id: session.id,
    workspace: prepared.workspace,
    workspaceMode: prepared.workspaceMode,
    workspaceIsolation: prepared.workspaceIsolation,
  });
  throw new Error(`Session '${session.id}' disappeared while applying prepared workspace state.`);
}

function sessionMatchesInstanceFilter(
  ctx: AppContext,
  session: SessionInfo,
  requestedInstance: string,
): boolean {
  const defaultTarget = getProviderDefaultTarget(ctx.config, session.providerName);
  const actualBackend = session.providerBackend || defaultTarget?.backend || 'cli';
  const actualInstanceId = session.providerInstanceId
    || defaultTarget?.instance
    || 'default';

  try {
    const requestedTarget = resolveProviderTarget(
      ctx.config,
      session.providerName,
      requestedInstance,
    );
    return requestedTarget.backend === actualBackend
      && requestedTarget.instanceId === actualInstanceId;
  } catch {
    return false;
  }
}

function cloneManagedHistoryIfPresent(
  ctx: AppContext,
  sourceSession: SessionInfo,
  targetSession: SessionInfo,
): void {
  if (!sourceSession.sourcePath) {
    return;
  }
  if (!sourceSession.sourcePath.startsWith(ctx.config.sessionBaseDir)) {
    return;
  }
  if (!existsSync(sourceSession.sourcePath)) {
    return;
  }

  const historyDir = join(ctx.config.sessionBaseDir, 'history');
  mkdirSync(historyDir, { recursive: true });
  const targetPath = join(historyDir, `${targetSession.id}.jsonl`);
  copyFileSync(sourceSession.sourcePath, targetPath);
  ctx.registry.setSourcePath(targetSession.id, targetPath);
}

function tracksNativeSessionState(session: SessionInfo): boolean {
  return Boolean(
    session.providerBackend === 'cli'
    && session.providerSessionId
    && (session.providerName === 'cursor'
      || session.providerName === 'goose'
      || session.providerName === 'kiro'
      || session.providerName === 'kilo'
      || session.providerName === 'opencode'),
  );
}

async function deleteNativeSessionState(
  ctx: AppContext,
  session: SessionInfo,
): Promise<NativeCleanupResult> {
  if (!session.providerSessionId) return true;

  try {
    if (session.providerName === 'cursor') {
      const cursorNative = getCursorNative(ctx, session.providerInstanceId);
      await cursorNative.deleteSession(session.cwd, session.providerSessionId);
      const remaining = await cursorNative.listSessions(
        session.cwd,
        { startIfNeeded: false },
      );
      return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
    }

    if (session.providerName === 'kiro') {
      const kiroNative = getKiroNative(ctx, session.providerInstanceId);
      await kiroNative.deleteSession(session.cwd, session.providerSessionId);
      const remaining = await kiroNative.listSessions(
        session.cwd,
        { startIfNeeded: false },
      );
      return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
    }

    if (session.providerName === 'goose') {
      const gooseNative = getGooseNative(ctx, session.providerInstanceId);
      return gooseNative.deleteSession(session.cwd, session.providerSessionId);
    }

    if (session.providerName === 'opencode') {
      const opencodeNative = getOpencodeNative(ctx, session.providerInstanceId);
      await opencodeNative.deleteSession(session.cwd, session.providerSessionId);
      const remaining = await opencodeNative.getSession(session.cwd, session.providerSessionId);
      return remaining == null;
    }

    if (session.providerName === 'kilo') {
      const kiloNative = getKiloNative(ctx, session.providerInstanceId);
      await kiloNative.deleteSession(session.cwd, session.providerSessionId);
      const remaining = await kiloNative.getSession(session.cwd, session.providerSessionId);
      return remaining == null;
    }
  } catch (error) {
    if (isUnknownProviderInstanceError(error) || isProviderNotConfiguredError(error)) {
      console.warn(
        `[sessions] Skipping native cleanup for stale ${session.providerName} `
        + `session '${session.id}' targeting missing instance `
        + `'${session.providerInstanceId || 'default'}': `
        + `${error instanceof Error ? error.message : String(error)}`,
      );
      return 'stale_config';
    }
    throw error;
  }

  return true;
}

function tracksProviderDiscoveryState(session: SessionInfo): boolean {
  return Boolean(
    session.providerBackend === 'cli'
    && session.providerSessionId
    && (session.providerName === 'auggie'
      || session.providerName === 'claude'
      || session.providerName === 'codex'
      || session.providerName === 'copilot'
      || session.providerName === 'gemini'
      || session.providerName === 'pi'
      || session.providerName === 'junie'),
  );
}

function collectProviderDiscoveryArtifactPaths(ctx: AppContext, session: SessionInfo): string[] {
  if (!tracksProviderDiscoveryState(session)) {
    return [];
  }

  const artifactPaths = new Set<string>();
  for (const sourcePath of [session.providerSourcePath, session.sourcePath]) {
    if (!sourcePath) continue;
    if (sourcePath.startsWith(ctx.config.sessionBaseDir)) continue;

    if (session.providerName === 'copilot' && basename(sourcePath) === 'workspace.yaml') {
      artifactPaths.add(sourcePath);
      artifactPaths.add(join(dirname(sourcePath), 'events.jsonl'));
      continue;
    }

    artifactPaths.add(sourcePath);
  }

  return Array.from(artifactPaths);
}

type DiscoveredSessionArtifact = {
  providerSessionId: string;
  sourcePath?: string;
  cwd?: string;
};

function findMatchingProviderDiscoverySourcePath(
  session: SessionInfo,
  discovered: DiscoveredSessionArtifact[],
): string | null {
  if (!session.providerSessionId) {
    return null;
  }

  const exactMatch = discovered.find((item) =>
    item.providerSessionId === session.providerSessionId
    && item.sourcePath
    && (!session.cwd || !item.cwd || item.cwd === session.cwd),
  );
  if (exactMatch?.sourcePath) {
    return exactMatch.sourcePath;
  }

  const fallbackMatch = discovered.find((item) =>
    item.providerSessionId === session.providerSessionId
    && item.sourcePath,
  );
  return fallbackMatch?.sourcePath ?? null;
}

async function hydrateProviderDiscoverySourcePathForDelete(
  ctx: AppContext,
  session: SessionInfo,
): Promise<NonNullable<RuntimeSessionLifecycleCleanupSummary['providerDiscoveryHydration']>> {
  const sourcePathPresentBeforeDelete = Boolean(session.providerSourcePath);
  if (sourcePathPresentBeforeDelete) {
    return {
      status: 'skipped_existing_path',
      attempted: false,
      sourcePathPresentBeforeDelete,
      sourcePathPresentAfterHydration: true,
    };
  }

  const cachedSourcePath = ctx.registry.getProviderDiscoverySourcePath(
    session.providerName,
    session.providerSessionId,
    session.providerBackend,
    session.providerInstanceId,
  );
  if (cachedSourcePath && existsSync(cachedSourcePath)) {
    session.providerSourcePath = cachedSourcePath;
    return {
      status: 'resolved_from_registry_cache',
      attempted: true,
      sourcePathPresentBeforeDelete,
      sourcePathPresentAfterHydration: true,
    };
  }

  const discovered = await scanProviderDiscoveryArtifactsForDelete(ctx, session);
  if (discovered.scanFailed) {
    return {
      status: 'scan_failed',
      attempted: true,
      sourcePathPresentBeforeDelete,
      sourcePathPresentAfterHydration: false,
    };
  }

  const sourcePath = findMatchingProviderDiscoverySourcePath(session, discovered.items);
  if (!sourcePath) {
    return {
      status: 'unresolved',
      attempted: true,
      sourcePathPresentBeforeDelete,
      sourcePathPresentAfterHydration: false,
    };
  }

  session.providerSourcePath = sourcePath;
  return {
    status: 'resolved_from_scan',
    attempted: true,
    sourcePathPresentBeforeDelete,
    sourcePathPresentAfterHydration: true,
  };
}

async function scanProviderDiscoveryArtifactsForDelete(
  ctx: AppContext,
  session: SessionInfo,
): Promise<{ items: DiscoveredSessionArtifact[]; scanFailed: boolean }> {
  try {
    switch (session.providerName) {
      case 'auggie': {
        const sessionsService = getAuggieSessions(ctx, session.providerInstanceId);
        return {
          items: session.cwd
            ? await sessionsService.listSessions(session.cwd)
            : await sessionsService.listAllSessions(),
          scanFailed: false,
        };
      }
      case 'claude':
        return {
          items: await new SessionScanner(getClaudeProjectsDir(ctx, session.providerInstanceId)).scan(),
          scanFailed: false,
        };
      case 'codex':
        return {
          items: await new CodexSessionScanner(getCodexSessionsDir(ctx, session.providerInstanceId)).scan(),
          scanFailed: false,
        };
      case 'copilot':
        return {
          items: await new CopilotSessionScanner(
            getCopilotSessionsDir(ctx, session.providerInstanceId),
          ).scan(),
          scanFailed: false,
        };
      case 'gemini':
        return {
          items: await new GeminiSessionScanner(
            getGeminiSessionsDir(ctx, session.providerInstanceId),
          ).scan(),
          scanFailed: false,
        };
      case 'pi':
        return {
          items: await new PiSessionScanner(
            resolveFileBackedProviderPath(ctx.config, 'pi', session.providerInstanceId),
          ).scan(),
          scanFailed: false,
        };
      case 'junie':
        return {
          items: await new JunieSessionScanner().scan(),
          scanFailed: false,
        };
      default:
        return {
          items: [],
          scanFailed: false,
        };
    }
  } catch {
    return {
      items: [],
      scanFailed: true,
    };
  }
}

function createNoopPreparedDeletion(): PreparedFileDeletion {
  return {
    hadFiles: false,
    ready: true,
    finalize: () => ({ fileDeleted: false }),
    rollback: () => {},
  };
}

function createFailedPreparedDeletion(hadFiles: boolean): PreparedFileDeletion {
  return {
    hadFiles,
    ready: false,
    finalize: () => ({ fileDeleted: false }),
    rollback: () => {},
  };
}

function combinePreparedDeletions(
  ...preparedDeletions: PreparedFileDeletion[]
): PreparedFileDeletion {
  return {
    hadFiles: preparedDeletions.some((prepared) => prepared.hadFiles),
    ready: preparedDeletions.every((prepared) => prepared.ready),
    finalize: () => {
      let fileDeleted = false;
      for (const prepared of preparedDeletions) {
        fileDeleted = prepared.finalize().fileDeleted || fileDeleted;
      }
      return { fileDeleted };
    },
    rollback: () => {
      for (const prepared of [...preparedDeletions].reverse()) {
        prepared.rollback();
      }
    },
  };
}

function prepareReplacementFileDeletion(
  filePath: string,
  nextContent: string,
): PreparedFileDeletion {
  if (!existsSync(filePath)) {
    return createNoopPreparedDeletion();
  }

  const stagedPath = join(
    dirname(filePath),
    `.cats-runtime-delete-${randomUUID()}-${basename(filePath)}.pending-delete`,
  );

  try {
    renameSync(filePath, stagedPath);
    writeFileSync(filePath, nextContent);
  } catch {
    try {
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
    } catch {
      // Best effort restore below.
    }

    try {
      if (existsSync(stagedPath) && !existsSync(filePath)) {
        renameSync(stagedPath, filePath);
      }
    } catch {
      // If restore also fails we surface ready=false and let the delete abort.
    }

    return createFailedPreparedDeletion(true);
  }

  let completed = false;

  return {
    hadFiles: true,
    ready: true,
    finalize: () => {
      if (completed) {
        return { fileDeleted: true };
      }

      completed = true;
      try {
        rmSync(stagedPath, { force: true });
      } catch {
        // Best effort only. The replacement file is already live at filePath.
      }
      return { fileDeleted: true };
    },
    rollback: () => {
      if (completed) return;

      completed = true;
      try {
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true });
        }
      } catch {
        // Continue attempting to restore the original file.
      }

      try {
        if (existsSync(stagedPath) && !existsSync(filePath)) {
          renameSync(stagedPath, filePath);
        }
      } catch {
        // Delete will still abort because the prepared deletion is not finalized.
      }
    },
  };
}

function prepareClaudeSessionIndexDeletion(session: SessionInfo): PreparedFileDeletion {
  if (session.providerName !== 'claude' || !session.providerSessionId) {
    return createNoopPreparedDeletion();
  }

  const sourcePath = session.providerSourcePath || session.sourcePath;
  if (!sourcePath) {
    return createNoopPreparedDeletion();
  }

  const indexPath = join(dirname(sourcePath), 'sessions-index.json');
  if (!existsSync(indexPath)) {
    return createNoopPreparedDeletion();
  }

  let index: SessionsIndex;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf-8')) as SessionsIndex;
  } catch {
    // If Claude falls back to raw .jsonl scanning, deleting the transcript path is enough.
    return createNoopPreparedDeletion();
  }

  if (!Object.prototype.hasOwnProperty.call(index, session.providerSessionId)) {
    return createNoopPreparedDeletion();
  }

  const nextIndex = { ...index };
  delete nextIndex[session.providerSessionId];
  return prepareReplacementFileDeletion(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);
}

function prepareJunieSessionIndexDeletion(session: SessionInfo): PreparedFileDeletion {
  if (session.providerName !== 'junie' || !session.providerSessionId) {
    return createNoopPreparedDeletion();
  }

  const sourcePath = session.providerSourcePath || session.sourcePath;
  if (!sourcePath) {
    return createNoopPreparedDeletion();
  }

  const indexPath = join(dirname(dirname(sourcePath)), 'index.jsonl');
  if (!existsSync(indexPath)) {
    return createNoopPreparedDeletion();
  }

  let removedEntry = false;
  let raw: string;
  try {
    raw = readFileSync(indexPath, 'utf-8');
  } catch {
    return createNoopPreparedDeletion();
  }

  const remainingLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as { sessionId?: string };
      if (entry.sessionId === session.providerSessionId) {
        removedEntry = true;
        continue;
      }
    } catch {
      // Preserve unknown lines verbatim rather than corrupting the index.
    }

    remainingLines.push(line);
  }

  if (!removedEntry) {
    return createNoopPreparedDeletion();
  }

  const nextContent = remainingLines.length > 0
    ? `${remainingLines.join('\n')}\n`
    : '';
  return prepareReplacementFileDeletion(indexPath, nextContent);
}

function prepareProviderDiscoveryDeletion(
  ctx: AppContext,
  session: SessionInfo,
): PreparedFileDeletion {
  return combinePreparedDeletions(
    ctx.registry.preparePathDeletion(collectProviderDiscoveryArtifactPaths(ctx, session)),
    prepareClaudeSessionIndexDeletion(session),
    prepareJunieSessionIndexDeletion(session),
  );
}

async function verifyProviderDiscoveryStateDeleted(
  _ctx: AppContext,
  session: SessionInfo,
): Promise<boolean> {
  if (!tracksProviderDiscoveryState(session) || !session.providerSessionId) {
    return true;
  }

  // File-backed providers are cleaned up by the prepared provider-discovery
  // deletion step, which stages transcript files away and rewrites provider
  // indexes for providers that need one. Re-scanning here would observe the
  // pre-finalize filesystem state and incorrectly roll back the delete.
  return true;
}

/** POST /playground/workspace — create a runtime-owned shared workspace for playground rooms */
sessionRoutes.post('/playground/workspace', async (c) => {
  const ctx = c.get('ctx');
  const workspaceId = `${PLAYGROUND_WORKSPACE_PREFIX}${randomUUID()}`;
  const workspacePath = resolvePlaygroundWorkspacePath(ctx.config.sessionBaseDir, workspaceId);
  mkdirSync(workspacePath, { recursive: true });
  return c.json({
    id: workspaceId,
    cwd: workspacePath,
  });
});

sessionRoutes.delete('/playground/workspace/:id', async (c) => {
  const ctx = c.get('ctx');
  const workspaceId = c.req.param('id');
  if (!isValidPlaygroundWorkspaceId(workspaceId)) {
    return c.json({ error: 'Invalid playground workspace id' }, 400);
  }
  const workspacePath = resolvePlaygroundWorkspacePath(ctx.config.sessionBaseDir, workspaceId);
  rmSync(workspacePath, { recursive: true, force: true });
  return c.json({
    id: workspaceId,
    deleted: true,
  });
});

/** POST /sessions — create a new runtime-owned session */
sessionRoutes.post('/sessions', async (c) => {
  const ctx = c.get('ctx');
  const body = await c.req.json<{
    provider?: string;
    instance?: string;
    cwd?: string;
    model?: string;
    modelSelection?: unknown;
    group?: string;
    workspaceKind?: WorkspaceKind;
    workspaceAccess?: WorkspaceAccess;
    workspaceMode?: WorkspaceMode;
    workspaceIsolation?: WorkspaceIsolationMode;
    managed?: boolean;
    permissionMode?: 'skip' | 'whitelist' | 'default';
    allowedTools?: string[];
    sessionKey?: string;
    reusePolicy?: SessionReusePolicy;
    requestedStrategy?: string;
    acceptanceCriteria?: string;
    strategyContext?: Record<string, unknown>;
    correlation?: Record<string, unknown>;
    instructions?: string;
    skills?: unknown;
    context?: SessionInvocationContext;
    outputDir?: string;
  }>();

  const providerName = body.provider ?? 'claude';
  const runtime = getRuntimeSessionManager(ctx);
  const configuredProviders = listConfiguredProviders(ctx.config);

  if (!configuredProviders.includes(providerName)) {
    return c.json({
      error: `Unknown provider '${providerName}'. Valid: ${configuredProviders.join(', ')}`,
    }, 400);
  }

  let providerTarget: ProviderTargetDescriptor;
  try {
    providerTarget = resolveRequestedProviderTarget(ctx, providerName, body.instance);
  } catch (err) {
    return c.json({ error: `${err}` }, 400);
  }

  const providerInstance = providerTarget.backend === 'cli'
    ? resolveCliProviderInstance(providerTarget)
    : undefined;
  const requestedLegacyModel = parseOptionalString(body.model);
  const parsedModelSelection = parseProviderModelSelection(body.modelSelection);
  if (parsedModelSelection.error) {
    return c.json({ error: parsedModelSelection.error }, 400);
  }
  let requestedModelState: ResolvedSessionModelState;
  try {
    requestedModelState = await resolveRequestedSessionModelState(ctx, providerTarget, {
      legacyModel: requestedLegacyModel,
      selection: parsedModelSelection.selection,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  const requestedSessionKey = parseOptionalString(body.sessionKey);
  const reusePolicy = parseReusePolicy(body.reusePolicy) || 'create_new';
  if (!requestedSessionKey && reusePolicy === 'require_existing') {
    return c.json({ error: 'sessionKey is required when reusePolicy=require_existing' }, 400);
  }

  const sessionKey = requestedSessionKey || randomUUID();
  const instructions = parseOptionalString(body.instructions);
  const parsedSkills = parseRuntimeSkillManifest(body.skills);
  if (parsedSkills.error) {
    return c.json({ error: parsedSkills.error }, 400);
  }
  const context = parseInvocationContext(body.context);
  const requestedHydrationMetadata = extractHydrationMetadata(
    context,
    parsedSkills.clear ? undefined : parsedSkills.manifest,
  );
  const outputDir = parseOptionalString(body.outputDir);
  const strategyRequest = parseRuntimeExecutionStrategyRequest(
    body as unknown as Record<string, unknown>,
  );
  const strategyPatch = buildRuntimeExecutionStrategySessionPatch(undefined, {
    request: strategyRequest,
  });
  const workspaceKind = parseWorkspaceKind(body.workspaceKind);
  const workspaceAccess = parseWorkspaceAccess(body.workspaceAccess);
  const workspaceIsolationMode = parseWorkspaceIsolationMode(body.workspaceIsolation);

  if (reusePolicy !== 'create_new' && requestedSessionKey) {
    const existing = findReusableSession(ctx, providerTarget, providerName, requestedSessionKey);
    if (!existing) {
      if (reusePolicy === 'require_existing') {
        return c.json({
          error: `No existing ${providerName} session found for sessionKey '${requestedSessionKey}'`,
        }, 409);
      }
    } else {
      const existingSourceCwd = getSessionWorkspaceSourceCwd(existing) ?? existing.cwd;
      if (
        (body.cwd && existingSourceCwd !== body.cwd)
        || (workspaceKind && resolveSessionWorkspaceKind(existing) !== workspaceKind)
        || (workspaceAccess && resolveSessionWorkspaceAccess(existing) !== workspaceAccess)
        || (body.workspaceMode && existing.workspaceMode !== body.workspaceMode)
        || (
          workspaceIsolationMode
          && resolveSessionWorkspaceIsolationMode(existing) !== workspaceIsolationMode
        )
        || (
          requestedLegacyModel
          && existing.model
          && requestedLegacyModel !== existing.model
        )
        || (
          parsedModelSelection.selection
          && !(
            sameProviderModelSelection(existing.modelSelection, requestedModelState.modelSelection)
            || (
              !existing.modelSelection
              && isLegacyCompatibleExplicitSelection(
                requestedModelState.modelSelection,
                existing.model,
              )
            )
          )
        )
      ) {
        return c.json({
          error: 'Existing sessionKey matches a session with different cwd/model/workspace settings. '
            + 'Use reusePolicy=create_new to force a new session.',
        }, 409);
      }

      let preparedExisting: SessionInfo;
      try {
        preparedExisting = await ensureSessionWorkspacePrepared(ctx, existing);
      } catch (err) {
        return c.json({ error: `Failed to prepare reusable session workspace: ${err}` }, 500);
      }
      let skills = existing.skills;
      let hydration = existing.hydration;
      try {
        const hydrated = await hydrateSessionForTarget(ctx, {
          trigger: 'create',
          sessionId: preparedExisting.id,
          providerTarget,
          cwd: preparedExisting.cwd,
          workspace: preparedExisting.workspace,
          workspaceMode: preparedExisting.workspaceMode,
          workspaceIsolationMode: resolveSessionWorkspaceIsolationMode(preparedExisting),
          requestedSkills: parsedSkills.clear ? undefined : parsedSkills.manifest,
          existingSkills: parsedSkills.clear ? undefined : preparedExisting.skills,
          existingHydration: preparedExisting.hydration,
          workspaceSourceCwd: getSessionWorkspaceSourceCwd(preparedExisting),
          metadata: requestedHydrationMetadata,
        });
        skills = hydrated.skills;
        hydration = hydrated.hydration;
      } catch (error) {
        const runtimeSkillError = toRuntimeSkillErrorResponse(error);
        if (runtimeSkillError) {
          return c.json(runtimeSkillError.body, runtimeSkillError.status);
        }
        throw error;
      }

      ctx.registry.updateSessionMetadata(existing.id, {
        ...(requestedModelState.model !== undefined ? { model: requestedModelState.model } : {}),
        ...(requestedModelState.modelSelection
          ? { modelSelection: requestedModelState.modelSelection }
          : {}),
        ...(requestedModelState.modelResolution
          ? { modelResolution: requestedModelState.modelResolution }
          : {}),
        sessionKey,
        reusePolicy,
        ...buildRuntimeExecutionStrategySessionPatch(preparedExisting, {
          request: strategyRequest,
        }),
        instructions: instructions ?? preparedExisting.instructions,
        skills,
        hydration,
        context: context ?? preparedExisting.context,
        outputDir: outputDir ?? preparedExisting.outputDir,
      });

      const updatedExisting = ctx.registry.get(existing.id) ?? preparedExisting;
      const existingHandle = runtime.get(existing.id);
      if (!existingHandle?.active) {
        if (updatedExisting.providerBackend === 'cli') {
          return c.json({
            error: 'Explicit sessionKey reuse currently supports api/local/agent sessions only. '
              + 'Use /sessions/:id/resume for CLI sessions.',
          }, 409);
        }

        try {
          runtime.spawn(
            updatedExisting.id,
            updatedExisting.providerName,
            buildSpawnOptions({
              cwd: updatedExisting.cwd,
              workspaceMode: updatedExisting.workspaceMode,
              model: updatedExisting.model,
              modelResolution: updatedExisting.modelResolution,
              instructionsFile: updatedExisting.skills?.delivery.instructions?.filePath,
              permissionMode: updatedExisting.permissionMode,
              allowedTools: updatedExisting.allowedTools,
            }),
            updatedExisting.providerInstanceId,
            updatedExisting.providerBackend,
          );
          ctx.registry.updateStatus(existing.id, 'ready');
        } catch (err) {
          return c.json({ error: `Failed to reuse session: ${err}` }, 500);
        }
      }

      return c.json(serializeSession(ctx, ctx.registry.get(existing.id) ?? existing));
    }
  }

  const sessionId = randomUUID();

  let resolved: PrepareSessionWorkspaceResult;
  try {
    resolved = await prepareSessionWorkspace({
      sessionId,
      sessionBaseDir: ctx.config.sessionBaseDir,
      cwd: body.cwd || undefined,
      workspaceKind,
      workspaceAccess,
      workspaceMode: body.workspaceMode,
      workspaceIsolationMode,
      permissionMode: body.permissionMode,
    });
  } catch (err) {
    return c.json({ error: `${err}` }, 400);
  }

  let skills;
  let hydration;
  try {
    const hydrated = await hydrateSessionForTarget(ctx, {
      trigger: 'create',
      sessionId,
      providerTarget,
      cwd: resolved.cwd,
      workspace: resolved.workspace,
      workspaceMode: resolved.workspaceMode,
      workspaceIsolationMode: resolved.workspaceIsolation.mode,
      requestedSkills: parsedSkills.clear ? undefined : parsedSkills.manifest,
      existingHydration: undefined,
      workspaceSourceCwd: resolved.sourceCwd,
      metadata: requestedHydrationMetadata,
    });
    skills = hydrated.skills;
    hydration = hydrated.hydration;
  } catch (error) {
    const runtimeSkillError = toRuntimeSkillErrorResponse(error);
    if (runtimeSkillError) {
      await discardPreparedWorkspace(ctx, {
        id: sessionId,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
      });
      return c.json(runtimeSkillError.body, runtimeSkillError.status);
    }
    throw error;
  }

  if (providerName === 'cursor' && providerTarget.backend === 'cli') {
    const caps = runtime.getCapabilities('cursor', providerInstance!.id, 'cli');
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      await discardPreparedWorkspace(ctx, {
        id: sessionId,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
      });
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await getCursorNative(ctx, providerInstance!.id).createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const cursorModelState = requestedModelState.model
        ? requestedModelState
        : native.model
          ? await resolveRequestedSessionModelState(ctx, providerTarget, {
            legacyModel: native.model,
          })
          : requestedModelState;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'cursor',
        providerBackend: 'cli',
        providerInstanceId: providerInstance!.id,
        cwd: resolved.cwd,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
        model: cursorModelState.model ?? native.model,
        modelSelection: cursorModelState.modelSelection,
        modelResolution: cursorModelState.modelResolution,
        group: body.group,
        sessionKey,
        reusePolicy,
        ...strategyPatch,
        instructions,
        skills,
        context,
        outputDir,
      });
      session.summary = native.summary;
      session.messageCount = native.messageCount;
      session.lastActivity = native.lastActivity;

      ctx.registry.setProviderSessionId(session.id, native.providerSessionId);
      await primeCliCompatibility(
        ctx,
        resolveCliProviderTarget(ctx, providerName, providerInstance!.id),
      );
      runtime.spawn(
        session.id,
        providerName,
        buildSpawnOptions({
          cwd: resolved.cwd,
          workspaceMode: resolved.workspaceMode,
          model: cursorModelState.model ?? native.model,
          modelResolution: cursorModelState.modelResolution,
          resumeSessionId: native.providerSessionId,
          instructionsFile: skills?.delivery.instructions?.filePath,
          permissionMode: resolved.permissionMode,
          allowedTools: body.allowedTools,
        }),
        providerInstance!.id,
        'cli',
      );
      ctx.registry.updateStatus(session.id, 'ready');

      return c.json(serializeSession(ctx, session), 201);
    } catch (err) {
      ctx.registry.remove(sessionId);
      if (nativeProviderSessionId) {
        try {
          await getCursorNative(ctx, providerInstance!.id).deleteSession(
            resolved.cwd,
            nativeProviderSessionId,
          );
        } catch {
          // Best effort rollback only.
        }
      }
      await discardPreparedWorkspace(ctx, {
        id: sessionId,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
      });
      return c.json({ error: `Failed to create Cursor session: ${err}` }, 500);
    }
  }

  if (providerName === 'opencode' && providerTarget.backend === 'cli') {
    const caps = runtime.getCapabilities('opencode', providerInstance!.id, 'cli');
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      await discardPreparedWorkspace(ctx, {
        id: sessionId,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
      });
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await getOpencodeNative(ctx, providerInstance!.id).createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'opencode',
        providerBackend: 'cli',
        providerInstanceId: providerInstance!.id,
        cwd: resolved.cwd,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
        model: requestedModelState.model,
        modelSelection: requestedModelState.modelSelection,
        modelResolution: requestedModelState.modelResolution,
        group: body.group,
        sessionKey,
        reusePolicy,
        ...strategyPatch,
        instructions,
        skills,
        context,
        outputDir,
      });
      session.summary = native.summary;
      session.messageCount = native.messageCount;
      session.lastActivity = native.lastActivity;

      ctx.registry.setProviderSessionId(session.id, native.providerSessionId);
      await primeCliCompatibility(
        ctx,
        resolveCliProviderTarget(ctx, providerName, providerInstance!.id),
      );
      runtime.spawn(
        session.id,
        providerName,
        buildSpawnOptions({
          cwd: resolved.cwd,
          workspaceMode: resolved.workspaceMode,
          model: requestedModelState.model,
          modelResolution: requestedModelState.modelResolution,
          resumeSessionId: native.providerSessionId,
          instructionsFile: skills?.delivery.instructions?.filePath,
          permissionMode: resolved.permissionMode,
          allowedTools: body.allowedTools,
        }),
        providerInstance!.id,
        'cli',
      );
      ctx.registry.updateStatus(session.id, 'ready');

      return c.json(serializeSession(ctx, session), 201);
    } catch (err) {
      ctx.registry.remove(sessionId);
      if (nativeProviderSessionId) {
        try {
          await getOpencodeNative(ctx, providerInstance!.id).deleteSession(
            resolved.cwd,
            nativeProviderSessionId,
          );
        } catch {
          // Best effort rollback only.
        }
      }
      await discardPreparedWorkspace(ctx, {
        id: sessionId,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
      });
      return c.json({ error: `Failed to create OpenCode session: ${err}` }, 500);
    }
  }

  if (providerName === 'kilo' && providerTarget.backend === 'cli') {
    const caps = runtime.getCapabilities('kilo', providerInstance!.id, 'cli');
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      await discardPreparedWorkspace(ctx, {
        id: sessionId,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
      });
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await getKiloNative(ctx, providerInstance!.id).createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'kilo',
        providerBackend: 'cli',
        providerInstanceId: providerInstance!.id,
        cwd: resolved.cwd,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
        model: requestedModelState.model,
        modelSelection: requestedModelState.modelSelection,
        modelResolution: requestedModelState.modelResolution,
        group: body.group,
        sessionKey,
        reusePolicy,
        ...strategyPatch,
        instructions,
        skills,
        context,
        outputDir,
      });
      session.summary = native.summary;
      session.messageCount = native.messageCount;
      session.lastActivity = native.lastActivity;

      ctx.registry.setProviderSessionId(session.id, native.providerSessionId);
      await primeCliCompatibility(
        ctx,
        resolveCliProviderTarget(ctx, providerName, providerInstance!.id),
      );
      runtime.spawn(
        session.id,
        providerName,
        buildSpawnOptions({
          cwd: resolved.cwd,
          workspaceMode: resolved.workspaceMode,
          model: requestedModelState.model,
          modelResolution: requestedModelState.modelResolution,
          resumeSessionId: native.providerSessionId,
          instructionsFile: skills?.delivery.instructions?.filePath,
          permissionMode: resolved.permissionMode,
          allowedTools: body.allowedTools,
        }),
        providerInstance!.id,
        'cli',
      );
      ctx.registry.updateStatus(session.id, 'ready');

      return c.json(serializeSession(ctx, session), 201);
    } catch (err) {
      ctx.registry.remove(sessionId);
      if (nativeProviderSessionId) {
        try {
          await getKiloNative(ctx, providerInstance!.id).deleteSession(
            resolved.cwd,
            nativeProviderSessionId,
          );
        } catch {
          // Best effort rollback only.
        }
      }
      await discardPreparedWorkspace(ctx, {
        id: sessionId,
        workspace: resolved.workspace,
        workspaceMode: resolved.workspaceMode,
        workspaceIsolation: resolved.workspaceIsolation,
      });
      return c.json({ error: `Failed to create Kilo session: ${err}` }, 500);
    }
  }

  const caps = runtime.getCapabilities(
    providerName,
    providerTarget.instanceId,
    providerTarget.backend,
  );

  if (!caps.permissions && resolved.workspaceMode === 'read_only') {
    await discardPreparedWorkspace(ctx, {
      id: sessionId,
      workspace: resolved.workspace,
      workspaceMode: resolved.workspaceMode,
      workspaceIsolation: resolved.workspaceIsolation,
    });
    return c.json({
      error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
    }, 400);
  }

  const warnings: string[] = [];
  if (requestedModelState.warnings.length > 0) {
    warnings.push(...requestedModelState.warnings);
  }
  if (!caps.permissions && body.permissionMode && body.permissionMode !== 'skip') {
    warnings.push(`Provider '${providerName}' runs in full-auto mode; permissionMode '${body.permissionMode}' is ignored`);
  }

  const session = ctx.registry.create({
    id: sessionId,
    providerName,
    providerBackend: providerTarget.backend,
    providerInstanceId: providerTarget.instanceId,
    cwd: resolved.cwd,
    workspace: resolved.workspace,
    workspaceMode: resolved.workspaceMode,
    workspaceIsolation: resolved.workspaceIsolation,
    permissionMode: resolved.permissionMode,
    allowedTools: body.allowedTools,
    model: requestedModelState.model,
    modelSelection: requestedModelState.modelSelection,
    modelResolution: requestedModelState.modelResolution,
    group: body.group,
    sessionKey,
    reusePolicy,
    ...strategyPatch,
    instructions,
    skills,
    hydration,
    context,
    outputDir,
  });

  try {
    await primeCliCompatibility(ctx, providerTarget);
    runtime.spawn(
      session.id,
      providerName,
      buildSpawnOptions({
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: requestedModelState.model,
        modelResolution: requestedModelState.modelResolution,
        instructionsFile: skills?.delivery.instructions?.filePath,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
      }),
      providerTarget.instanceId,
      providerTarget.backend,
    );
  } catch (err) {
    await discardPreparedWorkspace(ctx, {
      id: sessionId,
      workspace: resolved.workspace,
      workspaceMode: resolved.workspaceMode,
      workspaceIsolation: resolved.workspaceIsolation,
    });
    ctx.registry.remove(session.id);
    return c.json({ error: `Failed to spawn session: ${err}` }, 500);
  }

  if (providerTarget.backend !== 'cli') {
    ctx.registry.updateStatus(session.id, 'ready');
  }

  if (skills?.warnings.length) {
    warnings.push(...skills.warnings);
  }

  return c.json({ ...serializeSession(ctx, session), ...(warnings.length ? { warnings } : {}) }, 201);
});

/** GET /sessions — list sessions */
sessionRoutes.get('/sessions', (c) => {
  const ctx = c.get('ctx');

  const status = c.req.query('status') as SessionStatus | undefined;
  const provider = c.req.query('provider');
  const instance = c.req.query('instance');
  const group = c.req.query('group');
  const includeBranchCapabilities = parseIncludeBranchCapabilities(c.req.query('branching'));

  let sessions = ctx.registry.list({ status, provider, group });
  if (instance) {
    sessions = sessions.filter(
      (session) => sessionMatchesInstanceFilter(ctx, session, instance),
    );
  }
  return c.json({
    sessions: serializeSessions(ctx, sessions, { includeBranchCapabilities }),
    count: sessions.length,
  });
});

/** POST /sessions/discover — manually scan configured WSL/Docker session targets */
sessionRoutes.post('/sessions/discover', async (c) => {
  const ctx = c.get('ctx');
  const result = await runManualSessionDiscovery({
    config: ctx.config,
    registry: ctx.registry,
    runner: {
      listSessions: (target) => listManualDiscoverySessions(ctx, target),
    },
  });

  return c.json({
    status: result.summary.status,
    summary: result.summary,
    targets: result.targets,
  });
});

/** GET /sessions/:id — get session details */
sessionRoutes.get('/sessions/:id', (c) => {
  const ctx = c.get('ctx');
  const session = ctx.registry.get(c.req.param('id'));

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json(serializeSession(ctx, session));
});

/** GET /sessions/:id/lineage — inspect branch ancestry/descendants */
sessionRoutes.get('/sessions/:id/lineage', (c) => {
  const ctx = c.get('ctx');
  const session = ctx.registry.get(c.req.param('id'));

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const sessions = ctx.registry.list();
  const lineage = getSessionLineage(session);
  const sessionsById = new Map(sessions.map((entry) => [entry.id, entry]));
  const ancestors = (lineage?.chain.slice(0, -1) || []).map((entry) => ({
    sessionId: entry.sessionId,
    provider: entry.provider,
    presentInRegistry: sessionsById.has(entry.sessionId),
  }));
  const children = sortSessionsByTimestamp(
    sessions.filter((candidate) => getSessionLineage(candidate)?.parentSessionId === session.id),
  ).map((candidate) => serializeLineageRelation(candidate, session.id));
  const descendants = sortSessionsByTimestamp(
    sessions.filter((candidate) => {
      if (candidate.id === session.id) {
        return false;
      }
      const candidateLineage = getSessionLineage(candidate);
      return Boolean(
        candidateLineage
        && candidateLineage.chain.some((entry) => entry.sessionId === session.id),
      );
    }),
  ).map((candidate) => serializeLineageRelation(candidate, session.id));

  return c.json({
    session: serializeSession(ctx, session),
    rootSessionId: lineage?.rootSessionId ?? session.id,
    parentSessionId: lineage?.parentSessionId ?? null,
    ancestors,
    children,
    descendants,
  });
});

/** POST /sessions/:id/close — stop worker, keep session in registry */
sessionRoutes.post('/sessions/:id/close', async (c) => {
  const ctx = c.get('ctx');
  const runtime = getRuntimeSessionManager(ctx);
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const body = await c.req.json<{
    maintenance?: {
      reason?: string;
      hookPayloads?: RuntimeSessionMaintenanceHookPayload[];
    };
  }>().catch(() => ({}) as {
    maintenance?: {
      reason?: string;
      hookPayloads?: RuntimeSessionMaintenanceHookPayload[];
    };
  });
  const maintenanceRequest = parseMaintenanceRequestBody(body.maintenance);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const view = serializeSession(ctx, session);
  if (!view.attached && view.activity === 'interactive') {
    return c.json({
      error: 'This session appears to be active outside cats-runtime and can only be observed right now.',
    }, 409);
  }

  recordSessionMaintenanceRequest(ctx, session, 'close', maintenanceRequest);

  const worker = runtime.get(id);
  if (!worker?.active) {
    ctx.registry.updateStatus(id, 'closed');
    runtime.markClosed(id);
    recordSessionLifecycle(ctx, id, {
      action: 'close',
      boundary: 'soft_close',
      status: 'completed',
      reasonCodes: ['already_detached'],
      cleanup: {
        workerDetached: true,
      },
    });
    return c.json(serializeLifecycleSession(ctx, ctx.registry.get(id) ?? session, 'close'));
  }

  ctx.registry.updateStatus(id, 'closing');
  await runtime.close(session, 'close');
  const workerDetached = !runtime.isAttached(id);
  if (workerDetached) {
    ctx.registry.updateStatus(id, 'closed');
  }
  recordSessionLifecycle(ctx, id, {
    action: 'close',
    boundary: 'soft_close',
    status: 'completed',
    reasonCodes: ['session_closed'],
    cleanup: {
      workerDetached,
    },
  });
  return c.json(serializeLifecycleSession(ctx, ctx.registry.get(id) ?? session, 'close'));
});

/** POST /sessions/:id/cancel — cancel the active turn but keep the session */
sessionRoutes.post('/sessions/:id/cancel', async (c) => {
  const ctx = c.get('ctx');
  const runtime = getRuntimeSessionManager(ctx);
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const view = serializeSession(ctx, session);
  if (!view.attached && view.activity === 'interactive') {
    return c.json({
      error: 'This session appears to be active outside cats-runtime and can only be observed right now.',
    }, 409);
  }

  const worker = runtime.get(id);
  if (!worker?.active) {
    ctx.registry.updateStatus(id, session.status === 'closed' ? 'closed' : 'ready');
    return c.json(serializeLifecycleSession(ctx, ctx.registry.get(id) ?? session, 'cancel'));
  }

  if (!worker.busy) {
    ctx.registry.updateStatus(id, 'ready');
    return c.json(serializeLifecycleSession(ctx, ctx.registry.get(id) ?? session, 'cancel'));
  }

  const result = await runtime.cancel(session);
  if (!result.attached) {
    ctx.registry.updateStatus(id, 'closed');
  } else if (!runtime.get(id)?.busy) {
    ctx.registry.updateStatus(id, 'ready');
  }

  return c.json(serializeLifecycleSession(ctx, ctx.registry.get(id) ?? session, 'cancel'));
});

/** POST /sessions/:id/reset — clear provider resume state and detach the worker */
sessionRoutes.post('/sessions/:id/reset', async (c) => {
  const ctx = c.get('ctx');
  const runtime = getRuntimeSessionManager(ctx);
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const requireAcknowledgedHooks = body.requireAcknowledgedHooks === true;
  let worktreeCleanupPolicy: WorktreeCleanupPolicy | undefined;
  try {
    worktreeCleanupPolicy = readOptionalWorktreeCleanupPolicy(body);
  } catch (error) {
    return c.json({ error: `${error}` }, 400);
  }
  const maintenanceRequest = parseMaintenanceRequestBody(body.maintenance);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const view = serializeSession(ctx, session);
  if (!view.attached && view.activity === 'interactive') {
    return c.json({
      error: 'This session appears to be active outside cats-runtime and can only be observed right now.',
    }, 409);
  }

  recordSessionMaintenanceRequest(
    ctx,
    session,
    'reset',
    maintenanceRequest,
    worktreeCleanupPolicy,
  );
  const serializedBeforeReset = serializeSession(ctx, ctx.registry.get(id) ?? session);
  const resetHookGate = resolveMaintenanceHookGate(
    serializedBeforeReset.inspection.maintenance,
    'reset',
    'pre_reset',
  );
  if (requireAcknowledgedHooks && resetHookGate.hooksPending && !resetHookGate.hooksAcknowledged) {
    return c.json(
      buildMaintenanceHookConflict(
        'reset',
        'pre_reset',
        serializedBeforeReset,
        resetHookGate,
      ),
      409,
    );
  }

  const worker = runtime.get(id);
  let workerDetached = !runtime.isAttached(id);
  if (worker?.active) {
    ctx.registry.updateStatus(id, 'closing');
    await runtime.close(session, 'reset');
    workerDetached = !runtime.isAttached(id);
  }

  ctx.registry.updateStatus(id, 'closed');
  let sessionAfterCleanup = ctx.registry.get(id) ?? session;
  let workspaceCleaned = false;
  let worktreeDetached: boolean | undefined;
  let worktreeMergedPaths: number | undefined;
  let resolvedCleanupPolicy: WorktreeCleanupPolicy | undefined;
  let browserSessionsCleared = 0;

  if (sessionAfterCleanup.workspaceIsolation?.mode === 'worktree') {
    const cleanup = await prepareWorkspaceCleanupState(
      sessionAfterCleanup,
      worktreeCleanupPolicy,
      ctx,
    );
    sessionAfterCleanup = persistWorkspaceCleanupState(ctx, id, cleanup) ?? sessionAfterCleanup;
    workspaceCleaned = cleanup.workspaceCleaned;
    worktreeDetached = cleanup.worktreeDetached;
    worktreeMergedPaths = cleanup.mergedPathCount;
    resolvedCleanupPolicy = cleanup.policy;

    if (cleanup.status === 'retained') {
      runtime.markClosed(id);
      const maintenance = recordSessionLifecycle(ctx, id, {
        action: 'reset',
        boundary: 'hard_reset',
        status: 'retained',
        reasonCodes: ['manual_reset', 'workspace_cleanup_retained', ...cleanup.reasonCodes],
        cleanup: {
          workerDetached,
          workspaceCleaned,
          ...(worktreeDetached !== undefined ? { worktreeDetached } : {}),
          ...(resolvedCleanupPolicy ? { worktreeCleanupPolicy: resolvedCleanupPolicy } : {}),
          ...(worktreeMergedPaths !== undefined ? { worktreeMergedPaths } : {}),
        },
      });
      return c.json({
        action: 'reset',
        status: 'retained',
        reason: describeRetainedWorktreeCleanup(cleanup),
        ...(resolveSessionWorkspaceIsolationMode(sessionAfterCleanup) === 'worktree'
          ? { retryCleanupPath: buildWorkspaceCleanupPath(id) }
          : {}),
        cleanup: maintenance.cleanup,
        maintenance,
        session: serializeSession(ctx, sessionAfterCleanup),
      });
    }
  }

  try {
    browserSessionsCleared = await clearBrowserSessionsForRuntimeSession(ctx, id);
  } catch (err) {
    return c.json({ error: `Failed to clear browser sessions during reset: ${err}` }, 500);
  }

  ctx.registry.clearProviderResumeState(id);
  ctx.registry.setProviderState(id, undefined);
  ctx.registry.updateSessionMetadata(id, { hydration: undefined });
  runtime.clearProviderState(id);
  runtime.markClosed(id);
  const wakeupResult = ctx.wakeup?.clearSession(id);
  recordSessionLifecycle(ctx, id, {
    action: 'reset',
    boundary: 'hard_reset',
    status: 'completed',
    reasonCodes: ['manual_reset'],
    cleanup: {
      workerDetached,
      providerResumeCleared: true,
      providerStateCleared: true,
      wakeupsCleared: (wakeupResult?.removedCount ?? 0) > 0,
      browserSessionsCleared,
      workspaceCleaned,
      ...(worktreeDetached !== undefined ? { worktreeDetached } : {}),
      ...(resolvedCleanupPolicy ? { worktreeCleanupPolicy: resolvedCleanupPolicy } : {}),
      ...(worktreeMergedPaths !== undefined ? { worktreeMergedPaths } : {}),
    },
    clearExecutionState: true,
  });
  return c.json(serializeLifecycleSession(ctx, ctx.registry.get(id) ?? sessionAfterCleanup, 'reset'));
});

/**
 * POST /sessions/:id/workspace/cleanup — retry retained worktree cleanup
 * without replaying reset/delete follow-through.
 */
sessionRoutes.post('/sessions/:id/workspace/cleanup', async (c) => {
  const ctx = c.get('ctx');
  const runtime = getRuntimeSessionManager(ctx);
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const requireAcknowledgedHooks = body.requireAcknowledgedHooks === true;
  let requestedCleanupPolicy: WorktreeCleanupPolicy | undefined;
  try {
    requestedCleanupPolicy = readOptionalWorktreeCleanupPolicy(body);
  } catch (error) {
    return c.json({ error: `${error}` }, 400);
  }
  const maintenanceRequest = parseMaintenanceRequestBody(body.maintenance);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (session.workspaceIsolation?.mode !== 'worktree' || !session.workspaceIsolation.worktree) {
    return c.json({
      error: 'This session is not worktree-backed, so there is no retained worktree cleanup to retry.',
    }, 409);
  }

  const lastCleanup = session.workspaceIsolation.worktree.lastCleanup;
  if (lastCleanup?.status !== 'retained') {
    return c.json({
      error: 'This session does not currently have a retained worktree cleanup to retry.',
    }, 409);
  }

  const view = serializeSession(ctx, session);
  if (view.attached || runtime.isAttached(id)) {
    return c.json({
      error: 'Close or detach this session before retrying retained worktree cleanup.',
    }, 409);
  }

  if (!view.attached && view.activity === 'interactive') {
    return c.json({
      error: 'This session appears to be active outside cats-runtime and can only be observed right now.',
    }, 409);
  }

  const worktreeCleanupPolicy = requestedCleanupPolicy ?? lastCleanup.policy;
  recordSessionMaintenanceRequest(
    ctx,
    session,
    'cleanup_workspace',
    maintenanceRequest,
    worktreeCleanupPolicy,
  );
  const serializedBeforeCleanup = serializeSession(ctx, ctx.registry.get(id) ?? session);
  const cleanupHookGate = resolveMaintenanceHookGate(
    serializedBeforeCleanup.inspection.maintenance,
    'cleanup_workspace',
    'pre_flush',
  );
  if (requireAcknowledgedHooks && cleanupHookGate.hooksPending && !cleanupHookGate.hooksAcknowledged) {
    return c.json(
      buildMaintenanceHookConflict(
        'cleanup_workspace',
        'pre_flush',
        serializedBeforeCleanup,
        cleanupHookGate,
      ),
      409,
    );
  }

  let cleanupResult: Awaited<ReturnType<typeof executeRetainedWorktreeCleanup>>;
  try {
    cleanupResult = await executeRetainedWorktreeCleanup(ctx, session, {
      worktreeCleanupPolicy,
    });
  } catch (error) {
    if (error instanceof RetainedWorktreeCleanupHydrationError) {
      return c.json({
        error: error.message,
        action: 'cleanup_workspace',
        status: error.cleanup.status,
        reasonCodes: [...error.cleanup.reasonCodes],
        cleanup: {
          workspaceCleaned: error.cleanup.workspaceCleaned,
          worktreeDetached: error.cleanup.worktreeDetached,
          ...(error.cleanup.policy ? { worktreeCleanupPolicy: error.cleanup.policy } : {}),
          worktreeMergedPaths: error.cleanup.mergedPathCount,
        },
      }, 500);
    }
    throw error;
  }
  const { cleanup, sessionAfterCleanup, settledReset, settledDelete } = cleanupResult;
  const serialized = settledReset?.session
    ?? settledDelete?.session
    ?? serializeSession(ctx, sessionAfterCleanup);
  const maintenance = settledReset?.maintenance
    ?? (settledDelete
      ? {
          cleanup: settledDelete.maintenance.cleanup,
          lastLifecycle: settledDelete.maintenance,
        }
      : serialized.inspection.maintenance);

  return c.json({
    action: 'cleanup_workspace',
    status: cleanup.status,
    ...(cleanup.status === 'retained'
      ? { reason: describeRetainedWorktreeCleanup(cleanup) }
      : {}),
    cleanupPath: buildWorkspaceCleanupPath(id),
    reasonCodes: [...cleanup.reasonCodes],
    cleanup: {
      workspaceCleaned: cleanup.workspaceCleaned,
      worktreeDetached: cleanup.worktreeDetached,
      ...(cleanup.policy ? { worktreeCleanupPolicy: cleanup.policy } : {}),
      worktreeMergedPaths: cleanup.mergedPathCount,
    },
    ...(settledReset
      ? {
          settledLifecycle: {
            action: 'reset',
            status: 'completed',
            cleanup: settledReset.lifecycle.cleanup,
          },
        }
      : {}),
    ...(!settledReset && settledDelete
      ? {
          settledLifecycle: {
            action: 'delete',
            status: settledDelete.status === 'deleted' ? 'completed' : 'retained',
            cleanup: settledDelete.maintenance.cleanup,
          },
          deleteSettlement: {
            status: settledDelete.status,
            hadTranscript: settledDelete.hadTranscript,
            fileDeleted: settledDelete.fileDeleted,
            nativeDeleted: settledDelete.nativeDeleted,
            ...(settledDelete.reason ? { reason: settledDelete.reason } : {}),
          },
        }
      : {}),
    maintenance,
    ...(settledDelete?.status === 'deleted' ? {} : { session: serialized }),
  });
});

/** POST /sessions/:id/compact — expose a public compaction-preparation seam */
sessionRoutes.post('/sessions/:id/compact', async (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const body = await c.req.json<{
    acknowledgeHooks?: boolean;
    maintenance?: {
      reason?: string;
      hookPayloads?: RuntimeSessionMaintenanceHookPayload[];
    };
  }>().catch(() => ({}) as {
    acknowledgeHooks?: boolean;
    maintenance?: {
      reason?: string;
      hookPayloads?: RuntimeSessionMaintenanceHookPayload[];
    };
  });
  const maintenanceRequest = parseMaintenanceRequestBody(body.maintenance);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  recordSessionMaintenanceRequest(ctx, session, 'compact', maintenanceRequest);
  let serialized = serializeSession(ctx, ctx.registry.get(id) ?? session);
  if (body.acknowledgeHooks === true && serialized.inspection.maintenance.hooks.preCompaction.pending.length > 0) {
    recordSessionMaintenanceFollowThrough(
      ctx,
      session,
      'compact',
      'pre_compaction',
      'acknowledged',
      maintenanceRequest,
    );
    serialized = serializeSession(ctx, ctx.registry.get(id) ?? session);
  }
  const compaction = resolveCompactionRequestStatus(
    serialized.inspection.maintenance,
    body.acknowledgeHooks === true,
  );

  if (compaction.status !== 'ready_for_external_compaction') {
    return c.json({
      action: 'compact',
      status: compaction.status,
      execution: 'external_only',
      runtimeCompactionExecuted: false,
      hookStatus: compaction.hookStatus,
      reasonCodes: compaction.reasonCodes,
      maintenance: serialized.inspection.maintenance,
      session: serialized,
    });
  }

  const latestSession = ctx.registry.get(id) ?? session;
  if (!canRuntimeCompactSessionTranscript(latestSession, ctx.config.sessionBaseDir)) {
    return c.json({
      action: 'compact',
      status: compaction.status,
      execution: 'external_only',
      runtimeCompactionExecuted: false,
      hookStatus: compaction.hookStatus,
      reasonCodes: compaction.reasonCodes,
      maintenance: serialized.inspection.maintenance,
      session: serialized,
    });
  }

  const runtimeCompaction = compactRuntimeManagedTranscript({
    sessionId: id,
    session: latestSession,
    sessionBaseDir: ctx.config.sessionBaseDir,
  });
  if (!runtimeCompaction) {
    return c.json({
      action: 'compact',
      status: compaction.status,
      execution: 'external_only',
      runtimeCompactionExecuted: false,
      hookStatus: compaction.hookStatus,
      reasonCodes: [...compaction.reasonCodes, 'runtime_transcript_not_compactable'],
      maintenance: serialized.inspection.maintenance,
      session: serialized,
    });
  }

  recordSessionCompaction(ctx, id, runtimeCompaction.record);
  const compactedSession = ctx.registry.get(id) ?? latestSession;
  const serializedCompactedSession = serializeSession(ctx, compactedSession);

  return c.json({
    action: 'compact',
    status: 'compacted',
    execution: 'runtime',
    runtimeCompactionExecuted: true,
    hookStatus: compaction.hookStatus,
    reasonCodes: compaction.reasonCodes,
    runtimeCompaction: serializedCompactedSession.inspection.maintenance.compaction.lastCompaction,
    maintenance: serializedCompactedSession.inspection.maintenance,
    session: serializedCompactedSession,
  });
});

/** POST /sessions/:id/maintenance/follow-through — persist maintenance hook outcomes */
sessionRoutes.post('/sessions/:id/maintenance/follow-through', async (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const body = await c.req.json<{
    action?: 'reset' | 'delete' | 'cleanup_workspace' | 'compact';
    phase?: 'pre_reset' | 'pre_compaction' | 'pre_flush';
    outcome?: RuntimeSessionMaintenanceFollowThroughOutcome;
    maintenance?: {
      reason?: string;
      hookPayloads?: RuntimeSessionMaintenanceHookPayload[];
    };
  }>().catch(() => ({}) as {
    action?: 'reset' | 'delete' | 'cleanup_workspace' | 'compact';
    phase?: 'pre_reset' | 'pre_compaction' | 'pre_flush';
    outcome?: RuntimeSessionMaintenanceFollowThroughOutcome;
    maintenance?: {
      reason?: string;
      hookPayloads?: RuntimeSessionMaintenanceHookPayload[];
    };
  });
  const action = parseMaintenanceFollowThroughAction(body.action);
  const phase = parseMaintenanceFollowThroughPhase(body.phase);
  const outcome = parseCompactionFollowThroughOutcome(body.outcome);
  const maintenanceRequest = parseMaintenanceRequestBody(body.maintenance);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (!action) {
    return c.json({
      error: 'action must be one of: reset, delete, cleanup_workspace, compact',
    }, 400);
  }

  if (!phase) {
    return c.json({
      error: 'phase must be one of: pre_reset, pre_compaction, pre_flush',
    }, 400);
  }

  if (!outcome) {
    return c.json({
      error: 'outcome must be one of: acknowledged, retry_requested, completed',
    }, 400);
  }

  if (!supportsMaintenanceFollowThrough(action, phase)) {
    return c.json({
      error: `action '${action}' does not support follow-through phase '${phase}'`,
    }, 400);
  }

  const currentSession = ctx.registry.get(id) ?? session;
  const serializedBefore = serializeSession(ctx, currentSession);
  if (getPendingMaintenanceHooks(serializedBefore.inspection.maintenance, phase).length === 0) {
    return c.json({
      error: `This session does not currently advertise pending ${phase} hooks for action '${action}'.`,
    }, 409);
  }

  recordSessionMaintenanceFollowThrough(
    ctx,
    currentSession,
    action,
    phase,
    outcome,
    maintenanceRequest,
  );
  const serialized = serializeSession(ctx, ctx.registry.get(id) ?? currentSession);

  if (action === 'compact') {
    const compaction = resolveCompactionRequestStatus(serialized.inspection.maintenance, false);
    return c.json({
      action,
      phase,
      outcome,
      status: compaction.status,
      hookStatus: compaction.hookStatus,
      reasonCodes: compaction.reasonCodes,
      maintenance: serialized.inspection.maintenance,
      session: serialized,
    });
  }

  return c.json({
    action,
    phase,
    outcome,
    maintenance: serialized.inspection.maintenance,
    session: serialized,
  });
});

/** POST /sessions/:id/compact/follow-through — persist external compaction hook outcomes */
sessionRoutes.post('/sessions/:id/compact/follow-through', async (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const body = await c.req.json<{
    outcome?: RuntimeSessionMaintenanceFollowThroughOutcome;
    maintenance?: {
      reason?: string;
      hookPayloads?: RuntimeSessionMaintenanceHookPayload[];
    };
  }>().catch(() => ({}) as {
    outcome?: RuntimeSessionMaintenanceFollowThroughOutcome;
    maintenance?: {
      reason?: string;
      hookPayloads?: RuntimeSessionMaintenanceHookPayload[];
    };
  });
  const outcome = parseCompactionFollowThroughOutcome(body.outcome);
  const maintenanceRequest = parseMaintenanceRequestBody(body.maintenance);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  if (!outcome) {
    return c.json({
      error: 'outcome must be one of: acknowledged, retry_requested, completed',
    }, 400);
  }

  recordSessionMaintenanceFollowThrough(
    ctx,
    session,
    'compact',
    'pre_compaction',
    outcome,
    maintenanceRequest,
  );
  const serialized = serializeSession(ctx, ctx.registry.get(id) ?? session);
  const compaction = resolveCompactionRequestStatus(serialized.inspection.maintenance, false);

  return c.json({
    action: 'compact',
    outcome,
    status: compaction.status,
    hookStatus: compaction.hookStatus,
    reasonCodes: compaction.reasonCodes,
    maintenance: serialized.inspection.maintenance,
    session: serialized,
  });
});

/** DELETE /sessions/:id — permanently remove session and delete .jsonl */
sessionRoutes.delete('/sessions/:id', async (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const runtime = getRuntimeSessionManager(ctx);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const requireAcknowledgedHooks = body.requireAcknowledgedHooks === true;
  let worktreeCleanupPolicy: WorktreeCleanupPolicy | undefined;
  try {
    worktreeCleanupPolicy = readOptionalWorktreeCleanupPolicy(body);
  } catch (error) {
    return c.json({ error: `${error}` }, 400);
  }
  const maintenanceRequest = parseMaintenanceRequestBody(body.maintenance);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const view = serializeSession(ctx, session);
  if (!view.controls.canDelete) {
    return c.json({
      error: 'This session is still active outside cats-runtime or is already closing. Wait before deleting it.',
    }, 409);
  }

  recordSessionMaintenanceRequest(
    ctx,
    session,
    'delete',
    maintenanceRequest,
    worktreeCleanupPolicy,
  );
  const serializedBeforeDelete = serializeSession(ctx, ctx.registry.get(id) ?? session);
  const deleteHookGate = resolveMaintenanceHookGate(
    serializedBeforeDelete.inspection.maintenance,
    'delete',
    'pre_flush',
  );
  if (requireAcknowledgedHooks && deleteHookGate.hooksPending && !deleteHookGate.hooksAcknowledged) {
    return c.json(
      buildMaintenanceHookConflict(
        'delete',
        'pre_flush',
        serializedBeforeDelete,
        deleteHookGate,
      ),
      409,
    );
  }

  let workspaceCleaned = false;
  let worktreeDetached: boolean | undefined;
  let worktreeMergedPaths: number | undefined;
  let resolvedCleanupPolicy: WorktreeCleanupPolicy | undefined;

  if (session.workspaceIsolation?.mode === 'worktree') {
    const worker = runtime.get(id);
    if (worker?.active) {
      try {
        await runtime.close(session, 'delete');
        ctx.registry.updateStatus(id, 'closed');
      } catch (err) {
        return c.json({ error: `Failed to close session before delete: ${err}` }, 500);
      }
    }

    const cleanup = await prepareWorkspaceCleanupState(session, worktreeCleanupPolicy, ctx);
    workspaceCleaned = cleanup.workspaceCleaned;
    worktreeDetached = cleanup.worktreeDetached;
    worktreeMergedPaths = cleanup.mergedPathCount;
    resolvedCleanupPolicy = cleanup.policy;

    if (cleanup.status === 'retained') {
      const sessionAfterCleanup = persistWorkspaceCleanupState(ctx, id, cleanup) ?? session;
      const maintenance = recordSessionLifecycle(ctx, id, {
        action: 'delete',
        boundary: 'permanent_delete',
        status: 'retained',
        reasonCodes: ['workspace_cleanup_retained', ...cleanup.reasonCodes],
        cleanup: buildDeleteCleanupSummary({
          workerDetached: !runtime.isAttached(id),
          wakeupsCleared: false,
          workspaceCleaned,
          ...(worktreeDetached !== undefined ? { worktreeDetached } : {}),
          ...(resolvedCleanupPolicy ? { worktreeCleanupPolicy: resolvedCleanupPolicy } : {}),
          ...(worktreeMergedPaths !== undefined ? { worktreeMergedPaths } : {}),
          managedTranscriptDeleted: false,
          providerDiscoveryCleared: false,
          registryDropped: false,
        }),
      });
      return c.json({
        action: 'delete',
        sessionId: id,
        status: 'retained',
        hadTranscript: Boolean(session.sourcePath || session.providerSourcePath),
        fileDeleted: false,
        nativeDeleted: false,
        workspaceCleaned,
        retryCleanupPath: buildWorkspaceCleanupPath(id),
        cleanup: maintenance.cleanup,
        reason: cleanup.reasonCodes.includes('worktree_preserved')
          ? 'Worktree cleanup was intentionally preserved for manual handling. Session files were kept for retry.'
          : 'Worktree cleanup could not be completed. Session files were kept for retry.',
        maintenance,
        session: serializeSession(ctx, sessionAfterCleanup),
      });
    }
  } else if (session.workspaceMode === 'isolated') {
      workspaceCleaned = (await cleanupSessionWorkspace({
      sessionId: id,
      sessionBaseDir: ctx.config.sessionBaseDir,
      workspaceMode: session.workspaceMode,
      workspaceIsolation: session.workspaceIsolation,
    })).workspaceCleaned;
  }


  let finalizedDelete: Awaited<ReturnType<typeof finalizeDeleteAfterWorkspaceCleanup>>;
  try {
    finalizedDelete = await finalizeDeleteAfterWorkspaceCleanup(ctx, session, {
      workspaceCleaned,
      worktreeDetached,
      resolvedCleanupPolicy,
      worktreeMergedPaths,
    });
  } catch (error) {
    return c.json({ error: `${error}` }, 500);
  }

  if (finalizedDelete.status === 'retained') {
    return c.json({
      action: 'delete',
      sessionId: id,
      status: 'retained',
      hadTranscript: finalizedDelete.hadTranscript,
      fileDeleted: false,
      nativeDeleted: false,
      workspaceCleaned,
      cleanup: finalizedDelete.maintenance.cleanup,
      reason: finalizedDelete.reason,
      maintenance: finalizedDelete.maintenance,
      ...(finalizedDelete.session ? { session: finalizedDelete.session } : {}),
    });
  }

  return c.json({
    action: 'delete',
    sessionId: id,
    status: 'deleted',
    hadTranscript: finalizedDelete.hadTranscript,
    fileDeleted: finalizedDelete.fileDeleted,
    nativeDeleted: finalizedDelete.nativeDeleted,
    workspaceCleaned,
    cleanup: finalizedDelete.maintenance.cleanup,
    maintenance: finalizedDelete.maintenance,
  });
});

/** POST /sessions/:id/resume — resume a discovered/inactive session */
sessionRoutes.post('/sessions/:id/resume', async (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const runtime = getRuntimeSessionManager(ctx);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const view = serializeSession(ctx, session);
  if (!view.attached && view.activity === 'interactive') {
    return c.json({
      error: 'This session appears to be active outside cats-runtime already. Observe it or wait for it to go idle before resuming.',
    }, 409);
  }

  const existing = runtime.get(id);
  if (existing?.active) {
    ctx.registry.updateStatus(id, 'ready');
    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? session));
  }

  let preparedSession = session;
  try {
    preparedSession = await ensureSessionWorkspacePrepared(ctx, session);
  } catch (err) {
    return c.json({ error: `Failed to prepare workspace for resume: ${err}` }, 500);
  }

  if (preparedSession.providerBackend !== 'cli') {
    let hydratedSession = preparedSession;
    try {
      const providerTarget = resolveSessionProviderTarget(ctx.config, preparedSession);
      const hydrated = await hydrateSessionForTarget(ctx, {
        trigger: 'resume',
        sessionId: preparedSession.id,
        providerTarget,
        cwd: preparedSession.cwd,
        workspaceMode: preparedSession.workspaceMode,
        workspaceIsolationMode: resolveSessionWorkspaceIsolationMode(preparedSession),
        existingSkills: preparedSession.skills,
        existingHydration: preparedSession.hydration,
        workspaceSourceCwd: getSessionWorkspaceSourceCwd(preparedSession),
      });
      ctx.registry.updateSessionMetadata(id, {
        skills: hydrated.skills,
        hydration: hydrated.hydration,
      });
      hydratedSession = ctx.registry.get(id) ?? preparedSession;
      hydratedSession = await refreshSessionModelStateForTarget(ctx, providerTarget, hydratedSession);
      runtime.spawn(
        id,
        hydratedSession.providerName,
        buildSpawnOptions({
          cwd: hydratedSession.cwd,
          workspaceMode: hydratedSession.workspaceMode,
          model: hydratedSession.model,
          modelResolution: hydratedSession.modelResolution,
          instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
          permissionMode: hydratedSession.permissionMode,
          allowedTools: hydratedSession.allowedTools,
        }),
        hydratedSession.providerInstanceId,
        hydratedSession.providerBackend,
      );
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? hydratedSession));
  }

  if (session.providerName === 'cursor') {
    if (!preparedSession.providerSessionId) {
      return c.json({ error: 'No provider session ID to resume' }, 400);
    }

    let hydratedSession = preparedSession;
    try {
      const providerTarget = resolveSessionProviderTarget(ctx.config, preparedSession);
      const hydrated = await hydrateSessionForTarget(ctx, {
        trigger: 'resume',
        sessionId: preparedSession.id,
        providerTarget,
        cwd: preparedSession.cwd,
        workspaceMode: preparedSession.workspaceMode,
        workspaceIsolationMode: resolveSessionWorkspaceIsolationMode(preparedSession),
        existingSkills: preparedSession.skills,
        existingHydration: preparedSession.hydration,
        workspaceSourceCwd: getSessionWorkspaceSourceCwd(preparedSession),
      });
      ctx.registry.updateSessionMetadata(id, {
        skills: hydrated.skills,
        hydration: hydrated.hydration,
      });
      hydratedSession = ctx.registry.get(id) ?? preparedSession;
      hydratedSession = await refreshSessionModelStateForTarget(ctx, providerTarget, hydratedSession);
      await primeCliCompatibility(
        ctx,
        resolveCliProviderTarget(ctx, hydratedSession.providerName, hydratedSession.providerInstanceId),
      );
      runtime.spawn(
        id,
        hydratedSession.providerName,
        buildSpawnOptions({
          cwd: hydratedSession.cwd,
          workspaceMode: hydratedSession.workspaceMode,
          model: hydratedSession.model,
          modelResolution: hydratedSession.modelResolution,
          resumeSessionId: hydratedSession.providerSessionId,
          instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
          permissionMode: hydratedSession.permissionMode,
          allowedTools: hydratedSession.allowedTools,
        }),
        hydratedSession.providerInstanceId,
        'cli',
      );
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? hydratedSession));
  }

  if (session.providerName === 'kiro') {
    if (!preparedSession.providerSessionId) {
      return c.json({ error: 'No provider session ID to resume' }, 400);
    }

    let hydratedSession = preparedSession;
    try {
      const canResume = await getKiroNative(
        ctx,
        preparedSession.providerInstanceId,
      ).canResumeSession(preparedSession.cwd, preparedSession.providerSessionId);
      if (!canResume) {
        return c.json({
          error: 'Kiro can only resume the latest session in a workspace. '
          + 'This discovered session is no longer the newest one in its directory.',
        }, 409);
      }

      const providerTarget = resolveSessionProviderTarget(ctx.config, preparedSession);
      const hydrated = await hydrateSessionForTarget(ctx, {
        trigger: 'resume',
        sessionId: preparedSession.id,
        providerTarget,
        cwd: preparedSession.cwd,
        workspaceMode: preparedSession.workspaceMode,
        workspaceIsolationMode: resolveSessionWorkspaceIsolationMode(preparedSession),
        existingSkills: preparedSession.skills,
        existingHydration: preparedSession.hydration,
        workspaceSourceCwd: getSessionWorkspaceSourceCwd(preparedSession),
      });
      ctx.registry.updateSessionMetadata(id, {
        skills: hydrated.skills,
        hydration: hydrated.hydration,
      });
      hydratedSession = ctx.registry.get(id) ?? preparedSession;
      hydratedSession = await refreshSessionModelStateForTarget(ctx, providerTarget, hydratedSession);
      await primeCliCompatibility(
        ctx,
        resolveCliProviderTarget(ctx, hydratedSession.providerName, hydratedSession.providerInstanceId),
      );
      runtime.spawn(
        id,
        hydratedSession.providerName,
        buildSpawnOptions({
          cwd: hydratedSession.cwd,
          workspaceMode: hydratedSession.workspaceMode,
          model: hydratedSession.model,
          modelResolution: hydratedSession.modelResolution,
          resumeSessionId: hydratedSession.providerSessionId,
          instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
          permissionMode: hydratedSession.permissionMode,
          allowedTools: hydratedSession.allowedTools,
        }),
        hydratedSession.providerInstanceId,
        'cli',
      );
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? hydratedSession));
  }

  if (session.providerName === 'pi') {
    const body = await c.req.json<{
      permissionMode?: 'skip' | 'whitelist' | 'default';
      allowedTools?: string[];
    }>().catch(() => ({}));

    let resumeTarget;
    try {
      resumeTarget = resolvePiResumeTarget(ctx.config, preparedSession);
    } catch (err) {
      return c.json({
        error: err instanceof Error ? err.message : String(err),
      }, 409);
    }

    let permissionMode = (body as { permissionMode?: 'skip' | 'whitelist' | 'default' })
      .permissionMode ?? session.permissionMode ?? 'skip';
    if (preparedSession.workspaceMode === 'read_only') {
      permissionMode = 'default';
    }

    let hydratedSession = preparedSession;
    try {
      const providerTarget = resolveSessionProviderTarget(ctx.config, preparedSession);
      const hydrated = await hydrateSessionForTarget(ctx, {
        trigger: 'resume',
        sessionId: preparedSession.id,
        providerTarget,
        cwd: preparedSession.cwd,
        workspaceMode: preparedSession.workspaceMode,
        workspaceIsolationMode: resolveSessionWorkspaceIsolationMode(preparedSession),
        existingSkills: preparedSession.skills,
        existingHydration: preparedSession.hydration,
        workspaceSourceCwd: getSessionWorkspaceSourceCwd(preparedSession),
      });
      ctx.registry.updateSessionMetadata(id, {
        skills: hydrated.skills,
        hydration: hydrated.hydration,
      });
      hydratedSession = ctx.registry.get(id) ?? preparedSession;
      hydratedSession = await refreshSessionModelStateForTarget(ctx, providerTarget, hydratedSession);
      await primeCliCompatibility(
        ctx,
        resolveCliProviderTarget(ctx, hydratedSession.providerName, hydratedSession.providerInstanceId),
      );
      runtime.spawn(
        id,
        hydratedSession.providerName,
        {
          ...buildSpawnOptions({
            cwd: hydratedSession.cwd,
            workspaceMode: hydratedSession.workspaceMode,
            model: hydratedSession.model,
            modelResolution: hydratedSession.modelResolution,
            instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
            permissionMode,
            allowedTools: (body as { allowedTools?: string[] }).allowedTools
              ?? hydratedSession.allowedTools,
          }),
          resumeSourcePath: resumeTarget.runtimeSourcePath,
        },
        hydratedSession.providerInstanceId,
        'cli',
      );
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? hydratedSession));
  }

  if (!preparedSession.providerSessionId) {
    return c.json({ error: 'No provider session ID to resume' }, 400);
  }

  const caps = runtime.getCapabilities(
    preparedSession.providerName,
    preparedSession.providerInstanceId,
    preparedSession.providerBackend,
  );
  if (!caps.resume) {
    return c.json({ error: `Provider '${preparedSession.providerName}' does not support resume` }, 501);
  }

  const body = await c.req.json<{
    permissionMode?: 'skip' | 'whitelist' | 'default';
    allowedTools?: string[];
  }>().catch(() => ({}));

  // Derive permissionMode from workspaceMode
  let permissionMode = (body as { permissionMode?: 'skip' | 'whitelist' | 'default' })
    .permissionMode ?? 'skip';
  if (preparedSession.workspaceMode === 'read_only') {
    permissionMode = 'default';
  }

  let hydratedSession = preparedSession;
  try {
    const providerTarget = resolveSessionProviderTarget(ctx.config, preparedSession);
    const hydrated = await hydrateSessionForTarget(ctx, {
      trigger: 'resume',
      sessionId: preparedSession.id,
      providerTarget,
      cwd: preparedSession.cwd,
      workspaceMode: preparedSession.workspaceMode,
      workspaceIsolationMode: resolveSessionWorkspaceIsolationMode(preparedSession),
      existingSkills: preparedSession.skills,
      existingHydration: preparedSession.hydration,
      workspaceSourceCwd: getSessionWorkspaceSourceCwd(preparedSession),
    });
    ctx.registry.updateSessionMetadata(id, {
      skills: hydrated.skills,
      hydration: hydrated.hydration,
    });
    hydratedSession = ctx.registry.get(id) ?? preparedSession;
    hydratedSession = await refreshSessionModelStateForTarget(ctx, providerTarget, hydratedSession);
    await primeCliCompatibility(
      ctx,
      hydratedSession.providerBackend === 'cli'
        ? resolveCliProviderTarget(ctx, hydratedSession.providerName, hydratedSession.providerInstanceId)
        : undefined,
    );
    runtime.spawn(
      id,
      hydratedSession.providerName,
      buildSpawnOptions({
        cwd: hydratedSession.cwd,
        workspaceMode: hydratedSession.workspaceMode,
        model: hydratedSession.model,
        modelResolution: hydratedSession.modelResolution,
        resumeSessionId: hydratedSession.providerSessionId,
        instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
        permissionMode,
        allowedTools: (body as { allowedTools?: string[] }).allowedTools
          ?? hydratedSession.allowedTools,
      }),
      hydratedSession.providerInstanceId,
      hydratedSession.providerBackend,
    );
    ctx.registry.updateStatus(id, hydratedSession.providerBackend === 'cli' ? 'initializing' : 'ready');
  } catch (err) {
    return c.json({ error: `Failed to resume: ${err}` }, 500);
  }

  return c.json(serializeSession(ctx, ctx.registry.get(id) ?? hydratedSession));
});

/** POST /sessions/:id/fork — fork a runtime-owned session */
sessionRoutes.post('/sessions/:id/fork', async (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const session = ctx.registry.get(id);
  const runtime = getRuntimeSessionManager(ctx);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const rawBody = await c.req.json<Record<string, unknown>>().catch(
    () => ({} as Record<string, unknown>),
  );
  const parsedSkills = parseRuntimeSkillManifest(rawBody.skills);
  if (parsedSkills.error) {
    return c.json({ error: parsedSkills.error }, 400);
  }
  const body: SessionBranchRequest = {
    mode: rawBody.mode === 'native_fork' || rawBody.mode === 'context_transplant' || rawBody.mode === 'auto'
      ? rawBody.mode
      : undefined,
    provider: parseOptionalString(rawBody.provider),
    instance: parseOptionalString(rawBody.instance),
    model: parseOptionalString(rawBody.model),
    cwd: parseOptionalString(rawBody.cwd),
    workspaceKind: parseWorkspaceKind(rawBody.workspaceKind),
    workspaceAccess: parseWorkspaceAccess(rawBody.workspaceAccess),
    workspaceMode: rawBody.workspaceMode === 'isolated'
      || rawBody.workspaceMode === 'shared'
      || rawBody.workspaceMode === 'read_only'
      ? rawBody.workspaceMode
      : undefined,
    workspaceIsolation: parseWorkspaceIsolationMode(rawBody.workspaceIsolation),
    permissionMode: rawBody.permissionMode === 'skip'
      || rawBody.permissionMode === 'whitelist'
      || rawBody.permissionMode === 'default'
      ? rawBody.permissionMode
      : undefined,
    allowedTools: Array.isArray(rawBody.allowedTools)
      ? rawBody.allowedTools.filter((tool: unknown): tool is string => typeof tool === 'string')
      : undefined,
    group: parseOptionalString(rawBody.group),
    instructions: parseOptionalString(rawBody.instructions),
    skills: parsedSkills.manifest,
    context: parseInvocationContext(rawBody.context),
    outputDir: parseOptionalString(rawBody.outputDir),
    transplant: parseContextTransplant(rawBody.transplant),
  };
  const requestedWorkspaceIsolationMode = body.workspaceIsolation;
  let requestedHydrationMetadata = extractHydrationMetadata(
    body.context,
    parsedSkills.clear ? undefined : body.skills,
  );

  const requestedProviderName = body.provider ?? session.providerName;
  let childTarget: ProviderTargetDescriptor;
  try {
    childTarget = resolveRequestedProviderTarget(
      ctx,
      requestedProviderName,
      selectBranchTargetInstance(session, requestedProviderName, body.instance),
    );
  } catch (err) {
    return c.json({ error: `${err}` }, 400);
  }

  const parentCaps = runtime.getCapabilities(
    session.providerName,
    session.providerInstanceId,
    session.providerBackend,
  );
  const childCaps = runtime.getCapabilities(
    childTarget.providerName,
    childTarget.instanceId,
    childTarget.backend,
  );

  const branchDecision = resolveSessionBranchDecision({
    parentSession: session,
    request: body,
    target: childTarget,
    parentCapabilities: parentCaps,
  });
  if (branchDecision.error) {
    return c.json({
      error: branchDecision.error.message,
      branch: branchDecision,
    }, branchDecision.error.status);
  }
  const branchMode = branchDecision.resolvedMode!;
  const warnings = [...branchDecision.warnings];

  const forkId = randomUUID();
  const parentIsolationMode = resolveSessionWorkspaceIsolationMode(session);
  const requestedWorkspaceContract = resolveRequestedWorkspaceContract({
    workspaceKind: body.workspaceKind,
    workspaceAccess: body.workspaceAccess,
    workspaceMode: body.workspaceMode,
    workspaceIsolation: body.workspaceIsolation,
  });
  const explicitWorkspaceTopologyRequested = body.workspaceKind !== undefined
    || body.workspaceMode !== undefined
    || body.workspaceIsolation !== undefined;
  let forkCwd = session.cwd;
  let forkWorkspaceKind = requestedWorkspaceContract.workspaceKind
    ?? (parentIsolationMode === 'worktree' && !explicitWorkspaceTopologyRequested
      ? 'worktree'
      : resolveSessionWorkspaceKind(session));
  let forkWorkspaceAccess = requestedWorkspaceContract.workspaceAccess
    ?? resolveSessionWorkspaceAccess(session);
  let forkWorkspaceMode = body.workspaceMode ?? session.workspaceMode;
  let forkPermissionMode = body.permissionMode ?? session.permissionMode ?? 'skip';
  let forkWorkspaceIsolationMode = requestedWorkspaceContract.workspaceIsolationMode
    ?? (parentIsolationMode === 'worktree' && !explicitWorkspaceTopologyRequested
      ? 'worktree'
      : undefined);
  let forkPrepared: PrepareSessionWorkspaceResult;
  let usedContextTransplant: SessionContextTransplant | undefined;

  if (branchMode === 'native_fork') {
    if (session.workspaceMode === 'read_only') {
      forkPermissionMode = 'default';
    }
  }

  if (!childCaps.permissions && forkWorkspaceMode === 'read_only') {
    return c.json({
      error: `Provider '${requestedProviderName}' does not support permission enforcement required by read_only workspace`,
      branch: {
        ...branchDecision,
        warnings,
        transplant: summarizeContextTransplant(body.transplant, usedContextTransplant),
      },
    }, 400);
  }
  if (!childCaps.permissions && body.permissionMode && body.permissionMode !== 'skip') {
    warnings.push(
      `Provider '${requestedProviderName}' runs without permission enforcement; `
      + `permissionMode '${body.permissionMode}' is ignored.`,
    );
  }

  try {
    forkPrepared = await prepareSessionWorkspace({
      sessionId: forkId,
      sessionBaseDir: ctx.config.sessionBaseDir,
      cwd: body.cwd ?? getSessionWorkspaceSourceCwd(session) ?? session.cwd,
      workspaceKind: forkWorkspaceKind,
      workspaceAccess: forkWorkspaceAccess,
      workspaceMode: forkWorkspaceMode,
      workspaceIsolationMode: forkWorkspaceIsolationMode,
      permissionMode: forkPermissionMode,
    });
    forkCwd = forkPrepared.cwd;
    forkWorkspaceKind = forkPrepared.workspace.kind;
    forkWorkspaceAccess = forkPrepared.workspace.access;
    forkWorkspaceMode = forkPrepared.workspaceMode;
    forkPermissionMode = forkPrepared.permissionMode;
    forkWorkspaceIsolationMode = forkPrepared.workspaceIsolation.mode;
  } catch (error) {
    return c.json({ error: `${error}` }, 400);
  }

  if (forkPrepared.workspace.kind !== 'source' && session.cwd !== forkCwd) {
    const snapshot = await copyWorkspaceSnapshot(session.cwd, forkCwd, { skipGitMetadata: true });
    requestedHydrationMetadata = mergeStructuredMetadata(
      requestedHydrationMetadata,
      buildWorkspaceSnapshotMetadata(snapshot),
    );
    const snapshotWarning = describeWorkspaceSnapshotWarning(snapshot);
    if (snapshotWarning) {
      warnings.push(snapshotWarning);
    }
  }

  const childLineage = buildChildLineage({
    childSessionId: forkId,
    childProvider: childTarget.providerName,
    parentSession: session,
    branchMode,
  });
  if (branchMode === 'context_transplant') {
    usedContextTransplant = buildDefaultContextTransplant(session, body.transplant);
  }

  const childInstructions = branchMode === 'context_transplant'
    ? buildContextTransplantInstructions(
      body.instructions ?? session.instructions,
      usedContextTransplant!,
    )
    : body.instructions ?? session.instructions;
  const childContext = attachBranchMetadata(
    session.context,
    body.context,
    childLineage,
    usedContextTransplant,
  );
  let childSkills = session.skills;
  let childHydration = session.hydration;
  try {
    const hydrated = await hydrateSessionForTarget(ctx, {
      trigger: 'fork',
      sessionId: forkId,
      providerTarget: childTarget,
      cwd: forkCwd,
      workspace: forkPrepared.workspace,
      workspaceMode: forkWorkspaceMode,
      workspaceIsolationMode: forkWorkspaceIsolationMode,
      requestedSkills: parsedSkills.clear ? undefined : body.skills,
      existingSkills: parsedSkills.clear ? undefined : session.skills,
      existingHydration: session.hydration,
      workspaceSourceCwd: resolveForkWorkspaceSourceCwd(
        session,
        body.cwd,
        forkCwd,
        forkWorkspaceKind,
      ),
      metadata: requestedHydrationMetadata,
    });
    childSkills = hydrated.skills;
    childHydration = hydrated.hydration;
  } catch (error) {
    const runtimeSkillError = toRuntimeSkillErrorResponse(error);
    if (runtimeSkillError) {
      await discardPreparedWorkspace(ctx, {
        id: forkId,
        workspace: forkPrepared.workspace,
        workspaceMode: forkWorkspaceMode,
        workspaceIsolation: forkPrepared.workspaceIsolation,
      });
      return c.json(runtimeSkillError.body, runtimeSkillError.status);
    }
    throw error;
  }

  let childModelState: ResolvedSessionModelState = { warnings: [] };
  try {
    childModelState = body.model
      ? await resolveRequestedSessionModelState(ctx, childTarget, {
        legacyModel: body.model,
      })
      : session.modelSelection && sessionMatchesTarget(session, childTarget)
        ? await resolveRequestedSessionModelState(ctx, childTarget, {
          legacyModel: session.model,
          selection: session.modelSelection,
        })
        : { warnings: [] };
  } catch (error) {
    await discardPreparedWorkspace(ctx, {
      id: forkId,
      workspace: forkPrepared.workspace,
      workspaceMode: forkWorkspaceMode,
      workspaceIsolation: forkPrepared.workspaceIsolation,
    });
    return c.json({
      error: error instanceof Error ? error.message : String(error),
      branch: {
        ...branchDecision,
        warnings,
        transplant: summarizeContextTransplant(body.transplant, usedContextTransplant),
      },
    }, 400);
  }
  if (childModelState.warnings.length > 0) {
    warnings.push(...childModelState.warnings);
  }

  const forked = ctx.registry.create({
    id: forkId,
    providerName: childTarget.providerName,
    providerBackend: childTarget.backend,
    providerInstanceId: childTarget.instanceId,
    cwd: forkCwd,
    workspace: forkPrepared.workspace,
    workspaceMode: forkWorkspaceMode,
    workspaceIsolation: forkPrepared.workspaceIsolation,
    permissionMode: forkPermissionMode,
    allowedTools: body.allowedTools ?? session.allowedTools,
    model: childModelState.model ?? body.model ?? session.model,
    modelSelection: childModelState.modelSelection,
    modelResolution: childModelState.modelResolution,
    group: body.group ?? session.group,
    sessionKey: randomUUID(),
    reusePolicy: 'create_new',
    instructions: childInstructions,
    skills: childSkills,
    hydration: childHydration,
    context: childContext,
    outputDir: body.outputDir ?? session.outputDir,
    artifacts: usedContextTransplant?.artifacts ?? session.artifacts,
  });
  if (branchMode === 'native_fork' && session.providerSessionId) {
    ctx.registry.setProviderSessionId(forked.id, session.providerSessionId);
  }
  if (branchMode === 'native_fork' && session.providerState) {
    ctx.registry.setProviderState(forked.id, session.providerState);
  }
  if (branchMode === 'native_fork') {
    cloneManagedHistoryIfPresent(ctx, session, forked);
  }

  try {
    await primeCliCompatibility(
      ctx,
      childTarget.backend === 'cli' ? childTarget : undefined,
    );
    runtime.spawn(
      forked.id,
      childTarget.providerName,
      buildSpawnOptions({
        cwd: forkCwd,
        workspaceMode: forkWorkspaceMode,
        model: childModelState.model ?? body.model ?? session.model,
        modelResolution: childModelState.modelResolution,
        instructionsFile: childSkills?.delivery.instructions?.filePath,
        ...(branchMode === 'native_fork'
          ? {
              resumeSessionId: session.providerSessionId,
              forkSession: true,
            }
          : {}),
        permissionMode: forkPermissionMode,
        allowedTools: body.allowedTools ?? session.allowedTools,
      }),
      childTarget.instanceId,
      childTarget.backend,
    );
    if (childTarget.backend !== 'cli') {
      ctx.registry.updateStatus(forked.id, 'ready');
    }
  } catch (err) {
    await discardPreparedWorkspace(ctx, {
      id: forkId,
      workspace: forkPrepared.workspace,
      workspaceMode: forkWorkspaceMode,
      workspaceIsolation: forkPrepared.workspaceIsolation,
    });
    ctx.registry.remove(forked.id);
    return c.json({ error: `Failed to fork: ${err}` }, 500);
  }

  const branch = {
    ...branchDecision,
    warnings,
    transplant: summarizeContextTransplant(body.transplant, usedContextTransplant),
  };
  return c.json({
    ...serializeSession(ctx, forked),
    branch,
    ...(warnings.length > 0 ? { warnings } : {}),
  }, 201);
});
