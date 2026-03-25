import type { PeerRuntimeConfig } from './types.js';

interface PeerExecutionReplayServiceOptions {
  config: Pick<
    PeerRuntimeConfig,
    'replayWindowMs' | 'replayNonceTtlMs' | 'maxReplayNoncesPerCaller'
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

export class PeerExecutionReplayService {
  private readonly seenByCaller = new Map<string, Map<string, number>>();

  private readonly now: () => number;

  constructor(private readonly options: PeerExecutionReplayServiceOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  validate(callerKey: string, timestampMs: number, nonce: string): PeerExecutionReplayDecision {
    const normalizedCallerKey = normalizeKey(callerKey);
    const normalizedNonce = normalizeNonce(nonce);
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
    this.trimCallerNonces(callerNonces);
    this.persistOrDeleteCallerNonces(normalizedCallerKey, callerNonces);

    return { ok: true };
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

  private trimCallerNonces(callerNonces: Map<string, number>): void {
    while (callerNonces.size > this.options.config.maxReplayNoncesPerCaller) {
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
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeNonce(value: string): string {
  return value.trim();
}
