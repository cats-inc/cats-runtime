import { existsSync, watch, type FSWatcher } from 'node:fs';
import { EventEmitter } from 'node:events';
import type { DiscoveredSession } from './types.js';
import type { SessionRegistry } from '../pool/SessionRegistry.js';

/** Any scanner that can discover sessions */
export interface SessionScannerLike {
  scan(): Promise<DiscoveredSession[]>;
}

interface FileWatcherEvents {
  discovered: [{ count: number }];
  error: [Error];
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (
      (error as NodeJS.ErrnoException).code === 'ENOENT'
      || (error as NodeJS.ErrnoException).code === 'ENOTDIR'
    );
}

export class FileWatcher extends EventEmitter<FileWatcherEvents> {
  private watchDir: string;
  private scanner: SessionScannerLike;
  private providerName: string;
  private registry: SessionRegistry;
  private providerInstanceId?: string;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private scanning = false;
  private rescanRequested = false;
  private generation = 0;
  private debounceMs = 2000;

  constructor(
    watchDir: string,
    scanner: SessionScannerLike,
    providerName: string,
    registry: SessionRegistry,
    providerInstanceId?: string,
  ) {
    super();
    this.watchDir = watchDir;
    this.scanner = scanner;
    this.providerName = providerName;
    this.registry = registry;
    this.providerInstanceId = providerInstanceId;
  }

  /** Run initial scan and start watching */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.generation += 1;
    // A newly installed CLI may not create its session directory until its
    // first conversation. Reattach when it appears (or is recreated).
    this.retryTimer = setInterval(() => {
      if (!this.watcher) void this.scanAndWatch().catch((err) => this.reportError(err));
    }, 5000);
    this.retryTimer.unref();
    await this.scanAndWatch();
  }

  private async scanAndWatch(): Promise<void> {
    if (!this.started) return;
    if (this.scanning) {
      this.rescanRequested = true;
      return;
    }
    this.scanning = true;
    this.rescanRequested = false;
    const generation = this.generation;
    try {
      await this.scanAndMerge(generation);
      if (!this.started || generation !== this.generation) return;
      if (!existsSync(this.watchDir)) {
        this.closeWatcher();
        return;
      }
      if (this.watcher) return;

      this.watcher = watch(this.watchDir, { recursive: true }, () => {
        if (!this.started || generation !== this.generation) return;
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          void this.scanAndWatch().catch((err) => this.reportError(err));
        }, this.debounceMs);
      });
      this.watcher.on('error', (err) => {
        this.closeWatcher();
        this.reportError(err);
      });
    } catch (err) {
      if (isMissingPathError(err)) {
        this.closeWatcher();
        return;
      }
      throw err;
    } finally {
      this.scanning = false;
      if (this.started && this.rescanRequested) {
        void this.scanAndWatch().catch((err) => this.reportError(err));
      }
    }
  }

  private reportError(error: Error): void {
    if (this.started && !isMissingPathError(error)) this.emit('error', error);
  }

  stop(): void {
    this.started = false;
    this.rescanRequested = false;
    this.generation += 1;
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.closeWatcher();
  }

  private closeWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private async scanAndMerge(generation: number): Promise<void> {
    if (!this.started || generation !== this.generation) return;
    const discovered = await this.scanner.scan();
    if (!this.started || generation !== this.generation) return;
    const newlyImported = new Set<string>();

    const liveStatuses = new Set(['initializing', 'ready', 'busy']);
    const allSessions = this.registry.list();
    const knownProviderSessionIds = new Set(
      allSessions
        .filter((session) => (
          session.providerName === this.providerName
          && (session.providerInstanceId || 'default')
            === (this.providerInstanceId || 'default')
        ))
        .map((session) => session.providerSessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    );

    for (const d of discovered) {
      // Skip sessions that have an active worker
      const hasWorker = allSessions.some(
        (s) =>
          s.providerName === this.providerName
          && (s.providerInstanceId || 'default') === (this.providerInstanceId || 'default')
          && s.providerSessionId === d.providerSessionId
          && liveStatuses.has(s.status),
      );
      if (hasWorker) continue;

      const session = this.registry.upsertDiscovered(d.providerSessionId, {
        providerName: this.providerName,
        providerInstanceId: this.providerInstanceId,
        cwd: d.cwd,
        summary: d.summary,
        sourcePath: d.sourcePath,
        messageCount: d.messageCount,
        lastActivity: d.lastActivity,
        model: d.model,
      });

      if (session && !knownProviderSessionIds.has(d.providerSessionId)) {
        newlyImported.add(d.providerSessionId);
      }
    }

    this.registry.pruneMissingDiscovered(
      this.providerName,
      discovered.map((session) => session.providerSessionId),
      'cli',
      this.providerInstanceId,
    );

    if (newlyImported.size > 0) {
      this.emit('discovered', { count: newlyImported.size });
    }
  }
}
