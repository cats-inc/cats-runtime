import type { PeerRuntimeConfig } from './types.js';
import {
  normalizePeerLimitKey,
  peerIdFromCallerKey,
  resolvePeerLimitOverride,
} from './limitOverrides.js';

interface PeerExecutionAdmissionServiceOptions {
  config: Pick<
    PeerRuntimeConfig,
    | 'authFailureWindowMs'
    | 'maxAuthFailuresPerWindow'
    | 'maxInboundExecutions'
    | 'maxInboundExecutionsPerPeer'
    | 'limitOverrides'
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
    peersWithOverrides: number;
    trackedCallers: number;
    limitedCallers: number;
  };
  inboundExecutions: {
    activeGlobal: number;
    maxGlobal: number;
    maxPerPeer: number;
    peersWithOverrides: number;
    activePeers: number;
    saturated: boolean;
  };
}

export interface PeerExecutionAdmissionPeerStatus {
  peerId: string;
  activeExecutions: number;
  maxPerPeer: number;
  overrideApplied: boolean;
  saturated: boolean;
}

export interface PeerExecutionAdmissionAuthFailureSnapshot {
  callerKey: string;
  failureCount: number;
  maxFailuresPerWindow: number;
  overrideApplied: boolean;
  limited: boolean;
  retryAfterMs: number;
  oldestFailureAt: string;
  newestFailureAt: string;
}

export interface PeerExecutionAdmissionInboundPeerSnapshot {
  peerId: string;
  activeExecutions: number;
  maxPerPeer: number;
  overrideApplied: boolean;
}

export interface PeerExecutionAdmissionSnapshot {
  authFailures: {
    windowMs: number;
    maxFailuresPerWindow: number;
    peersWithOverrides: number;
    trackedCallers: number;
    limitedCallers: number;
    hiddenCallers: number;
    callers: PeerExecutionAdmissionAuthFailureSnapshot[];
  };
  inboundExecutions: {
    activeGlobal: number;
    maxGlobal: number;
    maxPerPeer: number;
    peersWithOverrides: number;
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
  overrideApplied: boolean;
}

export interface PeerExecutionAdmissionRejected {
  ok: false;
  reason: 'global_limit' | 'peer_limit';
  activeGlobal: number;
  activeForPeer: number;
  maxGlobal: number;
  maxPerPeer: number;
  overrideApplied: boolean;
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
    const normalizedKey = normalizePeerLimitKey(key);
    const authFailureLimit = this.resolveAuthFailureLimit(normalizedKey);
    const now = this.now();
    const failures = this.pruneAuthFailures(normalizedKey, now);
    failures.push(now);
    this.authFailures.set(normalizedKey, failures);

    const retryAfterMs = failures.length >= authFailureLimit.maxFailuresPerWindow
      ? Math.max(0, failures[0]! + this.options.config.authFailureWindowMs - now)
      : 0;

    return {
      limited: retryAfterMs > 0,
      retryAfterMs,
      failureCount: failures.length,
    };
  }

  getAuthFailureStatus(key: string): PeerAuthFailureStatus {
    const normalizedKey = normalizePeerLimitKey(key);
    const authFailureLimit = this.resolveAuthFailureLimit(normalizedKey);
    const now = this.now();
    const failures = this.pruneAuthFailures(normalizedKey, now);
    this.persistOrDeleteFailures(normalizedKey, failures);

    const retryAfterMs = failures.length >= authFailureLimit.maxFailuresPerWindow
      ? Math.max(0, failures[0]! + this.options.config.authFailureWindowMs - now)
      : 0;

    return {
      limited: retryAfterMs > 0,
      retryAfterMs,
      failureCount: failures.length,
    };
  }

  clearAuthFailures(key: string): void {
    this.authFailures.delete(normalizePeerLimitKey(key));
  }

  getSummary(): PeerExecutionAdmissionSummary {
    const now = this.now();
    const authFailures = this.collectAuthFailureEntries(now);

    return {
      authFailures: {
        windowMs: this.options.config.authFailureWindowMs,
        maxFailuresPerWindow: this.options.config.maxAuthFailuresPerWindow,
        peersWithOverrides: this.countPeersWithAuthFailureOverrides(),
        trackedCallers: authFailures.length,
        limitedCallers: authFailures.filter((entry) => entry.limited).length,
      },
      inboundExecutions: {
        activeGlobal: this.activeGlobal,
        maxGlobal: this.options.config.maxInboundExecutions,
        maxPerPeer: this.options.config.maxInboundExecutionsPerPeer,
        peersWithOverrides: this.countPeersWithInboundOverrides(),
        activePeers: this.activeByPeer.size,
        saturated: this.activeGlobal >= this.options.config.maxInboundExecutions,
      },
    };
  }

  getInboundExecutionStatus(peerId: string): PeerExecutionAdmissionPeerStatus {
    const normalizedPeerId = normalizePeerLimitKey(peerId);
    const perPeerLimit = this.resolveInboundLimit(normalizedPeerId);
    const activeExecutions = this.activeByPeer.get(normalizedPeerId) ?? 0;

    return {
      peerId: normalizedPeerId,
      activeExecutions,
      maxPerPeer: perPeerLimit.maxPerPeer,
      overrideApplied: perPeerLimit.overrideApplied,
      saturated: activeExecutions >= perPeerLimit.maxPerPeer,
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
        peersWithOverrides: this.countPeersWithAuthFailureOverrides(),
        trackedCallers: this.authFailures.size,
        limitedCallers,
        hiddenCallers: Math.max(0, this.authFailures.size - visibleAuthFailureEntries.length),
        callers: visibleAuthFailureEntries.map((entry) => ({
          callerKey: entry.callerKey,
          failureCount: entry.failureCount,
          maxFailuresPerWindow: entry.maxFailuresPerWindow,
          overrideApplied: entry.overrideApplied,
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
        peersWithOverrides: this.countPeersWithInboundOverrides(),
        activePeers: this.activeByPeer.size,
        hiddenPeers: Math.max(0, this.activeByPeer.size - Math.min(this.activeByPeer.size, maxPeers)),
        peers: inboundPeers
          .slice(0, maxPeers)
          .map(([peerId, activeExecutions]) => {
            const perPeerLimit = this.resolveInboundLimit(peerId);
            return ({
              peerId,
              activeExecutions,
              maxPerPeer: perPeerLimit.maxPerPeer,
              overrideApplied: perPeerLimit.overrideApplied,
            });
          }),
      },
    };
  }

  acquireInboundExecution(peerId: string): PeerExecutionAdmissionDecision {
    const normalizedPeerId = normalizePeerLimitKey(peerId);
    const perPeerLimit = this.resolveInboundLimit(normalizedPeerId);
    const activeForPeer = this.activeByPeer.get(normalizedPeerId) ?? 0;

    if (this.activeGlobal >= this.options.config.maxInboundExecutions) {
      return {
        ok: false,
        reason: 'global_limit',
        activeGlobal: this.activeGlobal,
        activeForPeer,
        maxGlobal: this.options.config.maxInboundExecutions,
        maxPerPeer: perPeerLimit.maxPerPeer,
        overrideApplied: perPeerLimit.overrideApplied,
      };
    }

    if (activeForPeer >= perPeerLimit.maxPerPeer) {
      return {
        ok: false,
        reason: 'peer_limit',
        activeGlobal: this.activeGlobal,
        activeForPeer,
        maxGlobal: this.options.config.maxInboundExecutions,
        maxPerPeer: perPeerLimit.maxPerPeer,
        overrideApplied: perPeerLimit.overrideApplied,
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
      overrideApplied: perPeerLimit.overrideApplied,
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

  private collectAuthFailureEntries(now: number): AuthFailureEntry[] {
    const entries: AuthFailureEntry[] = [];

    for (const key of this.authFailures.keys()) {
      const failures = this.pruneAuthFailures(key, now);
      this.persistOrDeleteFailures(key, failures);
      if (failures.length === 0) {
        continue;
      }

      const authFailureLimit = this.resolveAuthFailureLimit(key);
      const resolvedRetryAfterMs = failures.length >= authFailureLimit.maxFailuresPerWindow
        ? Math.max(0, failures[0]! + this.options.config.authFailureWindowMs - now)
        : 0;

      entries.push({
        callerKey: key,
        failureCount: failures.length,
        maxFailuresPerWindow: authFailureLimit.maxFailuresPerWindow,
        overrideApplied: authFailureLimit.overrideApplied,
        limited: resolvedRetryAfterMs > 0,
        retryAfterMs: resolvedRetryAfterMs,
        oldestFailureAt: failures[0]!,
        newestFailureAt: failures[failures.length - 1]!,
      });
    }

    return entries;
  }

  private resolveAuthFailureLimit(callerKey: string): ResolvedPeerAuthFailureLimit {
    const peerId = peerIdFromCallerKey(callerKey);
    const override = resolvePeerLimitOverride(this.options.config.limitOverrides, peerId);
    const maxFailuresPerWindow = hasPositiveOverride(override?.maxAuthFailuresPerWindow)
      ? override.maxAuthFailuresPerWindow
      : this.options.config.maxAuthFailuresPerWindow;

    return {
      maxFailuresPerWindow,
      overrideApplied: hasPositiveOverride(override?.maxAuthFailuresPerWindow),
    };
  }

  private resolveInboundLimit(peerId: string): ResolvedPeerInboundLimit {
    const override = resolvePeerLimitOverride(this.options.config.limitOverrides, peerId);
    const maxPerPeer = hasPositiveOverride(override?.maxInboundExecutions)
      ? override.maxInboundExecutions
      : this.options.config.maxInboundExecutionsPerPeer;

    return {
      maxPerPeer,
      overrideApplied: hasPositiveOverride(override?.maxInboundExecutions),
    };
  }

  private countPeersWithAuthFailureOverrides(): number {
    return this.options.config.limitOverrides
      .filter((override) => hasPositiveOverride(override.maxAuthFailuresPerWindow))
      .length;
  }

  private countPeersWithInboundOverrides(): number {
    return this.options.config.limitOverrides
      .filter((override) => hasPositiveOverride(override.maxInboundExecutions))
      .length;
  }
}

interface ResolvedPeerAuthFailureLimit {
  maxFailuresPerWindow: number;
  overrideApplied: boolean;
}

interface ResolvedPeerInboundLimit {
  maxPerPeer: number;
  overrideApplied: boolean;
}

type AuthFailureEntry = {
  callerKey: string;
  failureCount: number;
  maxFailuresPerWindow: number;
  overrideApplied: boolean;
  limited: boolean;
  retryAfterMs: number;
  oldestFailureAt: number;
  newestFailureAt: number;
};

function hasPositiveOverride(
  value: number | undefined,
): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
