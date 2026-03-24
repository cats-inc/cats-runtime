import type {
  RuntimeBrowserCleanupResult,
  RuntimeBrowserService,
} from './RuntimeBrowserService.js';

const DEFAULT_BROWSER_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_CLOSED_BROWSER_SESSION_TTL_MS = 30 * 60 * 1000;

export interface RuntimeBrowserMaintenanceSnapshot {
  policy: {
    sweepIntervalMs: number;
    closedSessionTtlMs: number;
  };
  lastSweep?: RuntimeBrowserCleanupResult & {
    observedAt: string;
  };
}

export interface RuntimeBrowserMaintenanceServiceOptions {
  browser: Pick<RuntimeBrowserService, 'cleanupSessions'>;
  now?: () => Date;
  sweepIntervalMs?: number;
  closedSessionTtlMs?: number;
}

export class RuntimeBrowserMaintenanceService {
  private readonly now: () => Date;
  private readonly sweepIntervalMs: number;
  private readonly closedSessionTtlMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastSweep: RuntimeBrowserMaintenanceSnapshot['lastSweep'];

  constructor(
    private readonly options: RuntimeBrowserMaintenanceServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.sweepIntervalMs = Math.max(1_000, options.sweepIntervalMs ?? DEFAULT_BROWSER_SWEEP_INTERVAL_MS);
    this.closedSessionTtlMs = Math.max(
      60_000,
      options.closedSessionTtlMs ?? DEFAULT_CLOSED_BROWSER_SESSION_TTL_MS,
    );
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

  snapshot(): RuntimeBrowserMaintenanceSnapshot {
    return {
      policy: {
        sweepIntervalMs: this.sweepIntervalMs,
        closedSessionTtlMs: this.closedSessionTtlMs,
      },
      ...(this.lastSweep ? { lastSweep: cloneSweep(this.lastSweep) } : {}),
    };
  }

  sweep(): RuntimeBrowserMaintenanceSnapshot['lastSweep'] {
    const result = this.options.browser.cleanupSessions({
      olderThanMs: this.closedSessionTtlMs,
    });
    this.lastSweep = {
      observedAt: this.now().toISOString(),
      ...result,
    };
    return cloneSweep(this.lastSweep);
  }

  private async runSweep(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      this.sweep();
    } finally {
      this.running = false;
    }
  }
}

function cloneSweep(
  sweep: NonNullable<RuntimeBrowserMaintenanceSnapshot['lastSweep']>,
): NonNullable<RuntimeBrowserMaintenanceSnapshot['lastSweep']> {
  return {
    ...sweep,
    filters: {
      ...sweep.filters,
    },
    removedSessionIds: [...sweep.removedSessionIds],
  };
}
