import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Hono } from 'hono';
import {
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
  SessionArtifact,
  SessionBranchCapabilityTruth,
  SessionBranchRequest,
  SessionContextTransplant,
  SessionReusePolicy,
  SessionStatus,
  WorkspaceMode,
} from '../../core/types.js';
import {
  resolveWorkspace,
  cleanupIsolatedWorkspace,
  copyIsolatedWorkspace,
} from '../../backends/cli/pool/workspace.js';
import {
  toSessionView,
  toSessionViews,
} from '../../backends/cli/pool/sessionView.js';
import {
  getCursorNative,
  getGooseNative,
  getKiroNative,
  getOpencodeNative,
} from '../providerServices.js';
import { resolvePiResumeTarget } from '../../backends/cli/pi/resume.js';
import {
  getProviderDefaultTarget,
  listConfiguredProviders,
  resolveProviderTarget,
  type ProviderTargetDescriptor,
} from '../../core/providerCatalog.js';
import { resolveSessionProviderTarget } from '../providerTargets.js';
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
import { hydrateSessionState } from '../../core/hydration/sessionHydration.js';
import {
  extractHydrationMetadata,
  parseInvocationContext,
  parseOptionalString,
  parseRuntimeSkillManifest,
  parseStringArray,
} from '../parsing.js';
import { toRuntimeSkillErrorResponse } from '../runtimeSkillErrors.js';

interface SessionRouteEnv {
  Variables: {
    ctx: AppContext;
  };
}

export const sessionRoutes = new Hono<SessionRouteEnv>();

const REUSE_POLICIES = new Set<SessionReusePolicy>([
  'create_new',
  'prefer_existing',
  'require_existing',
]);

type NativeCleanupResult = boolean | 'stale_config';

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

function serializeSession(ctx: AppContext, session: SessionInfo) {
  const runtime = getRuntimeSessionManager(ctx);
  const view = toSessionView(session, {
    attached: runtime.isAttached(session.id),
    externalSessionLiveWindowMs: ctx.config.externalSessionLiveWindowMs,
  });
  const lineage = getSessionLineage(session);
  const branching = resolveSessionBranching(ctx, session);
  const wakeup = ctx.wakeup?.getSessionWakeState(session.id);
  const inspection = buildSessionInspection({
    session,
    view,
    trackedState: runtime.getTrackedState(session.id),
    metering: getRuntimeMeteringService(ctx).buildSessionSnapshot(session),
  });
  return {
    ...view,
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
    const lineage = getSessionLineage(sessions[index]);
    const branching = resolveSessionBranching(ctx, sessions[index], {
      includeCapabilities: options.includeBranchCapabilities,
    });
    const wakeup = ctx.wakeup?.getSessionWakeState(sessions[index].id);
    return {
      ...view,
      inspection: buildSessionInspection({
        session: sessions[index],
        view,
        trackedState: runtime.getTrackedState(sessions[index].id),
        metering: metering.buildSessionSnapshot(sessions[index]),
      }),
      branching,
      ...(wakeup ? { wakeup } : {}),
      ...(lineage ? { lineage } : {}),
    };
  });
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
  session: Pick<SessionInfo, 'cwd' | 'workspaceMode' | 'hydration'>,
): string | undefined {
  return session.hydration?.workspace.sourceCwd
    ?? (session.workspaceMode === 'isolated' ? undefined : session.cwd);
}

function resolveForkWorkspaceSourceCwd(
  session: Pick<SessionInfo, 'cwd' | 'workspaceMode' | 'hydration'>,
  requestedCwd: string | undefined,
  forkCwd: string,
  forkWorkspaceMode: WorkspaceMode | undefined,
): string | undefined {
  if (forkWorkspaceMode === 'isolated') {
    return requestedCwd ?? getSessionWorkspaceSourceCwd(session);
  }

  return requestedCwd ?? getSessionWorkspaceSourceCwd(session) ?? forkCwd;
}

async function hydrateSessionForTarget(
  ctx: AppContext,
  options: {
    trigger: 'create' | 'resume' | 'fork' | 'message';
    sessionId: string;
    providerTarget: ProviderTargetDescriptor;
    cwd: string;
    workspaceMode?: WorkspaceMode;
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
    workspaceMode: options.workspaceMode,
    sessionBaseDir: ctx.config.sessionBaseDir,
    requestedSkills: options.requestedSkills,
    existingSkills: options.existingSkills,
    requestedWorkspaceSourceCwd: options.workspaceSourceCwd,
    existingHydration: options.existingHydration,
    baseInstructionsFile: options.providerTarget.cliInstance?.piInstructionsFile,
    metadata: options.metadata,
  });
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
      const deleted = await cursorNative.deleteSession(session.cwd, session.providerSessionId);
      if (!deleted) return false;
      const remaining = await cursorNative.listSessions(
        session.cwd,
        { startIfNeeded: false },
      );
      return !remaining.some((item) => item.providerSessionId === session.providerSessionId);
    }

    if (session.providerName === 'kiro') {
      const kiroNative = getKiroNative(ctx, session.providerInstanceId);
      const deleted = await kiroNative.deleteSession(session.cwd, session.providerSessionId);
      if (!deleted) return false;
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
      const deleted = await opencodeNative.deleteSession(session.cwd, session.providerSessionId);
      if (!deleted) return false;
      const remaining = await opencodeNative.getSession(session.cwd, session.providerSessionId);
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

/** POST /sessions — create a new runtime-owned session */
sessionRoutes.post('/sessions', async (c) => {
  const ctx = c.get('ctx');
  const body = await c.req.json<{
    provider?: string;
    instance?: string;
    cwd?: string;
    model?: string;
    group?: string;
    workspaceMode?: WorkspaceMode;
    managed?: boolean;
    permissionMode?: 'skip' | 'whitelist' | 'default';
    allowedTools?: string[];
    sessionKey?: string;
    reusePolicy?: SessionReusePolicy;
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

  if (reusePolicy !== 'create_new' && requestedSessionKey) {
    const existing = findReusableSession(ctx, providerTarget, providerName, requestedSessionKey);
    if (!existing) {
      if (reusePolicy === 'require_existing') {
        return c.json({
          error: `No existing ${providerName} session found for sessionKey '${requestedSessionKey}'`,
        }, 409);
      }
    } else {
      if (
        (body.cwd && existing.cwd !== body.cwd)
        || (body.model && existing.model && body.model !== existing.model)
      ) {
        return c.json({
          error: 'Existing sessionKey matches a session with different cwd/model. '
            + 'Use reusePolicy=create_new to force a new session.',
        }, 409);
      }

      let skills = existing.skills;
      let hydration = existing.hydration;
      try {
        const hydrated = await hydrateSessionForTarget(ctx, {
          trigger: 'create',
          sessionId: existing.id,
          providerTarget,
          cwd: existing.cwd,
          workspaceMode: existing.workspaceMode,
          requestedSkills: parsedSkills.clear ? undefined : parsedSkills.manifest,
          existingSkills: parsedSkills.clear ? undefined : existing.skills,
          existingHydration: existing.hydration,
          workspaceSourceCwd: getSessionWorkspaceSourceCwd(existing),
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
        sessionKey,
        reusePolicy,
        instructions: instructions ?? existing.instructions,
        skills,
        hydration,
        context: context ?? existing.context,
        outputDir: outputDir ?? existing.outputDir,
      });

      const existingHandle = runtime.get(existing.id);
      if (!existingHandle?.active) {
        if (existing.providerBackend === 'cli') {
          return c.json({
            error: 'Explicit sessionKey reuse currently supports api/local/agent sessions only. '
              + 'Use /sessions/:id/resume for CLI sessions.',
          }, 409);
        }

        try {
          runtime.spawn(existing.id, existing.providerName, {
            cwd: existing.cwd,
            workspaceMode: existing.workspaceMode,
            model: existing.model,
            instructionsFile: existing.skills?.delivery.instructions?.filePath,
            permissionMode: existing.permissionMode,
            allowedTools: existing.allowedTools,
          }, existing.providerInstanceId, existing.providerBackend);
          ctx.registry.updateStatus(existing.id, 'ready');
        } catch (err) {
          return c.json({ error: `Failed to reuse session: ${err}` }, 500);
        }
      }

      return c.json(serializeSession(ctx, ctx.registry.get(existing.id) ?? existing));
    }
  }

  const sessionId = randomUUID();

  let resolved;
  try {
    resolved = resolveWorkspace({
      sessionId,
      sessionBaseDir: ctx.config.sessionBaseDir,
      cwd: body.cwd || undefined,
      workspaceMode: body.workspaceMode,
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
      workspaceMode: resolved.workspaceMode,
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
      if (resolved.workspaceMode === 'isolated') {
        cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, sessionId);
      }
      return c.json(runtimeSkillError.body, runtimeSkillError.status);
    }
    throw error;
  }

  if (providerName === 'cursor' && providerTarget.backend === 'cli') {
    const caps = runtime.getCapabilities('cursor', providerInstance!.id, 'cli');
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
      return c.json({
        error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
      }, 400);
    }

    let nativeProviderSessionId: string | null = null;
    try {
      const native = await getCursorNative(ctx, providerInstance!.id).createSession(resolved.cwd);
      nativeProviderSessionId = native.providerSessionId;
      const session = ctx.registry.create({
        id: sessionId,
        providerName: 'cursor',
        providerBackend: 'cli',
        providerInstanceId: providerInstance!.id,
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
        model: body.model || native.model,
        group: body.group,
        sessionKey,
        reusePolicy,
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
      runtime.spawn(session.id, providerName, {
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model || native.model,
        resumeSessionId: native.providerSessionId,
        instructionsFile: skills?.delivery.instructions?.filePath,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
      }, providerInstance!.id, 'cli');
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
      if (resolved.workspaceMode === 'isolated') {
        cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, sessionId);
      }
      return c.json({ error: `Failed to create Cursor session: ${err}` }, 500);
    }
  }

  if (providerName === 'opencode' && providerTarget.backend === 'cli') {
    const caps = runtime.getCapabilities('opencode', providerInstance!.id, 'cli');
    if (!caps.permissions && resolved.workspaceMode === 'read_only') {
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
        workspaceMode: resolved.workspaceMode,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
        model: body.model,
        group: body.group,
        sessionKey,
        reusePolicy,
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
      runtime.spawn(session.id, providerName, {
        cwd: resolved.cwd,
        workspaceMode: resolved.workspaceMode,
        model: body.model,
        resumeSessionId: native.providerSessionId,
        instructionsFile: skills?.delivery.instructions?.filePath,
        permissionMode: resolved.permissionMode,
        allowedTools: body.allowedTools,
      }, providerInstance!.id, 'cli');
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
      if (resolved.workspaceMode === 'isolated') {
        cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, sessionId);
      }
      return c.json({ error: `Failed to create OpenCode session: ${err}` }, 500);
    }
  }

  const caps = runtime.getCapabilities(
    providerName,
    providerTarget.instanceId,
    providerTarget.backend,
  );

  if (!caps.permissions && resolved.workspaceMode === 'read_only') {
    return c.json({
      error: `Provider '${providerName}' does not support permission enforcement required by read_only workspace`,
    }, 400);
  }

  const warnings: string[] = [];
  if (!caps.permissions && body.permissionMode && body.permissionMode !== 'skip') {
    warnings.push(`Provider '${providerName}' runs in full-auto mode; permissionMode '${body.permissionMode}' is ignored`);
  }

  const session = ctx.registry.create({
    id: sessionId,
    providerName,
    providerBackend: providerTarget.backend,
    providerInstanceId: providerTarget.instanceId,
    cwd: resolved.cwd,
    workspaceMode: resolved.workspaceMode,
    permissionMode: resolved.permissionMode,
    allowedTools: body.allowedTools,
    model: body.model,
    group: body.group,
    sessionKey,
    reusePolicy,
    instructions,
    skills,
    hydration,
    context,
    outputDir,
  });

  try {
    await primeCliCompatibility(ctx, providerTarget);
    runtime.spawn(session.id, providerName, {
      cwd: resolved.cwd,
      workspaceMode: resolved.workspaceMode,
      model: body.model,
      instructionsFile: skills?.delivery.instructions?.filePath,
      permissionMode: resolved.permissionMode,
      allowedTools: body.allowedTools,
    }, providerTarget.instanceId, providerTarget.backend);
  } catch (err) {
    if (resolved.workspaceMode === 'isolated') {
      cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, sessionId);
    }
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
    ctx.registry.updateStatus(id, 'closed');
    runtime.markClosed(id);
    return c.json(serializeLifecycleSession(ctx, ctx.registry.get(id) ?? session, 'close'));
  }

  ctx.registry.updateStatus(id, 'closing');
  await runtime.close(session, 'close');
  if (!runtime.isAttached(id)) {
    ctx.registry.updateStatus(id, 'closed');
  }
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
  if (worker?.active) {
    ctx.registry.updateStatus(id, 'closing');
    await runtime.close(session, 'reset');
  }

  ctx.registry.clearProviderResumeState(id);
  ctx.registry.setProviderState(id, undefined);
  ctx.registry.updateStatus(id, 'closed');
  runtime.clearProviderState(id);
  runtime.markClosed(id);
  ctx.wakeup?.clearSession(id);
  return c.json(serializeLifecycleSession(ctx, ctx.registry.get(id) ?? session, 'reset'));
});

/** DELETE /sessions/:id — permanently remove session and delete .jsonl */
sessionRoutes.delete('/sessions/:id', async (c) => {
  const ctx = c.get('ctx');
  const id = c.req.param('id');
  const session = ctx.registry.get(id);

  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const view = serializeSession(ctx, session);
  if (!view.controls.canDelete) {
    return c.json({
      error: 'This session is still active outside cats-runtime or is already closing. Wait before deleting it.',
    }, 409);
  }

  const preparedManagedTranscripts = ctx.registry.prepareManagedTranscriptDeletion(id);
  const preparedProviderDiscovery = prepareProviderDiscoveryDeletion(ctx, session);
  const hasNativeSessionState = tracksNativeSessionState(session);
  const hasProviderDiscoveryState = tracksProviderDiscoveryState(session);
  const hadTranscript = preparedManagedTranscripts.hadFiles
    || preparedProviderDiscovery.hadFiles
    || hasNativeSessionState
    || hasProviderDiscoveryState;

  if (!preparedManagedTranscripts.ready || !preparedProviderDiscovery.ready) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    return c.json({
      status: 'retained',
      hadTranscript,
      fileDeleted: false,
      nativeDeleted: false,
      reason: 'Session files are locked or in use. Nothing was removed.',
    });
  }

  let nativeDeleted: NativeCleanupResult = false;
  try {
    if (hasNativeSessionState) {
      nativeDeleted = await deleteNativeSessionState(ctx, session);
    }
  } catch (err) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    return c.json({ error: `Failed to delete native ${session.providerName} session: ${err}` }, 500);
  }

  let providerDiscoveryDeleted = false;
  try {
    if (hasProviderDiscoveryState) {
      providerDiscoveryDeleted = await verifyProviderDiscoveryStateDeleted(ctx, session);
    }
  } catch (err) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    return c.json({
      error: `Failed to verify ${session.providerName} discovery cleanup: ${err}`,
    }, 500);
  }

  const nativeCleanupSucceeded = !hasNativeSessionState
    || nativeDeleted === true
    || nativeDeleted === 'stale_config';
  const providerDiscoveryCleanupSucceeded = !hasProviderDiscoveryState || providerDiscoveryDeleted;
  if (!nativeCleanupSucceeded || !providerDiscoveryCleanupSucceeded) {
    preparedManagedTranscripts.rollback();
    preparedProviderDiscovery.rollback();
    return c.json({
      status: 'retained',
      hadTranscript,
      fileDeleted: false,
      nativeDeleted: false,
      reason: 'Session cleanup could not be verified. Nothing was removed.',
    });
  }

  const runtime = getRuntimeSessionManager(ctx);
  const worker = runtime.get(id);
  if (worker?.active) {
    try {
      await runtime.close(session, 'delete');
      ctx.registry.updateStatus(id, 'closed');
    } catch (err) {
      preparedManagedTranscripts.rollback();
      preparedProviderDiscovery.rollback();
      return c.json({ error: `Failed to close session before delete: ${err}` }, 500);
    }
  }

  const managedDeletion = preparedManagedTranscripts.finalize();
  const providerDeletion = preparedProviderDiscovery.finalize();
  let workspaceCleaned = false;
  if (session.workspaceMode === 'isolated') {
    workspaceCleaned = cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, id);
  }
  ctx.wakeup?.clearSession(id);
  ctx.registry.unregister(id);
  runtime.dropSession(id);
  ctx.registry.flush();
  return c.json({
    action: 'delete',
    sessionId: id,
    status: 'deleted',
    hadTranscript,
    fileDeleted: managedDeletion.fileDeleted || providerDeletion.fileDeleted,
    nativeDeleted: hasNativeSessionState ? nativeDeleted === true : false,
    workspaceCleaned,
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

  if (session.providerBackend !== 'cli') {
    let hydratedSession = session;
    try {
      const providerTarget = resolveSessionProviderTarget(ctx.config, session);
      const hydrated = await hydrateSessionForTarget(ctx, {
        trigger: 'resume',
        sessionId: session.id,
        providerTarget,
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        existingSkills: session.skills,
        existingHydration: session.hydration,
        workspaceSourceCwd: getSessionWorkspaceSourceCwd(session),
      });
      ctx.registry.updateSessionMetadata(id, {
        skills: hydrated.skills,
        hydration: hydrated.hydration,
      });
      hydratedSession = ctx.registry.get(id) ?? session;
      runtime.spawn(id, hydratedSession.providerName, {
        cwd: hydratedSession.cwd,
        workspaceMode: hydratedSession.workspaceMode,
        model: hydratedSession.model,
        instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
        permissionMode: hydratedSession.permissionMode,
        allowedTools: hydratedSession.allowedTools,
      }, hydratedSession.providerInstanceId, hydratedSession.providerBackend);
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? hydratedSession));
  }

  if (session.providerName === 'cursor') {
    if (!session.providerSessionId) {
      return c.json({ error: 'No provider session ID to resume' }, 400);
    }

    let hydratedSession = session;
    try {
      const providerTarget = resolveSessionProviderTarget(ctx.config, session);
      const hydrated = await hydrateSessionForTarget(ctx, {
        trigger: 'resume',
        sessionId: session.id,
        providerTarget,
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        existingSkills: session.skills,
        existingHydration: session.hydration,
        workspaceSourceCwd: getSessionWorkspaceSourceCwd(session),
      });
      ctx.registry.updateSessionMetadata(id, {
        skills: hydrated.skills,
        hydration: hydrated.hydration,
      });
      hydratedSession = ctx.registry.get(id) ?? session;
      await primeCliCompatibility(
        ctx,
        resolveCliProviderTarget(ctx, hydratedSession.providerName, hydratedSession.providerInstanceId),
      );
      runtime.spawn(id, hydratedSession.providerName, {
        cwd: hydratedSession.cwd,
        workspaceMode: hydratedSession.workspaceMode,
        model: hydratedSession.model,
        resumeSessionId: hydratedSession.providerSessionId,
        instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
        permissionMode: hydratedSession.permissionMode,
        allowedTools: hydratedSession.allowedTools,
      }, hydratedSession.providerInstanceId, 'cli');
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? hydratedSession));
  }

  if (session.providerName === 'kiro') {
    if (!session.providerSessionId) {
      return c.json({ error: 'No provider session ID to resume' }, 400);
    }

    let hydratedSession = session;
    try {
      const canResume = await getKiroNative(
        ctx,
        session.providerInstanceId,
      ).canResumeSession(session.cwd, session.providerSessionId);
      if (!canResume) {
        return c.json({
          error: 'Kiro can only resume the latest session in a workspace. '
          + 'This discovered session is no longer the newest one in its directory.',
        }, 409);
      }

      const providerTarget = resolveSessionProviderTarget(ctx.config, session);
      const hydrated = await hydrateSessionForTarget(ctx, {
        trigger: 'resume',
        sessionId: session.id,
        providerTarget,
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        existingSkills: session.skills,
        existingHydration: session.hydration,
        workspaceSourceCwd: getSessionWorkspaceSourceCwd(session),
      });
      ctx.registry.updateSessionMetadata(id, {
        skills: hydrated.skills,
        hydration: hydrated.hydration,
      });
      hydratedSession = ctx.registry.get(id) ?? session;
      await primeCliCompatibility(
        ctx,
        resolveCliProviderTarget(ctx, hydratedSession.providerName, hydratedSession.providerInstanceId),
      );
      runtime.spawn(id, hydratedSession.providerName, {
        cwd: hydratedSession.cwd,
        workspaceMode: hydratedSession.workspaceMode,
        model: hydratedSession.model,
        resumeSessionId: hydratedSession.providerSessionId,
        instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
        permissionMode: hydratedSession.permissionMode,
        allowedTools: hydratedSession.allowedTools,
      }, hydratedSession.providerInstanceId, 'cli');
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
      resumeTarget = resolvePiResumeTarget(ctx.config, session);
    } catch (err) {
      return c.json({
        error: err instanceof Error ? err.message : String(err),
      }, 409);
    }

    let permissionMode = (body as { permissionMode?: 'skip' | 'whitelist' | 'default' })
      .permissionMode ?? session.permissionMode ?? 'skip';
    if (session.workspaceMode === 'read_only') {
      permissionMode = 'default';
    }

    let hydratedSession = session;
    try {
      const providerTarget = resolveSessionProviderTarget(ctx.config, session);
      const hydrated = await hydrateSessionForTarget(ctx, {
        trigger: 'resume',
        sessionId: session.id,
        providerTarget,
        cwd: session.cwd,
        workspaceMode: session.workspaceMode,
        existingSkills: session.skills,
        existingHydration: session.hydration,
        workspaceSourceCwd: getSessionWorkspaceSourceCwd(session),
      });
      ctx.registry.updateSessionMetadata(id, {
        skills: hydrated.skills,
        hydration: hydrated.hydration,
      });
      hydratedSession = ctx.registry.get(id) ?? session;
      await primeCliCompatibility(
        ctx,
        resolveCliProviderTarget(ctx, hydratedSession.providerName, hydratedSession.providerInstanceId),
      );
      runtime.spawn(id, hydratedSession.providerName, {
        cwd: hydratedSession.cwd,
        workspaceMode: hydratedSession.workspaceMode,
        model: hydratedSession.model,
        resumeSourcePath: resumeTarget.runtimeSourcePath,
        instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
        permissionMode,
        allowedTools: (body as { allowedTools?: string[] }).allowedTools ?? hydratedSession.allowedTools,
      }, hydratedSession.providerInstanceId, 'cli');
      ctx.registry.updateStatus(id, 'ready');
    } catch (err) {
      return c.json({ error: `Failed to resume: ${err}` }, 500);
    }

    return c.json(serializeSession(ctx, ctx.registry.get(id) ?? hydratedSession));
  }

  if (!session.providerSessionId) {
    return c.json({ error: 'No provider session ID to resume' }, 400);
  }

  const caps = runtime.getCapabilities(
    session.providerName,
    session.providerInstanceId,
    session.providerBackend,
  );
  if (!caps.resume) {
    return c.json({ error: `Provider '${session.providerName}' does not support resume` }, 501);
  }

  const body = await c.req.json<{
    permissionMode?: 'skip' | 'whitelist' | 'default';
    allowedTools?: string[];
  }>().catch(() => ({}));

  // Derive permissionMode from workspaceMode
  let permissionMode = (body as { permissionMode?: 'skip' | 'whitelist' | 'default' })
    .permissionMode ?? 'skip';
  if (session.workspaceMode === 'read_only') {
    permissionMode = 'default';
  }

  let hydratedSession = session;
  try {
    const providerTarget = resolveSessionProviderTarget(ctx.config, session);
    const hydrated = await hydrateSessionForTarget(ctx, {
      trigger: 'resume',
      sessionId: session.id,
      providerTarget,
      cwd: session.cwd,
      workspaceMode: session.workspaceMode,
      existingSkills: session.skills,
      existingHydration: session.hydration,
      workspaceSourceCwd: getSessionWorkspaceSourceCwd(session),
    });
    ctx.registry.updateSessionMetadata(id, {
      skills: hydrated.skills,
      hydration: hydrated.hydration,
    });
    hydratedSession = ctx.registry.get(id) ?? session;
    await primeCliCompatibility(
      ctx,
      hydratedSession.providerBackend === 'cli'
        ? resolveCliProviderTarget(ctx, hydratedSession.providerName, hydratedSession.providerInstanceId)
        : undefined,
    );
    runtime.spawn(id, hydratedSession.providerName, {
      cwd: hydratedSession.cwd,
      workspaceMode: hydratedSession.workspaceMode,
      model: hydratedSession.model,
      resumeSessionId: hydratedSession.providerSessionId,
      instructionsFile: hydratedSession.skills?.delivery.instructions?.filePath,
      permissionMode,
      allowedTools: (body as { allowedTools?: string[] }).allowedTools ?? hydratedSession.allowedTools,
    }, hydratedSession.providerInstanceId, hydratedSession.providerBackend);
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
    workspaceMode: rawBody.workspaceMode === 'isolated'
      || rawBody.workspaceMode === 'shared'
      || rawBody.workspaceMode === 'read_only'
      ? rawBody.workspaceMode
      : undefined,
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
  const requestedHydrationMetadata = extractHydrationMetadata(
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
  let forkCwd = session.cwd;
  let forkWorkspaceMode = body.workspaceMode ?? session.workspaceMode;
  let forkPermissionMode = body.permissionMode ?? session.permissionMode ?? 'skip';
  let usedContextTransplant: SessionContextTransplant | undefined;

  if (branchMode === 'native_fork') {
    if (session.workspaceMode === 'isolated') {
      const resolved = resolveWorkspace({
        sessionId: forkId,
        sessionBaseDir: ctx.config.sessionBaseDir,
        workspaceMode: 'isolated',
      });
      copyIsolatedWorkspace(ctx.config.sessionBaseDir, id, forkId);
      forkCwd = resolved.cwd;
      forkWorkspaceMode = resolved.workspaceMode;
      forkPermissionMode = resolved.permissionMode;
    } else if (session.workspaceMode === 'read_only') {
      forkPermissionMode = 'default';
    }
  } else {
    const resolved = resolveWorkspace({
      sessionId: forkId,
      sessionBaseDir: ctx.config.sessionBaseDir,
      cwd: body.cwd ?? (forkWorkspaceMode === 'isolated'
        ? undefined
        : getSessionWorkspaceSourceCwd(session) ?? session.cwd),
      workspaceMode: forkWorkspaceMode,
      permissionMode: forkPermissionMode,
    });
    forkCwd = resolved.cwd;
    forkWorkspaceMode = resolved.workspaceMode;
    forkPermissionMode = resolved.permissionMode;

    if (session.workspaceMode === 'isolated' && forkWorkspaceMode === 'isolated') {
      copyIsolatedWorkspace(ctx.config.sessionBaseDir, id, forkId);
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
      workspaceMode: forkWorkspaceMode,
      requestedSkills: parsedSkills.clear ? undefined : body.skills,
      existingSkills: parsedSkills.clear ? undefined : session.skills,
      existingHydration: session.hydration,
      workspaceSourceCwd: resolveForkWorkspaceSourceCwd(
        session,
        body.cwd,
        forkCwd,
        forkWorkspaceMode,
      ),
      metadata: requestedHydrationMetadata,
    });
    childSkills = hydrated.skills;
    childHydration = hydrated.hydration;
  } catch (error) {
    const runtimeSkillError = toRuntimeSkillErrorResponse(error);
    if (runtimeSkillError) {
      if (forkWorkspaceMode === 'isolated') {
        cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, forkId);
      }
      return c.json(runtimeSkillError.body, runtimeSkillError.status);
    }
    throw error;
  }

  const forked = ctx.registry.create({
    id: forkId,
    providerName: childTarget.providerName,
    providerBackend: childTarget.backend,
    providerInstanceId: childTarget.instanceId,
    cwd: forkCwd,
    workspaceMode: forkWorkspaceMode,
    permissionMode: forkPermissionMode,
    allowedTools: body.allowedTools ?? session.allowedTools,
    model: body.model ?? session.model,
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
    runtime.spawn(forked.id, childTarget.providerName, {
      cwd: forkCwd,
      workspaceMode: forkWorkspaceMode,
      model: body.model ?? session.model,
      instructionsFile: childSkills?.delivery.instructions?.filePath,
      ...(branchMode === 'native_fork'
        ? {
            resumeSessionId: session.providerSessionId,
            forkSession: true,
          }
        : {}),
      permissionMode: forkPermissionMode,
      allowedTools: body.allowedTools ?? session.allowedTools,
    }, childTarget.instanceId, childTarget.backend);
    if (childTarget.backend !== 'cli') {
      ctx.registry.updateStatus(forked.id, 'ready');
    }
  } catch (err) {
    if (forkWorkspaceMode === 'isolated') {
      cleanupIsolatedWorkspace(ctx.config.sessionBaseDir, forkId);
    }
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
