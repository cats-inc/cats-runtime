import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SessionInfo, SessionStatus, WorkspaceMode } from './types.js';
import { normalizeSessionOrigin } from './sessionView.js';

export interface CreateSessionInput {
  id?: string;
  providerName: string;
  cwd: string;
  workspaceMode?: WorkspaceMode;
  model?: string;
  group?: string;
}

export class SessionRegistry {
  private sessions = new Map<string, SessionInfo>();
  private persistPath: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir?: string, private sessionBaseDir?: string) {
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
      for (const loaded of arr) {
        // All sessions come back as closed (no live worker)
        const s: SessionInfo = {
          ...loaded,
          status: 'closed',
          origin: normalizeSessionOrigin(loaded, this.sessionBaseDir),
        };
        // Default missing workspaceMode for backward compat
        if (!s.workspaceMode) s.workspaceMode = 'shared';
        this.sessions.set(s.id, s);
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
      status: 'initializing',
      origin: 'fleet',
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

  /** Remove session from registry and delete source .jsonl file if present */
  remove(id: string): { deleted: boolean; fileDeleted: boolean } {
    const session = this.sessions.get(id);
    if (!session) return { deleted: false, fileDeleted: false };

    // Collect all unique transcript paths to delete
    const pathsToDelete = new Set<string>();
    if (session.sourcePath) pathsToDelete.add(session.sourcePath);
    if (session.providerSourcePath) pathsToDelete.add(session.providerSourcePath);

    let fileDeleted = false;
    for (const filePath of pathsToDelete) {
      try {
        rmSync(filePath, { force: true });
        // Delete sibling directory (session snapshots) if it exists
        const snapshotDir = filePath.replace(/\.jsonl?$/, '');
        rmSync(snapshotDir, { recursive: true, force: true });
        // Remove parent project dir if now empty
        const projectDir = dirname(filePath);
        try {
          const remaining = readdirSync(projectDir);
          if (remaining.length === 0) rmSync(projectDir);
        } catch { /* ignore */ }
        fileDeleted = true;
      } catch {
        // Non-fatal — file may already be gone
      }
    }

    this.sessions.delete(id);
    this.scheduleSave();
    return { deleted: true, fileDeleted };
  }

  /** Upsert a discovered session by provider session ID */
  upsertDiscovered(
    providerSessionId: string,
    data: {
      cwd: string;
      providerName: string;
      summary?: string;
      messageCount?: number;
      lastActivity?: string;
      model?: string;
      sourcePath?: string;
      group?: string;
      workspaceMode?: WorkspaceMode;
    },
  ): SessionInfo | null {
    // Check if we already track this provider session
    for (const session of this.sessions.values()) {
      if (session.providerSessionId === providerSessionId) {
        // Only update metadata, never overwrite status or fleet-owned cwd
        if (!session.cwd || session.origin !== 'fleet') {
          session.cwd = data.cwd;
        }
        if (data.summary) session.summary = data.summary;
        if (data.group && !session.group) session.group = data.group;
        if (data.workspaceMode) session.workspaceMode = data.workspaceMode;
        // Only attach providerSourcePath if session doesn't already have fleet-managed history
        // (prevents /history from duplicating turns from both sources)
        const hasFleetHistory = session.sourcePath && this.sessionBaseDir
          && session.sourcePath.startsWith(this.sessionBaseDir);
        if (data.sourcePath && !hasFleetHistory) {
          session.providerSourcePath = data.sourcePath;
        }
        if (data.sourcePath && !session.sourcePath) session.sourcePath = data.sourcePath;
        if (data.messageCount != null) session.messageCount = data.messageCount;
        if (data.lastActivity) session.lastActivity = data.lastActivity;
        session.updatedAt = new Date().toISOString();
        this.scheduleSave();
        return session;
      }
    }

    // New discovered session — no worker, so status is closed
    const id = randomUUID();
    const now = new Date().toISOString();
    const session: SessionInfo = {
      id,
      providerSessionId,
      providerName: data.providerName,
      status: 'closed',
      origin: 'discovered',
      cwd: data.cwd,
      workspaceMode: data.workspaceMode || 'shared',
      model: data.model,
      group: data.group,
      summary: data.summary,
      sourcePath: data.sourcePath,
      providerSourcePath: data.sourcePath,
      messageCount: data.messageCount ?? 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      createdAt: now,
      updatedAt: now,
      lastActivity: data.lastActivity,
    };

    this.sessions.set(id, session);
    this.scheduleSave();
    return session;
  }
}
