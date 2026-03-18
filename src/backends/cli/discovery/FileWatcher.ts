import { watch, type FSWatcher } from 'node:fs';
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
    await this.scanAndMerge();

    try {
      this.watcher = watch(this.watchDir, { recursive: true }, (_eventType, _filename) => {
        // Debounce: multiple file changes happen rapidly
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.scanAndMerge().catch((err) => {
            this.emit('error', err);
          });
        }, this.debounceMs);
      });

      this.watcher.on('error', (err) => {
        this.emit('error', err);
      });
    } catch (err) {
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
    let newCount = 0;

    const liveStatuses = new Set(['initializing', 'ready', 'busy']);
    const allSessions = this.registry.list();

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

      if (session) newCount++;
    }

    this.registry.pruneMissingDiscovered(
      this.providerName,
      discovered.map((session) => session.providerSessionId),
      'cli',
      this.providerInstanceId,
    );

    if (newCount > 0) {
      this.emit('discovered', { count: newCount });
    }
  }
}
