import type { PeerRuntimeConfig } from './types.js';

interface PeerExecutionAdmissionServiceOptions {
  config: Pick<
    PeerRuntimeConfig,
    | 'authFailureWindowMs'
    | 'maxAuthFailuresPerWindow'
    | 'maxInboundExecutions'
    | 'maxInboundExecutionsPerPeer'
  >;
  now?: () => number;
}

export interface PeerAuthFailureStatus {
  limited: boolean;
  retryAfterMs: number;
  failureCount: number;
}

export interface PeerExecutionAdmissionSummary {
  authFailures: {
    windowMs: number;
    maxFailuresPerWindow: number;
    trackedCallers: number;
    limitedCallers: number;
  };
  inboundExecutions: {
    activeGlobal: number;
    maxGlobal: number;
    maxPerPeer: number;
    activePeers: number;
    saturated: boolean;
  };
}

export interface PeerExecutionAdmissionPeerStatus {
  peerId: string;
  activeExecutions: number;
  maxPerPeer: number;
  saturated: boolean;
}

export interface PeerExecutionAdmissionAuthFailureSnapshot {
  callerKey: string;
  failureCount: number;
  limited: boolean;
  retryAfterMs: number;
  oldestFailureAt: string;
  newestFailureAt: string;
}

export interface PeerExecutionAdmissionInboundPeerSnapshot {
  peerId: string;
  activeExecutions: number;
}

export interface PeerExecutionAdmissionSnapshot {
  authFailures: {
    windowMs: number;
    maxFailuresPerWindow: number;
    trackedCallers: number;
    limitedCallers: number;
    hiddenCallers: number;
    callers: PeerExecutionAdmissionAuthFailureSnapshot[];
  };
  inboundExecutions: {
    activeGlobal: number;
    maxGlobal: number;
    maxPerPeer: number;
    activePeers: number;
    hiddenPeers: number;
    peers: PeerExecutionAdmissionInboundPeerSnapshot[];
  };
}

export interface PeerExecutionAdmissionGranted {
  ok: true;
  release: () => void;
  activeGlobal: number;
  activeForPeer: number;
}

export interface PeerExecutionAdmissionRejected {
  ok: false;
  reason: 'global_limit' | 'peer_limit';
  activeGlobal: number;
  activeForPeer: number;
  maxGlobal: number;
  maxPerPeer: number;
}

export type PeerExecutionAdmissionDecision =
  | PeerExecutionAdmissionGranted
  | PeerExecutionAdmissionRejected;

export class PeerExecutionAdmissionService {
  private readonly authFailures = new Map<string, number[]>();

  private readonly activeByPeer = new Map<string, number>();

  private activeGlobal = 0;

  private readonly now: () => number;

  constructor(private readonly options: PeerExecutionAdmissionServiceOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  recordAuthFailure(key: string): PeerAuthFailureStatus {
    const normalizedKey = normalizeKey(key);
    const now = this.now();
    const failures = this.pruneAuthFailures(normalizedKey, now);
    failures.push(now);
    this.authFailures.set(normalizedKey, failures);

    const retryAfterMs = failures.length >= this.options.config.maxAuthFailuresPerWindow
      ? Math.max(0, failures[0]! + this.options.config.authFailureWindowMs - now)
      : 0;

    return {
      limited: retryAfterMs > 0,
      retryAfterMs,
      failureCount: failures.length,
    };
  }

  getAuthFailureStatus(key: string): PeerAuthFailureStatus {
    const normalizedKey = normalizeKey(key);
    const now = this.now();
    const failures = this.pruneAuthFailures(normalizedKey, now);
    this.persistOrDeleteFailures(normalizedKey, failures);

    const retryAfterMs = failures.length >= this.options.config.maxAuthFailuresPerWindow
      ? Math.max(0, failures[0]! + this.options.config.authFailureWindowMs - now)
      : 0;

    return {
      limited: retryAfterMs > 0,
      retryAfterMs,
      failureCount: failures.length,
    };
  }

  clearAuthFailures(key: string): void {
    this.authFailures.delete(normalizeKey(key));
  }

  getSummary(): PeerExecutionAdmissionSummary {
    const now = this.now();
    const authFailures = this.collectAuthFailureEntries(now);

    return {
      authFailures: {
        windowMs: this.options.config.authFailureWindowMs,
        maxFailuresPerWindow: this.options.config.maxAuthFailuresPerWindow,
        trackedCallers: authFailures.length,
        limitedCallers: authFailures.filter((entry) => entry.limited).length,
      },
      inboundExecutions: {
        activeGlobal: this.activeGlobal,
        maxGlobal: this.options.config.maxInboundExecutions,
        maxPerPeer: this.options.config.maxInboundExecutionsPerPeer,
        activePeers: this.activeByPeer.size,
        saturated: this.activeGlobal >= this.options.config.maxInboundExecutions,
      },
    };
  }

  getInboundExecutionStatus(peerId: string): PeerExecutionAdmissionPeerStatus {
    const normalizedPeerId = normalizeKey(peerId);
    const activeExecutions = this.activeByPeer.get(normalizedPeerId) ?? 0;

    return {
      peerId: normalizedPeerId,
      activeExecutions,
      maxPerPeer: this.options.config.maxInboundExecutionsPerPeer,
      saturated: activeExecutions >= this.options.config.maxInboundExecutionsPerPeer,
    };
  }

  snapshot(
    options: {
      maxCallers?: number;
      maxPeers?: number;
    } = {},
  ): PeerExecutionAdmissionSnapshot {
    const maxCallers = Math.max(1, options.maxCallers ?? 10);
    const maxPeers = Math.max(1, options.maxPeers ?? 10);
    const now = this.now();
    const authFailureEntries = this.collectAuthFailureEntries(now);
    const limitedCallers = authFailureEntries.filter((entry) => entry.limited).length;
    const visibleAuthFailureEntries = authFailureEntries
      .sort((left, right) =>
        Number(right.limited) - Number(left.limited)
        || right.failureCount - left.failureCount
        || right.retryAfterMs - left.retryAfterMs
        || right.callerKey.localeCompare(left.callerKey))
      .slice(0, maxCallers);
    const inboundPeers = Array.from(this.activeByPeer.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

    return {
      authFailures: {
        windowMs: this.options.config.authFailureWindowMs,
        maxFailuresPerWindow: this.options.config.maxAuthFailuresPerWindow,
        trackedCallers: this.authFailures.size,
        limitedCallers,
        hiddenCallers: Math.max(0, this.authFailures.size - visibleAuthFailureEntries.length),
        callers: visibleAuthFailureEntries.map((entry) => ({
          callerKey: entry.callerKey,
          failureCount: entry.failureCount,
          limited: entry.limited,
          retryAfterMs: entry.retryAfterMs,
          oldestFailureAt: new Date(entry.oldestFailureAt).toISOString(),
          newestFailureAt: new Date(entry.newestFailureAt).toISOString(),
        })),
      },
      inboundExecutions: {
        activeGlobal: this.activeGlobal,
        maxGlobal: this.options.config.maxInboundExecutions,
        maxPerPeer: this.options.config.maxInboundExecutionsPerPeer,
        activePeers: this.activeByPeer.size,
        hiddenPeers: Math.max(0, this.activeByPeer.size - Math.min(this.activeByPeer.size, maxPeers)),
        peers: inboundPeers
          .slice(0, maxPeers)
          .map(([peerId, activeExecutions]) => ({
            peerId,
            activeExecutions,
          })),
      },
    };
  }

  acquireInboundExecution(peerId: string): PeerExecutionAdmissionDecision {
    const normalizedPeerId = normalizeKey(peerId);
    const activeForPeer = this.activeByPeer.get(normalizedPeerId) ?? 0;

    if (this.activeGlobal >= this.options.config.maxInboundExecutions) {
      return {
        ok: false,
        reason: 'global_limit',
        activeGlobal: this.activeGlobal,
        activeForPeer,
        maxGlobal: this.options.config.maxInboundExecutions,
        maxPerPeer: this.options.config.maxInboundExecutionsPerPeer,
      };
    }

    if (activeForPeer >= this.options.config.maxInboundExecutionsPerPeer) {
      return {
        ok: false,
        reason: 'peer_limit',
        activeGlobal: this.activeGlobal,
        activeForPeer,
        maxGlobal: this.options.config.maxInboundExecutions,
        maxPerPeer: this.options.config.maxInboundExecutionsPerPeer,
      };
    }

    this.activeGlobal += 1;
    this.activeByPeer.set(normalizedPeerId, activeForPeer + 1);

    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) {
          return;
        }
        released = true;

        this.activeGlobal = Math.max(0, this.activeGlobal - 1);
        const current = this.activeByPeer.get(normalizedPeerId) ?? 0;
        if (current <= 1) {
          this.activeByPeer.delete(normalizedPeerId);
        } else {
          this.activeByPeer.set(normalizedPeerId, current - 1);
        }
      },
      activeGlobal: this.activeGlobal,
      activeForPeer: activeForPeer + 1,
    };
  }

  private pruneAuthFailures(key: string, now: number): number[] {
    const cutoff = now - this.options.config.authFailureWindowMs;
    const existing = this.authFailures.get(key) ?? [];
    return existing.filter((timestamp) => timestamp > cutoff);
  }

  private persistOrDeleteFailures(key: string, failures: number[]): void {
    if (failures.length === 0) {
      this.authFailures.delete(key);
      return;
    }
    this.authFailures.set(key, failures);
  }

  private collectAuthFailureEntries(now: number): Array<{
    callerKey: string;
    failureCount: number;
    limited: boolean;
    retryAfterMs: number;
    oldestFailureAt: number;
    newestFailureAt: number;
  }> {
    const entries: Array<{
      callerKey: string;
      failureCount: number;
      limited: boolean;
      retryAfterMs: number;
      oldestFailureAt: number;
      newestFailureAt: number;
    }> = [];

    for (const key of this.authFailures.keys()) {
      const failures = this.pruneAuthFailures(key, now);
      this.persistOrDeleteFailures(key, failures);
      if (failures.length === 0) {
        continue;
      }

      const retryAfterMs = failures.length >= this.options.config.maxAuthFailuresPerWindow
        ? Math.max(0, failures[0]! + this.options.config.authFailureWindowMs - now)
        : 0;

      entries.push({
        callerKey: key,
        failureCount: failures.length,
        limited: retryAfterMs > 0,
        retryAfterMs,
        oldestFailureAt: failures[0]!,
        newestFailureAt: failures[failures.length - 1]!,
      });
    }

    return entries;
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}
