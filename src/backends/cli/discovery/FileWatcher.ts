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
    try {
      await this.scanAndMerge();
    } catch (err) {
      if (isMissingPathError(err)) {
        return;
      }
      throw err;
    }

    if (!existsSync(this.watchDir)) {
      return;
    }

    try {
      this.watcher = watch(this.watchDir, { recursive: true }, (_eventType, _filename) => {
        // Debounce: multiple file changes happen rapidly
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.scanAndMerge().catch((err) => {
            if (isMissingPathError(err)) {
              this.stop();
              return;
            }
            this.emit('error', err);
          });
        }, this.debounceMs);
      });

      this.watcher.on('error', (err) => {
        if (isMissingPathError(err)) {
          this.stop();
          return;
        }
        this.emit('error', err);
      });
    } catch (err) {
      if (isMissingPathError(err)) {
        return;
      }
      // fs.watch may fail on some platforms/paths — non-fatal
      console.warn(`[discovery] Could not watch ${this.watchDir}:`, err);
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private async scanAndMerge(): Promise<void> {
    const discovered = await this.scanner.scan();
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
