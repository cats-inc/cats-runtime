import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type {
  PermissionMode,
  ProviderModelResolution,
  ProviderModelSelection,
  RuntimeExecutionStrategyId,
  RuntimeExecutionStrategyState,
  SessionWorkspaceState,
  SessionArtifact,
  SessionHydrationState,
  SessionInfo,
  SessionInvocationContext,
  RuntimeSessionMaintenanceState,
  SessionProviderState,
  SessionReusePolicy,
  SessionSkillState,
  SessionStatus,
  StreamUsage,
  SessionWorkspaceIsolationState,
  WorkspaceAccess,
  WorkspaceKind,
} from './types.js';
import type { ProviderDefaultTarget } from '../config.js';
import { normalizeSessionOrigin } from './sessionView.js';
import {
  toLegacyWorkspaceIsolationState,
  toLegacyWorkspaceMode,
} from '../../../core/workspace/legacyWorkspace.js';
import {
  cloneRuntimeExecutionStrategyState,
  mergeRuntimeExecutionStrategyStates,
  readRuntimeExecutionStrategyState,
} from '../../../core/runtime/strategies/state.js';

function isMissingPersistencePathError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (
      (error as NodeJS.ErrnoException).code === 'ENOENT'
      || (error as NodeJS.ErrnoException).code === 'ENOTDIR'
    );
}

export interface CreateSessionInput {
  id?: string;
  providerName: string;
  providerBackend?: 'cli' | 'api' | 'local' | 'agent';
  providerInstanceId?: string;
  cwd: string;
  workspace?: SessionWorkspaceState;
  workspaceMode?: LegacyWorkspaceMode;
  workspaceIsolation?: LegacyWorkspaceIsolationState;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  model?: string;
  modelSelection?: ProviderModelSelection;
  modelResolution?: ProviderModelResolution;
  group?: string;
  sessionKey?: string;
  reusePolicy?: SessionReusePolicy;
  strategy?: RuntimeExecutionStrategyState;
  instructions?: string;
  skills?: SessionSkillState;
  hydration?: SessionHydrationState;
  context?: SessionInvocationContext;
  outputDir?: string;
  artifacts?: SessionArtifact[];
}

interface DiscoveredSessionData {
  cwd: string;
  providerName: string;
  providerBackend?: 'cli' | 'api' | 'local' | 'agent';
  providerInstanceId?: string;
  summary?: string;
  lastInputPreview?: string;
  messageCount?: number;
  lastActivity?: string;
  model?: string;
  sourcePath?: string;
  group?: string;
  workspace?: SessionWorkspaceState;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  sessionKey?: string;
  reusePolicy?: SessionReusePolicy;
  strategy?: RuntimeExecutionStrategyState;
  instructions?: string;
  skills?: SessionSkillState;
  context?: SessionInvocationContext;
  outputDir?: string;
  artifacts?: SessionArtifact[];
}

export interface PreparedFileDeletion {
  hadFiles: boolean;
  ready: boolean;
  finalize(): { fileDeleted: boolean };
  rollback(): void;
}

interface StagedTranscriptArtifact {
  originalPath: string;
  stagedPath: string;
  cleanupDir: string;
}

type LegacyWorkspaceMode = 'isolated' | 'shared' | 'read_only';
type LegacyWorkspaceIsolationMode = 'shared' | 'isolated' | 'worktree';

interface LegacyWorkspaceIsolationState {
  mode: LegacyWorkspaceIsolationMode;
  sourceCwd?: string;
  worktree?: SessionWorkspaceState['worktree'];
}

type PersistedSessionRecord = SessionInfo & {
  workspaceMode?: LegacyWorkspaceMode;
  workspaceIsolation?: LegacyWorkspaceIsolationState;
  requestedStrategy?: RuntimeExecutionStrategyId;
  acceptanceCriteria?: string;
  strategyContext?: Record<string, unknown>;
  correlation?: Record<string, unknown>;
  effectiveStrategy?: RuntimeExecutionStrategyId;
  strategyState?: RuntimeExecutionStrategyState;
};

export class SessionRegistry {
  private sessions = new Map<string, SessionInfo>();
  private pendingDiscovered = new Map<string, DiscoveredSessionData>();
  private providerDiscoverySourcePaths = new Map<string, string>();
  private persistPath: string | null = null;
  private providerDiscoveryPersistPath: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    dataDir?: string,
    private sessionBaseDir?: string,
    private providerDefaultInstances: Record<string, string> = {},
    private providerDefaultTargets: Record<string, ProviderDefaultTarget> = {},
  ) {
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      this.persistPath = join(dataDir, 'sessions.json');
      this.providerDiscoveryPersistPath = join(dataDir, 'provider-discovery-source-paths.json');
      this.load();
    }
  }

  private load(): void {
    if (!this.persistPath) return;
    try {
      const raw = readFileSync(this.persistPath, 'utf-8');
      const arr = JSON.parse(raw) as PersistedSessionRecord[];
      const loadedByProviderSession = new Map<string, SessionInfo>();
      let migrated = false;

      for (const loaded of arr) {
        const {
          requestedStrategy: _requestedStrategy,
          acceptanceCriteria: _acceptanceCriteria,
          strategyContext: _strategyContext,
          correlation: _correlation,
          effectiveStrategy: _effectiveStrategy,
          strategyState: _strategyState,
          ...loadedSession
        } = loaded;
        // All sessions come back as closed (no live worker)
        const s: SessionInfo = {
          ...loadedSession,
          status: 'closed',
          origin: normalizeSessionOrigin(loaded, this.sessionBaseDir),
          providerBackend: this.normalizeProviderBackend(
            loaded.providerName,
            loaded.providerBackend,
          ),
          providerInstanceId: this.normalizeProviderInstanceId(
            loaded.providerName,
            loaded.providerInstanceId,
          ),
          workspace: normalizeWorkspaceState({
            cwd: loaded.cwd,
            workspace: loaded.workspace,
            legacyWorkspaceMode: loaded.workspaceMode,
            legacyWorkspaceIsolation: loaded.workspaceIsolation,
          }),
          strategy: coercePersistedSessionStrategyState(loaded),
          totalPromptInputTokens: loaded.totalPromptInputTokens ?? 0,
          totalCacheReadInputTokens: loaded.totalCacheReadInputTokens ?? 0,
          totalCacheCreationInputTokens: loaded.totalCacheCreationInputTokens ?? 0,
        };
        s.workspaceMode = toLegacyWorkspaceMode(s.workspace.kind, s.workspace.access);
        s.workspaceIsolation = toLegacyWorkspaceIsolationState(s.workspace);
        if (
          s.providerInstanceId !== loaded.providerInstanceId
          || s.providerBackend !== loaded.providerBackend
          || s.origin !== loaded.origin
        ) {
          migrated = true;
        }
        if (
          loaded.workspaceMode !== undefined
          || loaded.workspaceIsolation !== undefined
          || JSON.stringify(loaded.workspace) !== JSON.stringify(s.workspace)
        ) {
          migrated = true;
        }
        if (
          loaded.requestedStrategy !== undefined
          || loaded.acceptanceCriteria !== undefined
          || loaded.strategyContext !== undefined
          || loaded.correlation !== undefined
          || loaded.effectiveStrategy !== undefined
          || loaded.strategyState !== undefined
        ) {
          migrated = true;
        }

        if (s.providerSessionId) {
          const key = this.discoveredKey(
            s.providerName,
            s.providerSessionId,
            s.providerBackend,
            s.providerInstanceId,
          );
          const existing = loadedByProviderSession.get(key);
          if (existing) {
            this.mergeLoadedDuplicate(existing, s);
            migrated = true;
            continue;
          }
          loadedByProviderSession.set(key, s);
        }

        this.sessions.set(s.id, s);
      }
      if (this.loadProviderDiscoverySourcePaths()) {
        migrated = true;
      }
      if (this.seedProviderDiscoverySourcePathsFromSessions()) {
        migrated = true;
      }
      if (this.pruneProviderDiscoverySourcePaths()) {
        migrated = true;
      }
      if (migrated) {
        this.saveToDisk();
      }
      console.log(`[registry] Loaded ${arr.length} session(s) from disk`);
    } catch {
      // No file or corrupt — start fresh
    }
  }

  private scheduleSave(): void {
    if (!this.persistPath) return;
    if (this.saveTimer) return; // already scheduled
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToDisk();
    }, 1000);
  }

  private saveToDisk(): void {
    if (!this.persistPath) return;
    if (!existsSync(dirname(this.persistPath))) {
      return;
    }
    try {
      const arr = Array.from(this.sessions.values());
      writeFileSync(this.persistPath, JSON.stringify(arr, null, 2));
      if (this.providerDiscoveryPersistPath) {
        const entries = Array.from(this.providerDiscoverySourcePaths.entries())
          .sort(([left], [right]) => left.localeCompare(right));
        writeFileSync(
          this.providerDiscoveryPersistPath,
          JSON.stringify(Object.fromEntries(entries), null, 2),
        );
      }
    } catch (err) {
      if (isMissingPersistencePathError(err)) {
        return;
      }
      console.warn('[registry] Failed to save:', (err as Error).message);
    }
  }

  /** Flush pending saves immediately (call on shutdown) */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveToDisk();
  }

  create(input: CreateSessionInput): SessionInfo {
    const id = input.id || randomUUID();
    const now = new Date().toISOString();

    const session: SessionInfo = {
      id,
      providerName: input.providerName,
      providerBackend: this.normalizeProviderBackend(
        input.providerName,
        input.providerBackend,
      ),
      providerInstanceId: this.normalizeProviderInstanceId(
        input.providerName,
        input.providerInstanceId,
      ),
      status: 'initializing',
      origin: 'runtime',
      cwd: input.cwd,
      workspace: normalizeWorkspaceState({
        cwd: input.cwd,
        workspace: input.workspace,
        legacyWorkspaceMode: input.workspaceMode,
        legacyWorkspaceIsolation: input.workspaceIsolation,
      }),
      workspaceMode: undefined,
      workspaceIsolation: undefined,
      permissionMode: input.permissionMode,
      allowedTools: input.allowedTools,
      model: input.model,
      modelSelection: cloneModelSelection(input.modelSelection),
      modelResolution: cloneModelResolution(input.modelResolution),
      group: input.group,
      sessionKey: input.sessionKey,
      reusePolicy: input.reusePolicy,
      strategy: coerceSessionStrategyState(input),
      instructions: input.instructions,
      skills: cloneSkillState(input.skills),
      hydration: cloneHydrationState(input.hydration),
      context: cloneInvocationContext(input.context),
      outputDir: input.outputDir,
      artifacts: cloneArtifacts(input.artifacts),
      messageCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalPromptInputTokens: 0,
      totalCacheReadInputTokens: 0,
      totalCacheCreationInputTokens: 0,
      createdAt: now,
      updatedAt: now,
    };
    session.workspaceMode = toLegacyWorkspaceMode(session.workspace.kind, session.workspace.access);
    session.workspaceIsolation = toLegacyWorkspaceIsolationState(session.workspace);

    this.sessions.set(id, session);
    this.scheduleSave();
    return session;
  }

  get(id: string): SessionInfo | undefined {
    return this.sessions.get(id);
  }

  list(filters?: {
    status?: SessionStatus;
    provider?: string;
    group?: string;
  }): SessionInfo[] {
    let result = Array.from(this.sessions.values());

    if (filters?.status) {
      result = result.filter((s) => s.status === filters.status);
    }
    if (filters?.provider) {
      result = result.filter((s) => s.providerName === filters.provider);
    }
    if (filters?.group) {
      result = result.filter((s) => s.group === filters.group);
    }

    return result;
  }

  updateStatus(id: string, status: SessionStatus): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.status = status;
    session.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }

  setSourcePath(id: string, sourcePath: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.sourcePath = sourcePath;
    session.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }

  setProviderSessionId(id: string, providerSessionId: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    const previousProviderSessionId = session.providerSessionId;
    session.providerSessionId = providerSessionId;
    if (previousProviderSessionId && previousProviderSessionId !== providerSessionId) {
      this.forgetProviderDiscoverySourcePath(
        session.providerName,
        previousProviderSessionId,
        session.providerBackend,
        session.providerInstanceId,
      );
    }
    this.applyPendingDiscovered(session, providerSessionId);
    session.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }

  clearProviderResumeState(
    id: string,
    options: {
      clearProviderSourcePath?: boolean;
    } = {},
  ): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.forgetProviderDiscoverySourcePathForSession(session);
    session.providerSessionId = undefined;
    if (options.clearProviderSourcePath) {
      session.providerSourcePath = undefined;
    }
    session.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }

  setProviderState(id: string, providerState?: SessionProviderState): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.providerState = cloneProviderState(providerState);
    session.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }

  updateSessionMetadata(
    id: string,
    patch: {
      model?: string;
      modelSelection?: ProviderModelSelection;
      modelResolution?: ProviderModelResolution;
      sessionKey?: string;
      reusePolicy?: SessionReusePolicy;
      strategy?: RuntimeExecutionStrategyState;
      instructions?: string;
      skills?: SessionSkillState;
      hydration?: SessionHydrationState;
      maintenanceState?: RuntimeSessionMaintenanceState;
      context?: SessionInvocationContext;
      outputDir?: string;
      artifacts?: SessionArtifact[];
      summary?: string;
      lastInputPreview?: string;
    },
  ): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (patch.sessionKey !== undefined) {
      session.sessionKey = patch.sessionKey;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
      session.model = patch.model;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'modelSelection')) {
      session.modelSelection = cloneModelSelection(patch.modelSelection);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'modelResolution')) {
      session.modelResolution = cloneModelResolution(patch.modelResolution);
    }
    if (patch.reusePolicy !== undefined) {
      session.reusePolicy = patch.reusePolicy;
    }
    if (hasSessionStrategyPatch(patch)) {
      session.strategy = coerceSessionStrategyState(patch);
    }
    if (patch.instructions !== undefined) {
      session.instructions = patch.instructions;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'skills')) {
      session.skills = cloneSkillState(patch.skills);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'hydration')) {
      session.hydration = cloneHydrationState(patch.hydration);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'maintenanceState')) {
      session.maintenanceState = cloneMaintenanceState(patch.maintenanceState);
    }
    if (patch.context !== undefined) {
      session.context = cloneInvocationContext(patch.context);
    }
    if (patch.outputDir !== undefined) {
      session.outputDir = patch.outputDir;
    }
    if (patch.artifacts !== undefined) {
      session.artifacts = cloneArtifacts(patch.artifacts);
    }
    if (patch.summary !== undefined) {
      session.summary = patch.summary;
    }
    if (patch.lastInputPreview !== undefined) {
      session.lastInputPreview = patch.lastInputPreview;
    }

    session.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }

  updateWorkspace(
    id: string,
    patch: {
      cwd?: string;
      workspace?: SessionWorkspaceState;
      workspaceMode?: LegacyWorkspaceMode;
      workspaceIsolation?: LegacyWorkspaceIsolationState;
      permissionMode?: PermissionMode;
    },
  ): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (patch.cwd !== undefined) {
      session.cwd = patch.cwd;
    }
    if (patch.workspace !== undefined) {
      session.workspace = cloneWorkspaceState(patch.workspace)!;
    } else if (patch.workspaceMode !== undefined || patch.workspaceIsolation !== undefined) {
      session.workspace = normalizeWorkspaceState({
        cwd: session.cwd,
        workspace: session.workspace,
        legacyWorkspaceMode: patch.workspaceMode,
        legacyWorkspaceIsolation: patch.workspaceIsolation,
      });
    } else if (patch.cwd !== undefined) {
      session.workspace = normalizeWorkspaceState({
        cwd: session.cwd,
        workspace: session.workspace,
      });
    }
    session.workspaceMode = toLegacyWorkspaceMode(session.workspace.kind, session.workspace.access);
    session.workspaceIsolation = toLegacyWorkspaceIsolationState(session.workspace);
    if (patch.permissionMode !== undefined) {
      session.permissionMode = patch.permissionMode;
    }

    session.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }

  recordMessage(
    id: string,
    usageOrInputTokens?: number | StreamUsage,
    outputTokens?: number,
  ): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    const usage = normalizeRecordedUsage(usageOrInputTokens, outputTokens);
    session.messageCount++;
    if (usage.inputTokens > 0) session.totalInputTokens += usage.inputTokens;
    if (usage.outputTokens > 0) session.totalOutputTokens += usage.outputTokens;
    if (usage.promptInputTokens > 0) {
      session.totalPromptInputTokens = (session.totalPromptInputTokens ?? 0) + usage.promptInputTokens;
    }
    if (usage.cacheReadInputTokens > 0) {
      session.totalCacheReadInputTokens =
        (session.totalCacheReadInputTokens ?? 0) + usage.cacheReadInputTokens;
    }
    if (usage.cacheCreationInputTokens > 0) {
      session.totalCacheCreationInputTokens =
        (session.totalCacheCreationInputTokens ?? 0) + usage.cacheCreationInputTokens;
    }
    session.lastActivity = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }

  /**
   * Try to delete transcript files associated with a session.
   * Does NOT remove the session from the registry.
   */
  deleteTranscripts(id: string): { fileDeleted: boolean } {
    const prepared = this.prepareTranscriptDeletion(id);
    if (!prepared.ready) {
      prepared.rollback();
      return { fileDeleted: false };
    }

    try {
      return prepared.finalize();
    } catch {
      prepared.rollback();
      return { fileDeleted: false };
    }
  }

  prepareTranscriptDeletion(id: string): PreparedFileDeletion {
    const session = this.sessions.get(id);
    if (!session) {
      return {
        hadFiles: false,
        ready: false,
        finalize: () => ({ fileDeleted: false }),
        rollback: () => {},
      };
    }

    return this.preparePathDeletion(
      this.collectTranscriptArtifactPaths(session),
    );
  }

  prepareManagedTranscriptDeletion(id: string): PreparedFileDeletion {
    const session = this.sessions.get(id);
    if (!session) {
      return {
        hadFiles: false,
        ready: false,
        finalize: () => ({ fileDeleted: false }),
        rollback: () => {},
      };
    }

    return this.preparePathDeletion(
      this.collectManagedTranscriptArtifactPaths(session),
    );
  }

  preparePathDeletion(
    artifactPaths: Iterable<string>,
    options: { preserveDirs?: Iterable<string> } = {},
  ): PreparedFileDeletion {
    const preservedDirs = new Set(
      Array.from(options.preserveDirs ?? [], (dir) => resolve(dir)),
    );
    const stagedArtifacts: StagedTranscriptArtifact[] = [];
    let hadFiles = false;

    try {
      for (const artifactPath of artifactPaths) {
        if (!existsSync(artifactPath)) continue;
        hadFiles = true;
        stagedArtifacts.push(this.stageTranscriptArtifact(artifactPath));
      }
    } catch {
      this.restoreStagedArtifacts(stagedArtifacts);
      return {
        hadFiles,
        ready: false,
        finalize: () => ({ fileDeleted: false }),
        rollback: () => {},
      };
    }

    let completed = false;

    return {
      hadFiles,
      ready: true,
      finalize: () => {
        if (completed) {
          return { fileDeleted: hadFiles };
        }

        completed = true;
        const cleanupDirs = new Set(
          stagedArtifacts
            .map((artifact) => artifact.cleanupDir)
            .filter((dir) => !preservedDirs.has(resolve(dir))),
        );
        for (const artifact of stagedArtifacts) {
          try {
            rmSync(artifact.stagedPath, { recursive: true, force: true });
          } catch {
            // Best effort only. The staged artifact is already detached from
            // the tracked session path, so it will not be rediscovered.
          }
        }
        this.cleanupEmptyDirs(cleanupDirs);
        return { fileDeleted: hadFiles };
      },
      rollback: () => {
        if (completed) return;
        completed = true;
        this.restoreStagedArtifacts(stagedArtifacts);
      },
    };
  }

  /** Remove a session from the registry (does not touch files). */
  unregister(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.forgetProviderDiscoverySourcePathForSession(session);
    this.sessions.delete(id);
    this.scheduleSave();
    return true;
  }

  /**
   * Remove closed discovered sessions that no longer appear in the latest
   * provider scan for the same backend/instance target.
   */
  pruneMissingDiscovered(
    providerName: string,
    retainedProviderSessionIds: Iterable<string>,
    providerBackend?: 'cli' | 'api' | 'local' | 'agent',
    providerInstanceId?: string,
  ): number {
    const retained = new Set(retainedProviderSessionIds);
    let removed = 0;

    for (const [id, session] of this.sessions.entries()) {
      if (session.origin !== 'discovered' || session.status !== 'closed') {
        continue;
      }
      if (session.providerName !== providerName || !session.providerSessionId) {
        continue;
      }
      if (!this.sameProviderTarget(
        providerName,
        session.providerBackend,
        session.providerInstanceId,
        providerBackend,
        providerInstanceId,
      )) {
        continue;
      }
      if (retained.has(session.providerSessionId)) {
        continue;
      }

      this.forgetProviderDiscoverySourcePathForSession(session);
      this.sessions.delete(id);
      removed++;
    }

    if (removed > 0) {
      this.scheduleSave();
    }

    return removed;
  }

  /** Remove session from registry and delete source .jsonl file if present */
  remove(id: string): { deleted: boolean; fileDeleted: boolean } {
    const session = this.sessions.get(id);
    if (!session) return { deleted: false, fileDeleted: false };

    const { fileDeleted } = this.deleteTranscripts(id);
    this.forgetProviderDiscoverySourcePathForSession(session);
    this.sessions.delete(id);
    this.scheduleSave();
    return { deleted: true, fileDeleted };
  }

  /** Upsert a discovered session by provider session ID */
  upsertDiscovered(
    providerSessionId: string,
    data: DiscoveredSessionData,
  ): SessionInfo | null {
    const pendingKey = this.discoveredKey(
      data.providerName,
      providerSessionId,
      data.providerBackend,
      data.providerInstanceId,
    );
    const mergedData = this.mergeDiscoveredData(
      this.pendingDiscovered.get(pendingKey),
      data,
    );

    // Check if we already track this provider session
    let matched: SessionInfo | undefined;
    for (const session of this.sessions.values()) {
      if (
        session.providerSessionId === providerSessionId
        && this.sameProviderTarget(
          session.providerName,
          session.providerBackend,
          session.providerInstanceId,
          mergedData.providerBackend,
          mergedData.providerInstanceId,
        )
      ) {
        matched = session;
        break;
      }
    }

    if (matched) {
      return this.mergeDiscoveredIntoSession(matched, providerSessionId, mergedData);
    }

    const candidates = this.findPendingRuntimeCandidates(mergedData);
    if (candidates.length === 1) {
      return this.mergeDiscoveredIntoSession(candidates[0], providerSessionId, mergedData);
    }

    if (candidates.length > 1) {
      // Multiple live runtime sessions are still waiting for their provider session ID.
      // Keep the discovered metadata in memory until one of them reports an exact ID.
      this.pendingDiscovered.set(pendingKey, mergedData);
      return null;
    }

    this.pendingDiscovered.delete(pendingKey);

    // New discovered session — no worker, so status is closed
    const id = randomUUID();
    const now = new Date().toISOString();
    const session: SessionInfo = {
      id,
      providerSessionId,
      providerName: mergedData.providerName,
      providerBackend: this.normalizeProviderBackend(
        mergedData.providerName,
        mergedData.providerBackend,
      ),
      providerInstanceId: mergedData.providerInstanceId,
      status: 'closed',
      origin: 'discovered',
      cwd: mergedData.cwd,
      workspace: normalizeWorkspaceState({
        cwd: mergedData.cwd,
        workspace: mergedData.workspace,
      }),
      workspaceMode: undefined,
      workspaceIsolation: undefined,
      model: mergedData.model,
      group: mergedData.group,
      sessionKey: mergedData.sessionKey,
      reusePolicy: mergedData.reusePolicy,
      strategy: coerceSessionStrategyState(mergedData),
      instructions: mergedData.instructions,
      skills: cloneSkillState(mergedData.skills),
      context: cloneInvocationContext(mergedData.context),
      outputDir: mergedData.outputDir,
      artifacts: cloneArtifacts(mergedData.artifacts),
      summary: mergedData.summary,
      lastInputPreview: mergedData.lastInputPreview,
      sourcePath: mergedData.sourcePath,
      providerSourcePath: mergedData.sourcePath,
      messageCount: mergedData.messageCount ?? 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalPromptInputTokens: 0,
      totalCacheReadInputTokens: 0,
      totalCacheCreationInputTokens: 0,
      createdAt: now,
      updatedAt: now,
      lastActivity: mergedData.lastActivity,
    };
    session.workspaceMode = toLegacyWorkspaceMode(session.workspace.kind, session.workspace.access);
    session.workspaceIsolation = toLegacyWorkspaceIsolationState(session.workspace);

    this.sessions.set(id, session);
    this.rememberProviderDiscoverySourcePath(
      session.providerName,
      providerSessionId,
      mergedData.sourcePath,
      session.providerBackend,
      session.providerInstanceId,
    );
    this.scheduleSave();
    return session;
  }

  getProviderDiscoverySourcePath(
    providerName: string,
    providerSessionId?: string,
    providerBackend?: string,
    providerInstanceId?: string,
  ): string | undefined {
    const key = this.providerDiscoverySourcePathKey(
      providerName,
      providerSessionId,
      providerBackend,
      providerInstanceId,
    );
    return key ? this.providerDiscoverySourcePaths.get(key) : undefined;
  }

  private applyPendingDiscovered(session: SessionInfo, providerSessionId: string): void {
    const pending = this.pendingDiscovered.get(
      this.discoveredKey(
        session.providerName,
        providerSessionId,
        session.providerBackend,
        session.providerInstanceId,
      ),
    );
    if (!pending) return;
    this.mergeDiscoveredIntoSession(session, providerSessionId, pending, false);
  }

  private findPendingRuntimeCandidates(data: DiscoveredSessionData): SessionInfo[] {
    return Array.from(this.sessions.values()).filter((session) =>
      session.origin === 'runtime'
      && !session.providerSessionId
      && session.providerName === data.providerName
      && this.sameProviderTarget(
        session.providerName,
        session.providerBackend,
        session.providerInstanceId,
        data.providerBackend,
        data.providerInstanceId,
      )
      && session.cwd === data.cwd
      && session.status !== 'closed'
      && session.status !== 'closing'
    );
  }

  private mergeDiscoveredIntoSession(
    session: SessionInfo,
    providerSessionId: string,
    data: DiscoveredSessionData,
    scheduleSave = true,
  ): SessionInfo {
    const previousProviderSessionId = session.providerSessionId;
    session.providerSessionId = providerSessionId;
    session.providerBackend = this.normalizeProviderBackend(
      session.providerName,
      data.providerBackend ?? session.providerBackend,
    );
    session.providerInstanceId = this.normalizeProviderInstanceId(
      session.providerName,
      data.providerInstanceId ?? session.providerInstanceId,
    );
    if (previousProviderSessionId && previousProviderSessionId !== providerSessionId) {
      this.forgetProviderDiscoverySourcePath(
        session.providerName,
        previousProviderSessionId,
        session.providerBackend,
        session.providerInstanceId,
      );
    }

    // Only update metadata, never overwrite status or runtime-owned cwd
    if (!session.cwd || session.origin !== 'runtime') {
      session.cwd = data.cwd;
    }
    if (data.summary) session.summary = data.summary;
    if (data.lastInputPreview) session.lastInputPreview = data.lastInputPreview;
    if (data.group && !session.group) session.group = data.group;
    session.workspace = normalizeWorkspaceState({
      cwd: session.cwd,
      workspace: data.workspace ?? session.workspace,
    });
    session.workspaceMode = toLegacyWorkspaceMode(session.workspace.kind, session.workspace.access);
    session.workspaceIsolation = toLegacyWorkspaceIsolationState(session.workspace);
    if (data.model && !session.model) session.model = data.model;
    if (data.sessionKey && !session.sessionKey) session.sessionKey = data.sessionKey;
    if (data.reusePolicy && !session.reusePolicy) session.reusePolicy = data.reusePolicy;
    // Runtime-owned session state stays authoritative over late discovered data.
    session.strategy = mergeRuntimeExecutionStrategyStates(
      cloneRuntimeExecutionStrategyState(data.strategy),
      session.strategy,
    );
    if (data.instructions && !session.instructions) session.instructions = data.instructions;
    if (data.skills && !session.skills) session.skills = cloneSkillState(data.skills);
    if (data.context && !session.context) session.context = cloneInvocationContext(data.context);
    if (data.outputDir && !session.outputDir) session.outputDir = data.outputDir;
    if (data.artifacts && (!session.artifacts || session.artifacts.length === 0)) {
      session.artifacts = cloneArtifacts(data.artifacts);
    }

    // Only attach providerSourcePath if session doesn't already have runtime-managed history
    // (prevents /history from duplicating turns from both sources)
    const hasRuntimeHistory = session.sourcePath && this.sessionBaseDir
      && session.sourcePath.startsWith(this.sessionBaseDir);
    if (data.sourcePath && (!hasRuntimeHistory || session.providerName === 'pi')) {
      session.providerSourcePath = data.sourcePath;
    }
    this.rememberProviderDiscoverySourcePath(
      session.providerName,
      providerSessionId,
      data.sourcePath ?? session.providerSourcePath,
      session.providerBackend,
      session.providerInstanceId,
    );
    if (data.sourcePath && !session.sourcePath) session.sourcePath = data.sourcePath;
    if (data.messageCount != null) session.messageCount = data.messageCount;
    if (data.lastActivity) session.lastActivity = data.lastActivity;
    session.updatedAt = new Date().toISOString();
    this.pendingDiscovered.delete(
      this.discoveredKey(
        session.providerName,
        providerSessionId,
        data.providerBackend ?? session.providerBackend,
        data.providerInstanceId ?? session.providerInstanceId,
      ),
    );
    if (scheduleSave) {
      this.scheduleSave();
    }
    return session;
  }

  private mergeDiscoveredData(
    existing: DiscoveredSessionData | undefined,
    incoming: DiscoveredSessionData,
  ): DiscoveredSessionData {
    if (!existing) return { ...incoming };
    return {
      cwd: incoming.cwd || existing.cwd,
      providerName: incoming.providerName || existing.providerName,
      providerBackend: incoming.providerBackend ?? existing.providerBackend,
      providerInstanceId: incoming.providerInstanceId ?? existing.providerInstanceId,
      summary: incoming.summary ?? existing.summary,
      lastInputPreview: incoming.lastInputPreview ?? existing.lastInputPreview,
      messageCount: incoming.messageCount ?? existing.messageCount,
      lastActivity: incoming.lastActivity ?? existing.lastActivity,
      model: incoming.model ?? existing.model,
      sourcePath: incoming.sourcePath ?? existing.sourcePath,
      group: incoming.group ?? existing.group,
      workspace: incoming.workspace ?? existing.workspace,
      sessionKey: incoming.sessionKey ?? existing.sessionKey,
      reusePolicy: incoming.reusePolicy ?? existing.reusePolicy,
      // Newer discovered scan data overrides older pending discovered metadata.
      strategy: mergeRuntimeExecutionStrategyStates(
        cloneRuntimeExecutionStrategyState(existing.strategy),
        cloneRuntimeExecutionStrategyState(incoming.strategy),
      ),
      instructions: incoming.instructions ?? existing.instructions,
      context: incoming.context ?? existing.context,
      outputDir: incoming.outputDir ?? existing.outputDir,
      artifacts: incoming.artifacts ?? existing.artifacts,
    };
  }

  private collectTranscriptArtifactPaths(session: SessionInfo): string[] {
    const artifactPaths = new Set<string>();
    for (const transcriptPath of [session.sourcePath, session.providerSourcePath]) {
      if (!transcriptPath) continue;
      artifactPaths.add(transcriptPath);

      const snapshotDir = transcriptPath.replace(/\.jsonl?$/, '');
      if (snapshotDir !== transcriptPath) {
        artifactPaths.add(snapshotDir);
      }
    }
    return Array.from(artifactPaths);
  }

  private collectManagedTranscriptArtifactPaths(session: SessionInfo): string[] {
    if (!this.sessionBaseDir) return [];

    return this.collectTranscriptArtifactPaths(session).filter((artifactPath) =>
      artifactPath.startsWith(this.sessionBaseDir!),
    );
  }

  private stageTranscriptArtifact(originalPath: string): StagedTranscriptArtifact {
    const stagedPath = join(
      dirname(originalPath),
      `.cats-runtime-delete-${randomUUID()}-${basename(originalPath)}.pending-delete`,
    );
    renameSync(originalPath, stagedPath);
    return {
      originalPath,
      stagedPath,
      cleanupDir: dirname(originalPath),
    };
  }

  private restoreStagedArtifacts(stagedArtifacts: StagedTranscriptArtifact[]): void {
    for (const artifact of [...stagedArtifacts].reverse()) {
      if (!existsSync(artifact.stagedPath) || existsSync(artifact.originalPath)) continue;
      renameSync(artifact.stagedPath, artifact.originalPath);
    }
  }

  private cleanupEmptyDirs(dirs: Iterable<string>): void {
    for (const dir of dirs) {
      try {
        const remaining = readdirSync(dir);
        if (remaining.length === 0) rmSync(dir);
      } catch {
        // Ignore cleanup failures after the session artifacts have already
        // been detached from their original paths.
      }
    }
  }

  private loadProviderDiscoverySourcePaths(): boolean {
    if (!this.providerDiscoveryPersistPath) {
      return false;
    }

    try {
      const raw = readFileSync(this.providerDiscoveryPersistPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      let migrated = false;
      this.providerDiscoverySourcePaths.clear();
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && value.length > 0) {
          this.providerDiscoverySourcePaths.set(key, value);
        } else {
          migrated = true;
        }
      }
      return migrated;
    } catch {
      return false;
    }
  }

  private seedProviderDiscoverySourcePathsFromSessions(): boolean {
    let migrated = false;
    for (const session of this.sessions.values()) {
      if (!session.providerSessionId) {
        continue;
      }
      const sourcePath = this.selectPersistableProviderDiscoverySourcePath(session);
      const key = this.providerDiscoverySourcePathKey(
        session.providerName,
        session.providerSessionId,
        session.providerBackend,
        session.providerInstanceId,
      );
      if (!sourcePath || !key || this.providerDiscoverySourcePaths.get(key) === sourcePath) {
        continue;
      }
      this.providerDiscoverySourcePaths.set(key, sourcePath);
      migrated = true;
    }
    return migrated;
  }

  private pruneProviderDiscoverySourcePaths(): boolean {
    const validKeys = new Set<string>();
    for (const session of this.sessions.values()) {
      const key = this.providerDiscoverySourcePathKey(
        session.providerName,
        session.providerSessionId,
        session.providerBackend,
        session.providerInstanceId,
      );
      if (key) {
        validKeys.add(key);
      }
    }

    let migrated = false;
    for (const key of Array.from(this.providerDiscoverySourcePaths.keys())) {
      if (validKeys.has(key)) {
        continue;
      }
      this.providerDiscoverySourcePaths.delete(key);
      migrated = true;
    }

    return migrated;
  }

  private normalizeProviderInstanceId(providerName: string, providerInstanceId?: string): string | undefined {
    const defaultInstanceId = this.providerDefaultInstances[providerName];
    if (providerInstanceId === 'default') {
      return defaultInstanceId || 'default';
    }
    if (!providerInstanceId) {
      return defaultInstanceId || undefined;
    }
    return providerInstanceId;
  }

  private normalizeProviderBackend(
    providerName: string,
    providerBackend?: string,
  ): 'cli' | 'api' | 'local' | 'agent' {
    if (providerBackend === 'cli' || providerBackend === 'api' || providerBackend === 'local' || providerBackend === 'agent') {
      return providerBackend;
    }

    if (providerName === 'openai') {
      return 'api';
    }
    if (providerName === 'ollama') {
      return 'local';
    }

    return this.providerDefaultTargets[providerName]?.backend || 'cli';
  }

  private sameProviderTarget(
    providerName: string,
    leftBackend?: string,
    leftInstanceId?: string,
    rightBackend?: string,
    rightInstanceId?: string,
  ): boolean {
    const normalizedLeftBackend = this.normalizeProviderBackend(providerName, leftBackend);
    const normalizedRightBackend = this.normalizeProviderBackend(providerName, rightBackend);
    if (normalizedLeftBackend !== normalizedRightBackend) {
      return false;
    }

    return (this.normalizeProviderInstanceId(providerName, leftInstanceId) || 'default')
      === (this.normalizeProviderInstanceId(providerName, rightInstanceId) || 'default');
  }

  private discoveredKey(
    providerName: string,
    providerSessionId: string,
    providerBackend?: string,
    providerInstanceId?: string,
  ): string {
    const backend = this.normalizeProviderBackend(providerName, providerBackend);
    const instanceId = this.normalizeProviderInstanceId(providerName, providerInstanceId) || 'default';
    return `${backend}:${instanceId}:${providerSessionId}`;
  }

  private providerDiscoverySourcePathKey(
    providerName: string,
    providerSessionId?: string,
    providerBackend?: string,
    providerInstanceId?: string,
  ): string | null {
    if (!providerSessionId) {
      return null;
    }

    return this.discoveredKey(
      providerName,
      providerSessionId,
      providerBackend,
      providerInstanceId,
    );
  }

  private rememberProviderDiscoverySourcePath(
    providerName: string,
    providerSessionId: string,
    sourcePath: string | undefined,
    providerBackend?: string,
    providerInstanceId?: string,
  ): void {
    const key = this.providerDiscoverySourcePathKey(
      providerName,
      providerSessionId,
      providerBackend,
      providerInstanceId,
    );
    if (!key || !this.isPersistableProviderDiscoverySourcePath(sourcePath)) {
      return;
    }
    this.providerDiscoverySourcePaths.set(key, sourcePath);
  }

  private forgetProviderDiscoverySourcePath(
    providerName: string,
    providerSessionId?: string,
    providerBackend?: string,
    providerInstanceId?: string,
  ): void {
    const key = this.providerDiscoverySourcePathKey(
      providerName,
      providerSessionId,
      providerBackend,
      providerInstanceId,
    );
    if (!key) {
      return;
    }
    this.providerDiscoverySourcePaths.delete(key);
  }

  private forgetProviderDiscoverySourcePathForSession(session: SessionInfo): void {
    this.forgetProviderDiscoverySourcePath(
      session.providerName,
      session.providerSessionId,
      session.providerBackend,
      session.providerInstanceId,
    );
  }

  private selectPersistableProviderDiscoverySourcePath(
    session: SessionInfo,
  ): string | undefined {
    for (const sourcePath of [session.providerSourcePath, session.sourcePath]) {
      if (this.isPersistableProviderDiscoverySourcePath(sourcePath)) {
        return sourcePath;
      }
    }
    return undefined;
  }

  private isPersistableProviderDiscoverySourcePath(
    sourcePath: string | undefined,
  ): sourcePath is string {
    return Boolean(
      sourcePath
      && (!this.sessionBaseDir || !sourcePath.startsWith(this.sessionBaseDir))
    );
  }

  private mergeLoadedDuplicate(target: SessionInfo, incoming: SessionInfo): void {
    target.providerBackend = this.normalizeProviderBackend(
      target.providerName,
      target.providerBackend ?? incoming.providerBackend,
    );
    target.providerInstanceId = this.normalizeProviderInstanceId(
      target.providerName,
      target.providerInstanceId ?? incoming.providerInstanceId,
    );
    if (!target.providerSessionId && incoming.providerSessionId) {
      target.providerSessionId = incoming.providerSessionId;
    }
    if (!target.cwd && incoming.cwd) target.cwd = incoming.cwd;
    target.workspace = normalizeWorkspaceState({
      cwd: target.cwd,
      workspace: target.workspace ?? incoming.workspace,
    });
    target.workspaceMode = toLegacyWorkspaceMode(target.workspace.kind, target.workspace.access);
    target.workspaceIsolation = toLegacyWorkspaceIsolationState(target.workspace);
    if (!target.model && incoming.model) target.model = incoming.model;
    if (!target.modelSelection && incoming.modelSelection) {
      target.modelSelection = cloneModelSelection(incoming.modelSelection);
    }
    if (!target.modelResolution && incoming.modelResolution) {
      target.modelResolution = cloneModelResolution(incoming.modelResolution);
    }
    if (!target.group && incoming.group) target.group = incoming.group;
    if (!target.summary && incoming.summary) target.summary = incoming.summary;
    if (!target.sessionKey && incoming.sessionKey) target.sessionKey = incoming.sessionKey;
    if (!target.reusePolicy && incoming.reusePolicy) target.reusePolicy = incoming.reusePolicy;
    // Preserve the already-materialized session record when duplicate rows collide.
    target.strategy = mergeRuntimeExecutionStrategyStates(
      cloneRuntimeExecutionStrategyState(incoming.strategy),
      target.strategy,
    );
    if (!target.instructions && incoming.instructions) target.instructions = incoming.instructions;
    if (!target.skills && incoming.skills) target.skills = cloneSkillState(incoming.skills);
    if (!target.hydration && incoming.hydration) {
      target.hydration = cloneHydrationState(incoming.hydration);
    }
    if (!target.maintenanceState && incoming.maintenanceState) {
      target.maintenanceState = cloneMaintenanceState(incoming.maintenanceState);
    }
    if (!target.context && incoming.context) target.context = cloneInvocationContext(incoming.context);
    if (!target.outputDir && incoming.outputDir) target.outputDir = incoming.outputDir;
    if ((!target.artifacts || target.artifacts.length === 0) && incoming.artifacts) {
      target.artifacts = cloneArtifacts(incoming.artifacts);
    }
    if (!target.sourcePath && incoming.sourcePath) target.sourcePath = incoming.sourcePath;
    if (!target.providerSourcePath && incoming.providerSourcePath) {
      target.providerSourcePath = incoming.providerSourcePath;
    }
    if (!target.providerState && incoming.providerState) {
      target.providerState = cloneProviderState(incoming.providerState);
    }
    if (target.providerSessionId || incoming.providerSessionId) {
      this.rememberProviderDiscoverySourcePath(
        target.providerName,
        target.providerSessionId ?? incoming.providerSessionId ?? '',
        target.providerSourcePath ?? incoming.providerSourcePath ?? target.sourcePath ?? incoming.sourcePath,
        target.providerBackend ?? incoming.providerBackend,
        target.providerInstanceId ?? incoming.providerInstanceId,
      );
    }
    target.messageCount = Math.max(target.messageCount, incoming.messageCount);
    target.totalInputTokens = Math.max(target.totalInputTokens, incoming.totalInputTokens);
    target.totalOutputTokens = Math.max(target.totalOutputTokens, incoming.totalOutputTokens);
    target.totalPromptInputTokens = Math.max(
      target.totalPromptInputTokens ?? 0,
      incoming.totalPromptInputTokens ?? 0,
    );
    target.totalCacheReadInputTokens = Math.max(
      target.totalCacheReadInputTokens ?? 0,
      incoming.totalCacheReadInputTokens ?? 0,
    );
    target.totalCacheCreationInputTokens = Math.max(
      target.totalCacheCreationInputTokens ?? 0,
      incoming.totalCacheCreationInputTokens ?? 0,
    );
    target.createdAt = earlierTimestamp(target.createdAt, incoming.createdAt);
    target.updatedAt = laterTimestamp(target.updatedAt, incoming.updatedAt);
    target.lastActivity = laterOptionalTimestamp(target.lastActivity, incoming.lastActivity);
  }
}

function normalizeRecordedUsage(
  usageOrInputTokens?: number | StreamUsage,
  outputTokens?: number,
): Required<Pick<
  StreamUsage,
  | 'inputTokens'
  | 'outputTokens'
  | 'promptInputTokens'
  | 'cacheReadInputTokens'
  | 'cacheCreationInputTokens'
>> {
  if (typeof usageOrInputTokens === 'number' || usageOrInputTokens === undefined) {
    return {
      inputTokens: usageOrInputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      promptInputTokens: usageOrInputTokens ?? 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
  }

  const cacheReadInputTokens = usageOrInputTokens.cacheReadInputTokens ?? 0;
  const cacheCreationInputTokens = usageOrInputTokens.cacheCreationInputTokens ?? 0;
  const inputTokens = usageOrInputTokens.inputTokens ?? 0;
  const promptInputTokens = usageOrInputTokens.promptInputTokens
    ?? Math.max(inputTokens - cacheReadInputTokens - cacheCreationInputTokens, 0);

  return {
    inputTokens,
    outputTokens: usageOrInputTokens.outputTokens ?? 0,
    promptInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
  };
}

function earlierTimestamp(left: string, right: string): string {
  return left <= right ? left : right;
}

function laterTimestamp(left: string, right: string): string {
  return left >= right ? left : right;
}

function laterOptionalTimestamp(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function cloneProviderState(
  providerState?: SessionProviderState,
): SessionProviderState | undefined {
  if (!providerState) {
    return undefined;
  }

  return structuredClone(providerState);
}

function cloneModelSelection(
  selection?: ProviderModelSelection,
): ProviderModelSelection | undefined {
  return selection ? structuredClone(selection) : undefined;
}

function cloneModelResolution(
  resolution?: ProviderModelResolution,
): ProviderModelResolution | undefined {
  return resolution ? structuredClone(resolution) : undefined;
}

function cloneRecord(
  value?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return value ? structuredClone(value) : undefined;
}

function cloneInvocationContext(
  context?: SessionInvocationContext,
): SessionInvocationContext | undefined {
  return context ? structuredClone(context) : undefined;
}

function cloneHydrationState(
  hydration?: SessionHydrationState,
): SessionHydrationState | undefined {
  return hydration ? structuredClone(hydration) : undefined;
}

function cloneMaintenanceState(
  maintenanceState?: RuntimeSessionMaintenanceState,
): RuntimeSessionMaintenanceState | undefined {
  return maintenanceState ? structuredClone(maintenanceState) : undefined;
}

function coerceSessionStrategyState(
  value: {
    strategy?: RuntimeExecutionStrategyState;
  },
): RuntimeExecutionStrategyState | undefined {
  return cloneRuntimeExecutionStrategyState(value.strategy);
}

function coercePersistedSessionStrategyState(
  value: PersistedSessionRecord,
): RuntimeExecutionStrategyState | undefined {
  return readRuntimeExecutionStrategyState(value);
}

function hasSessionStrategyPatch(
  patch: {
    strategy?: RuntimeExecutionStrategyState;
  },
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'strategy');
}

function cloneSkillState(
  skillState?: SessionSkillState,
): SessionSkillState | undefined {
  return skillState ? structuredClone(skillState) : undefined;
}

function cloneArtifacts(
  artifacts?: SessionArtifact[],
): SessionArtifact[] | undefined {
  return artifacts ? structuredClone(artifacts) : undefined;
}

function cloneWorkspaceState(
  workspace?: SessionWorkspaceState,
): SessionWorkspaceState | undefined {
  return workspace ? structuredClone(workspace) : undefined;
}

function normalizeWorkspaceState(input: {
  cwd: string;
  workspace?: SessionWorkspaceState;
  legacyWorkspaceMode?: LegacyWorkspaceMode;
  legacyWorkspaceIsolation?: LegacyWorkspaceIsolationState;
}): SessionWorkspaceState {
  if (input.workspace) {
    return cloneWorkspaceState(input.workspace)!;
  }

  if (input.legacyWorkspaceIsolation?.mode === 'worktree' && input.legacyWorkspaceIsolation.worktree) {
    return {
      kind: 'worktree',
      access: input.legacyWorkspaceMode === 'read_only' ? 'read_only' : 'read_write',
      runtimeCwd: input.cwd,
      ...(input.legacyWorkspaceIsolation.sourceCwd ? { sourceCwd: input.legacyWorkspaceIsolation.sourceCwd } : {}),
      worktree: structuredClone(input.legacyWorkspaceIsolation.worktree),
    };
  }

  if (input.legacyWorkspaceMode === 'isolated' || input.legacyWorkspaceIsolation?.mode === 'isolated') {
    return {
      kind: 'sandbox',
      access: input.legacyWorkspaceMode === 'read_only' ? 'read_only' : 'read_write',
      runtimeCwd: input.cwd,
      ...(input.legacyWorkspaceIsolation?.sourceCwd
        ? { sourceCwd: input.legacyWorkspaceIsolation.sourceCwd }
        : {}),
    };
  }

  return {
    kind: 'source',
    access: input.legacyWorkspaceMode === 'read_only' ? 'read_only' : 'read_write',
    runtimeCwd: input.cwd,
    sourceCwd: input.cwd,
  };
}
