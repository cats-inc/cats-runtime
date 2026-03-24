import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import type { RuntimeSessionManager } from '../runtime/RuntimeSessionManager.js';
import { cleanupOrphanedWorktree } from './sessionWorkspace.js';

const DEFAULT_WORKTREE_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_RETAINED_WORKTREE_TTL_MS = 24 * 60 * 60 * 1000;

export interface RuntimeWorktreeMaintenanceSweepResult {
  observedAt: string;
  orphanedWorktreeCount: number;
  removedOrphanedWorktreeCount: number;
  failedOrphanedWorktreeCount: number;
  orphanedWorktreePaths: string[];
  failedOrphanedWorktreePaths: string[];
  retainedSessionCount: number;
  expiredRetainedSessionCount: number;
  expiredRetainedSessionIds: string[];
  autoCleanedRetainedSessionCount: number;
  failedAutoCleanedRetainedSessionCount: number;
  autoCleanedRetainedSessionIds: string[];
  failedAutoCleanedRetainedSessionIds: string[];
}

export interface RuntimeWorktreeMaintenanceSnapshot {
  policy: {
    sweepIntervalMs: number;
    retainedTtlMs: number;
  };
  lastSweep?: RuntimeWorktreeMaintenanceSweepResult;
}

export interface RuntimeWorktreeMaintenanceServiceOptions {
  sessionBaseDir: string;
  registry: Pick<SessionRegistry, 'get' | 'list'>;
  runtime: Pick<RuntimeSessionManager, 'isAttached'>;
  cleanupExpiredRetainedSession?: (sessionId: string) => Promise<{ status: 'completed' | 'deleted' | 'retained' }>;
  now?: () => Date;
  sweepIntervalMs?: number;
  retainedTtlMs?: number;
}

export class RuntimeWorktreeMaintenanceService {
  private readonly now: () => Date;
  private readonly sweepIntervalMs: number;
  private readonly retainedTtlMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastSweep: RuntimeWorktreeMaintenanceSweepResult | undefined;

  constructor(
    private readonly options: RuntimeWorktreeMaintenanceServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.sweepIntervalMs = Math.max(1_000, options.sweepIntervalMs ?? DEFAULT_WORKTREE_SWEEP_INTERVAL_MS);
    this.retainedTtlMs = Math.max(60_000, options.retainedTtlMs ?? DEFAULT_RETAINED_WORKTREE_TTL_MS);
  }

  start(): void {
    if (this.timer) {
      return;
    }

    void this.runSweep();
    this.timer = setInterval(() => {
      void this.runSweep();
    }, this.sweepIntervalMs);
  }

  close(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): RuntimeWorktreeMaintenanceSnapshot {
    return {
      policy: {
        sweepIntervalMs: this.sweepIntervalMs,
        retainedTtlMs: this.retainedTtlMs,
      },
      ...(this.lastSweep ? { lastSweep: cloneSweepResult(this.lastSweep) } : {}),
    };
  }

  async sweep(): Promise<RuntimeWorktreeMaintenanceSweepResult> {
    const observedAt = this.now().toISOString();
    const sessions = this.options.registry.list();
    const retainedSessions = sessions.filter((session) =>
      session.status === 'closed'
      && session.workspaceIsolation?.mode === 'worktree'
      && session.workspaceIsolation.worktree?.lastCleanup?.status === 'retained'
      && !this.options.runtime.isAttached(session.id),
    );
    const expiredRetainedSessionIds = retainedSessions
      .filter((session) => {
        const observedAtMs = Date.parse(session.workspaceIsolation!.worktree!.lastCleanup!.observedAt);
        return Number.isFinite(observedAtMs)
          && this.now().getTime() - observedAtMs >= this.retainedTtlMs;
      })
      .map((session) => session.id)
      .sort();
    const autoCleanedRetainedSessionIds: string[] = [];
    const failedAutoCleanedRetainedSessionIds: string[] = [];

    if (this.options.cleanupExpiredRetainedSession) {
      const expiredPreservedSessions = retainedSessions
        .filter((session) => {
          const lastCleanup = session.workspaceIsolation?.worktree?.lastCleanup;
          if (lastCleanup?.policy !== 'preserve') {
            return false;
          }
          const observedAtMs = Date.parse(lastCleanup.observedAt);
          return Number.isFinite(observedAtMs)
            && this.now().getTime() - observedAtMs >= this.retainedTtlMs;
        })
        .sort((left, right) => left.id.localeCompare(right.id));

      for (const session of expiredPreservedSessions) {
        try {
          const result = await this.options.cleanupExpiredRetainedSession(session.id);
          if (result.status === 'retained') {
            failedAutoCleanedRetainedSessionIds.push(session.id);
            continue;
          }
          autoCleanedRetainedSessionIds.push(session.id);
        } catch {
          failedAutoCleanedRetainedSessionIds.push(session.id);
        }
      }
    }

    const trackedWorktrees = new Map<string, string>();
    for (const session of sessions) {
      const worktreePath = session.workspaceIsolation?.mode === 'worktree'
        ? session.workspaceIsolation.worktree?.worktreePath
        : undefined;
      if (!worktreePath) {
        continue;
      }
      trackedWorktrees.set(normalizePath(worktreePath), session.id);
    }

    const orphanedWorktreePaths = await this.collectOrphanedWorktreePaths(trackedWorktrees);
    const failedOrphanedWorktreePaths: string[] = [];
    let removedOrphanedWorktreeCount = 0;

    for (const orphanedWorktreePath of orphanedWorktreePaths) {
      const result = await cleanupOrphanedWorktree(orphanedWorktreePath);
      if (result.removed) {
        removedOrphanedWorktreeCount += 1;
      } else {
        failedOrphanedWorktreePaths.push(orphanedWorktreePath);
      }
    }

    const sweep: RuntimeWorktreeMaintenanceSweepResult = {
      observedAt,
      orphanedWorktreeCount: orphanedWorktreePaths.length,
      removedOrphanedWorktreeCount,
      failedOrphanedWorktreeCount: failedOrphanedWorktreePaths.length,
      orphanedWorktreePaths: [...orphanedWorktreePaths],
      failedOrphanedWorktreePaths,
      retainedSessionCount: retainedSessions.length,
      expiredRetainedSessionCount: expiredRetainedSessionIds.length,
      expiredRetainedSessionIds,
      autoCleanedRetainedSessionCount: autoCleanedRetainedSessionIds.length,
      failedAutoCleanedRetainedSessionCount: failedAutoCleanedRetainedSessionIds.length,
      autoCleanedRetainedSessionIds,
      failedAutoCleanedRetainedSessionIds,
    };
    this.lastSweep = sweep;
    return cloneSweepResult(sweep);
  }

  private async runSweep(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      await this.sweep();
    } finally {
      this.running = false;
    }
  }

  private async collectOrphanedWorktreePaths(
    trackedWorktrees: ReadonlyMap<string, string>,
  ): Promise<string[]> {
    const worktreesRoot = join(this.options.sessionBaseDir, 'worktrees');
    try {
      const repoBuckets = await readdir(worktreesRoot, { withFileTypes: true });
      const orphaned: string[] = [];

      for (const repoBucket of repoBuckets) {
        if (!repoBucket.isDirectory()) {
          continue;
        }
        const repoBucketPath = join(worktreesRoot, repoBucket.name);
        const worktrees = await readdir(repoBucketPath, { withFileTypes: true });
        for (const worktreeEntry of worktrees) {
          if (!worktreeEntry.isDirectory()) {
            continue;
          }

          const worktreePath = normalizePath(join(repoBucketPath, worktreeEntry.name));
          const trackedSessionId = trackedWorktrees.get(worktreePath);
          if (!trackedSessionId) {
            orphaned.push(worktreePath);
            continue;
          }

          const session = this.options.registry.get(trackedSessionId);
          const expectedPath = session?.workspaceIsolation?.mode === 'worktree'
            ? session.workspaceIsolation.worktree?.worktreePath
            : undefined;
          if (!expectedPath || normalizePath(expectedPath) !== worktreePath) {
            orphaned.push(worktreePath);
          }
        }
      }

      return orphaned.sort();
    } catch {
      return [];
    }
  }
}

function cloneSweepResult(
  sweep: RuntimeWorktreeMaintenanceSweepResult,
): RuntimeWorktreeMaintenanceSweepResult {
  return {
    ...sweep,
    orphanedWorktreePaths: [...sweep.orphanedWorktreePaths],
    failedOrphanedWorktreePaths: [...sweep.failedOrphanedWorktreePaths],
    expiredRetainedSessionIds: [...sweep.expiredRetainedSessionIds],
    autoCleanedRetainedSessionIds: [...sweep.autoCleanedRetainedSessionIds],
    failedAutoCleanedRetainedSessionIds: [...sweep.failedAutoCleanedRetainedSessionIds],
  };
}

function normalizePath(value: string): string {
  return resolve(value);
}
