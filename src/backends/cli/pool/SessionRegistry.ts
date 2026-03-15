import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { SessionInfo, SessionStatus, WorkspaceMode } from './types.js';
import { normalizeSessionOrigin } from './sessionView.js';

export interface CreateSessionInput {
  id?: string;
  providerName: string;
  providerInstanceId?: string;
  cwd: string;
  workspaceMode?: WorkspaceMode;
  model?: string;
  group?: string;
}

interface DiscoveredSessionData {
  cwd: string;
  providerName: string;
  providerInstanceId?: string;
  summary?: string;
  messageCount?: number;
  lastActivity?: string;
  model?: string;
  sourcePath?: string;
  group?: string;
  workspaceMode?: WorkspaceMode;
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

export class SessionRegistry {
  private sessions = new Map<string, SessionInfo>();
  private pendingDiscovered = new Map<string, DiscoveredSessionData>();
  private persistPath: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    dataDir?: string,
    private sessionBaseDir?: string,
    private providerDefaultInstances: Record<string, string> = {},
  ) {
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      this.persistPath = join(dataDir, 'sessions.json');
      this.load();
    }
  }

  private load(): void {
    if (!this.persistPath) return;
    try {
      const raw = readFileSync(this.persistPath, 'utf-8');
      const arr: SessionInfo[] = JSON.parse(raw);
      const loadedByProviderSession = new Map<string, SessionInfo>();
      let migrated = false;

      for (const loaded of arr) {
        // All sessions come back as closed (no live worker)
        const s: SessionInfo = {
          ...loaded,
          status: 'closed',
          origin: normalizeSessionOrigin(loaded, this.sessionBaseDir),
          providerInstanceId: this.normalizeProviderInstanceId(
            loaded.providerName,
            loaded.providerInstanceId,
          ),
        };
        // Default missing workspaceMode for backward compat
        if (!s.workspaceMode) s.workspaceMode = 'shared';
        if (s.providerInstanceId !== loaded.providerInstanceId || s.origin !== loaded.origin) {
          migrated = true;
        }
        if (loaded.workspaceMode !== s.workspaceMode) {
          migrated = true;
        }

        if (s.providerSessionId) {
          const key = this.discoveredKey(
            s.providerName,
            s.providerSessionId,
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
    try {
      const arr = Array.from(this.sessions.values());
      writeFileSync(this.persistPath, JSON.stringify(arr, null, 2));
    } catch (err) {
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
      providerInstanceId: this.normalizeProviderInstanceId(
        input.providerName,
        input.providerInstanceId,
      ),
      status: 'initializing',
      origin: 'runtime',
      cwd: input.cwd,
      workspaceMode: input.workspaceMode,
      model: input.model,
      group: input.group,
      messageCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: now,
      updatedAt: now,
    };

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
    session.providerSessionId = providerSessionId;
    this.applyPendingDiscovered(session, providerSessionId);
    session.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return true;
  }

  recordMessage(id: string, inputTokens?: number, outputTokens?: number): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.messageCount++;
    if (inputTokens) session.totalInputTokens += inputTokens;
    if (outputTokens) session.totalOutputTokens += outputTokens;
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
  ): PreparedFileDeletion {
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
        const cleanupDirs = new Set(stagedArtifacts.map((artifact) => artifact.cleanupDir));
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
    if (!this.sessions.delete(id)) return false;
    this.scheduleSave();
    return true;
  }

  /** Remove session from registry and delete source .jsonl file if present */
  remove(id: string): { deleted: boolean; fileDeleted: boolean } {
    const session = this.sessions.get(id);
    if (!session) return { deleted: false, fileDeleted: false };

    const { fileDeleted } = this.deleteTranscripts(id);
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
        && this.sameProviderInstance(
          session.providerName,
          session.providerInstanceId,
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
      providerInstanceId: mergedData.providerInstanceId,
      status: 'closed',
      origin: 'discovered',
      cwd: mergedData.cwd,
      workspaceMode: mergedData.workspaceMode || 'shared',
      model: mergedData.model,
      group: mergedData.group,
      summary: mergedData.summary,
      sourcePath: mergedData.sourcePath,
      providerSourcePath: mergedData.sourcePath,
      messageCount: mergedData.messageCount ?? 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: now,
      updatedAt: now,
      lastActivity: mergedData.lastActivity,
    };

    this.sessions.set(id, session);
    this.scheduleSave();
    return session;
  }

  private applyPendingDiscovered(session: SessionInfo, providerSessionId: string): void {
    const pending = this.pendingDiscovered.get(
      this.discoveredKey(
        session.providerName,
        providerSessionId,
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
      && this.sameProviderInstance(
        session.providerName,
        session.providerInstanceId,
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
    session.providerSessionId = providerSessionId;
    session.providerInstanceId = this.normalizeProviderInstanceId(
      session.providerName,
      data.providerInstanceId ?? session.providerInstanceId,
    );

    // Only update metadata, never overwrite status or runtime-owned cwd
    if (!session.cwd || session.origin !== 'runtime') {
      session.cwd = data.cwd;
    }
    if (data.summary) session.summary = data.summary;
    if (data.group && !session.group) session.group = data.group;
    if (data.workspaceMode) session.workspaceMode = data.workspaceMode;
    if (data.model && !session.model) session.model = data.model;

    // Only attach providerSourcePath if session doesn't already have runtime-managed history
    // (prevents /history from duplicating turns from both sources)
    const hasRuntimeHistory = session.sourcePath && this.sessionBaseDir
      && session.sourcePath.startsWith(this.sessionBaseDir);
    if (data.sourcePath && !hasRuntimeHistory) {
      session.providerSourcePath = data.sourcePath;
    }
    if (data.sourcePath && !session.sourcePath) session.sourcePath = data.sourcePath;
    if (data.messageCount != null) session.messageCount = data.messageCount;
    if (data.lastActivity) session.lastActivity = data.lastActivity;
    session.updatedAt = new Date().toISOString();
    this.pendingDiscovered.delete(
      this.discoveredKey(
        session.providerName,
        providerSessionId,
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
      providerInstanceId: incoming.providerInstanceId ?? existing.providerInstanceId,
      summary: incoming.summary ?? existing.summary,
      messageCount: incoming.messageCount ?? existing.messageCount,
      lastActivity: incoming.lastActivity ?? existing.lastActivity,
      model: incoming.model ?? existing.model,
      sourcePath: incoming.sourcePath ?? existing.sourcePath,
      group: incoming.group ?? existing.group,
      workspaceMode: incoming.workspaceMode ?? existing.workspaceMode,
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

  private sameProviderInstance(providerName: string, left?: string, right?: string): boolean {
    return (this.normalizeProviderInstanceId(providerName, left) || 'default')
      === (this.normalizeProviderInstanceId(providerName, right) || 'default');
  }

  private discoveredKey(
    providerName: string,
    providerSessionId: string,
    providerInstanceId?: string,
  ): string {
    return `${this.normalizeProviderInstanceId(providerName, providerInstanceId) || 'default'}:${providerSessionId}`;
  }

  private mergeLoadedDuplicate(target: SessionInfo, incoming: SessionInfo): void {
    target.providerInstanceId = this.normalizeProviderInstanceId(
      target.providerName,
      target.providerInstanceId ?? incoming.providerInstanceId,
    );
    if (!target.providerSessionId && incoming.providerSessionId) {
      target.providerSessionId = incoming.providerSessionId;
    }
    if (!target.cwd && incoming.cwd) target.cwd = incoming.cwd;
    if (!target.workspaceMode && incoming.workspaceMode) target.workspaceMode = incoming.workspaceMode;
    if (!target.model && incoming.model) target.model = incoming.model;
    if (!target.group && incoming.group) target.group = incoming.group;
    if (!target.summary && incoming.summary) target.summary = incoming.summary;
    if (!target.sourcePath && incoming.sourcePath) target.sourcePath = incoming.sourcePath;
    if (!target.providerSourcePath && incoming.providerSourcePath) {
      target.providerSourcePath = incoming.providerSourcePath;
    }
    target.messageCount = Math.max(target.messageCount, incoming.messageCount);
    target.totalInputTokens = Math.max(target.totalInputTokens, incoming.totalInputTokens);
    target.totalOutputTokens = Math.max(target.totalOutputTokens, incoming.totalOutputTokens);
    target.createdAt = earlierTimestamp(target.createdAt, incoming.createdAt);
    target.updatedAt = laterTimestamp(target.updatedAt, incoming.updatedAt);
    target.lastActivity = laterOptionalTimestamp(target.lastActivity, incoming.lastActivity);
  }
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
