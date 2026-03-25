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
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}
