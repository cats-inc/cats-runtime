import type { PeerRuntimeConfig } from './types.js';
import {
  normalizePeerLimitKey,
  peerIdFromCallerKey,
  resolvePeerLimitOverride,
} from './limitOverrides.js';

interface PeerExecutionReplayServiceOptions {
  config: Pick<
    PeerRuntimeConfig,
    'replayWindowMs' | 'replayNonceTtlMs' | 'maxReplayNoncesPerCaller' | 'limitOverrides'
  >;
  now?: () => number;
}

export type PeerExecutionReplayDecision =
  | { ok: true }
  | {
      ok: false;
      reason: 'stale' | 'replayed';
      message: string;
      details: Record<string, unknown>;
    };

export interface PeerExecutionReplaySummary {
  replayWindowMs: number;
  nonceTtlMs: number;
  maxNoncesPerCaller: number;
  peersWithOverrides: number;
  trackedCallers: number;
  trackedNonces: number;
}

export interface PeerExecutionReplayCallerSummary {
  callerKey: string;
  trackedNonces: number;
  maxNoncesPerCaller: number;
  overrideApplied: boolean;
}

export interface PeerExecutionReplayCallerSnapshot {
  callerKey: string;
  trackedNonces: number;
  maxNoncesPerCaller: number;
  overrideApplied: boolean;
  newestNonceExpiresAt: string;
}

export interface PeerExecutionReplaySnapshot {
  replayWindowMs: number;
  nonceTtlMs: number;
  maxNoncesPerCaller: number;
  peersWithOverrides: number;
  trackedCallers: number;
  trackedNonces: number;
  hiddenCallers: number;
  callers: PeerExecutionReplayCallerSnapshot[];
}

export class PeerExecutionReplayService {
  private readonly seenByCaller = new Map<string, Map<string, number>>();

  private readonly now: () => number;

  constructor(private readonly options: PeerExecutionReplayServiceOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  validate(callerKey: string, timestampMs: number, nonce: string): PeerExecutionReplayDecision {
    const normalizedCallerKey = normalizePeerLimitKey(callerKey);
    const normalizedNonce = normalizeNonce(nonce);
    const callerLimit = this.resolveNonceLimit(normalizedCallerKey);
    const now = this.now();

    if (Math.abs(now - timestampMs) > this.options.config.replayWindowMs) {
      return {
        ok: false,
        reason: 'stale',
        message: 'Peer execution auth timestamp is outside the allowed replay window.',
        details: {
          callerKey: normalizedCallerKey,
          replayWindowMs: this.options.config.replayWindowMs,
          now,
          timestampMs,
        },
      };
    }

    const callerNonces = this.pruneCallerNonces(normalizedCallerKey, now);
    if (callerNonces.has(normalizedNonce)) {
      return {
        ok: false,
        reason: 'replayed',
        message: 'Peer execution auth nonce has already been used inside the replay window.',
        details: {
          callerKey: normalizedCallerKey,
          nonce: normalizedNonce,
          replayWindowMs: this.options.config.replayWindowMs,
        },
      };
    }

    callerNonces.set(normalizedNonce, now + this.options.config.replayNonceTtlMs);
    this.trimCallerNonces(callerNonces, callerLimit.maxNoncesPerCaller);
    this.persistOrDeleteCallerNonces(normalizedCallerKey, callerNonces);

    return { ok: true };
  }

  getSummary(): PeerExecutionReplaySummary {
    const callers = this.collectCallerEntries(this.now());

    return {
      replayWindowMs: this.options.config.replayWindowMs,
      nonceTtlMs: this.options.config.replayNonceTtlMs,
      maxNoncesPerCaller: this.options.config.maxReplayNoncesPerCaller,
      peersWithOverrides: this.countPeersWithReplayOverrides(),
      trackedCallers: callers.length,
      trackedNonces: callers.reduce((total, caller) => total + caller.trackedNonces, 0),
    };
  }

  getCallerSummary(callerKey: string): PeerExecutionReplayCallerSummary {
    const normalizedCallerKey = normalizePeerLimitKey(callerKey);
    const callerLimit = this.resolveNonceLimit(normalizedCallerKey);
    const callers = this.collectCallerEntries(this.now());
    const caller = callers.find((entry) => entry.callerKey === normalizedCallerKey);

    return {
      callerKey: normalizedCallerKey,
      trackedNonces: caller?.trackedNonces ?? 0,
      maxNoncesPerCaller: callerLimit.maxNoncesPerCaller,
      overrideApplied: callerLimit.overrideApplied,
    };
  }

  snapshot(options: { maxCallers?: number } = {}): PeerExecutionReplaySnapshot {
    const maxCallers = Math.max(1, options.maxCallers ?? 10);
    const callers = this.collectCallerEntries(this.now())
      .sort((left, right) =>
        right.trackedNonces - left.trackedNonces
        || right.newestNonceExpiresAt - left.newestNonceExpiresAt
        || left.callerKey.localeCompare(right.callerKey));

    return {
      replayWindowMs: this.options.config.replayWindowMs,
      nonceTtlMs: this.options.config.replayNonceTtlMs,
      maxNoncesPerCaller: this.options.config.maxReplayNoncesPerCaller,
      peersWithOverrides: this.countPeersWithReplayOverrides(),
      trackedCallers: callers.length,
      trackedNonces: callers.reduce((total, caller) => total + caller.trackedNonces, 0),
      hiddenCallers: Math.max(0, callers.length - Math.min(callers.length, maxCallers)),
      callers: callers
        .slice(0, maxCallers)
        .map((caller) => ({
          callerKey: caller.callerKey,
          trackedNonces: caller.trackedNonces,
          maxNoncesPerCaller: caller.maxNoncesPerCaller,
          overrideApplied: caller.overrideApplied,
          newestNonceExpiresAt: new Date(caller.newestNonceExpiresAt).toISOString(),
        })),
    };
  }

  private pruneCallerNonces(callerKey: string, now: number): Map<string, number> {
    const current = this.seenByCaller.get(callerKey);
    if (!current) {
      return new Map();
    }

    const next = new Map<string, number>();
    for (const [nonce, expiresAt] of current.entries()) {
      if (expiresAt > now) {
        next.set(nonce, expiresAt);
      }
    }

    return next;
  }

  private trimCallerNonces(callerNonces: Map<string, number>, maxNoncesPerCaller: number): void {
    while (callerNonces.size > maxNoncesPerCaller) {
      const oldestKey = callerNonces.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      callerNonces.delete(oldestKey);
    }
  }

  private persistOrDeleteCallerNonces(callerKey: string, callerNonces: Map<string, number>): void {
    if (callerNonces.size === 0) {
      this.seenByCaller.delete(callerKey);
      return;
    }
    this.seenByCaller.set(callerKey, callerNonces);
  }

  private collectCallerEntries(now: number): ReplayCallerEntry[] {
    const entries: ReplayCallerEntry[] = [];

    for (const callerKey of this.seenByCaller.keys()) {
      const callerNonces = this.pruneCallerNonces(callerKey, now);
      this.persistOrDeleteCallerNonces(callerKey, callerNonces);
      if (callerNonces.size === 0) {
        continue;
      }
      const callerLimit = this.resolveNonceLimit(callerKey);

      entries.push({
        callerKey,
        trackedNonces: callerNonces.size,
        maxNoncesPerCaller: callerLimit.maxNoncesPerCaller,
        overrideApplied: callerLimit.overrideApplied,
        newestNonceExpiresAt: Math.max(...callerNonces.values()),
      });
    }

    return entries;
  }

  private resolveNonceLimit(callerKey: string): ResolvedPeerReplayNonceLimit {
    const peerId = peerIdFromCallerKey(callerKey);
    const override = resolvePeerLimitOverride(this.options.config.limitOverrides, peerId);
    const maxNoncesPerCaller = hasPositiveOverride(override?.maxReplayNoncesPerCaller)
      ? override.maxReplayNoncesPerCaller
      : this.options.config.maxReplayNoncesPerCaller;

    return {
      maxNoncesPerCaller,
      overrideApplied: hasPositiveOverride(override?.maxReplayNoncesPerCaller),
    };
  }

  private countPeersWithReplayOverrides(): number {
    return this.options.config.limitOverrides
      .filter((override) => hasPositiveOverride(override.maxReplayNoncesPerCaller))
      .length;
  }
}

interface ResolvedPeerReplayNonceLimit {
  maxNoncesPerCaller: number;
  overrideApplied: boolean;
}

interface ReplayCallerEntry {
  callerKey: string;
  trackedNonces: number;
  maxNoncesPerCaller: number;
  overrideApplied: boolean;
  newestNonceExpiresAt: number;
}

function hasPositiveOverride(
  value: number | undefined,
): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeNonce(value: string): string {
  return value.trim();
}
