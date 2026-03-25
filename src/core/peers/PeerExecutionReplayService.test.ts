import { describe, expect, it } from 'vitest';
import { PeerExecutionReplayService } from './PeerExecutionReplayService.js';

describe('PeerExecutionReplayService', () => {
  it('rejects timestamps outside the configured replay window', () => {
    const now = Date.parse('2026-03-26T00:00:10.000Z');
    const service = new PeerExecutionReplayService({
      config: {
        replayWindowMs: 5_000,
        replayNonceTtlMs: 10_000,
        maxReplayNoncesPerCaller: 4,
      },
      now: () => now,
    });

    expect(service.validate('peer:a', now - 6_000, 'nonce-1')).toEqual({
      ok: false,
      reason: 'stale',
      message: 'Peer execution auth timestamp is outside the allowed replay window.',
      details: {
        callerKey: 'peer:a',
        replayWindowMs: 5_000,
        now,
        timestampMs: now - 6_000,
      },
    });
  });

  it('rejects nonce replays inside the configured TTL window', () => {
    let now = Date.parse('2026-03-26T00:00:10.000Z');
    const service = new PeerExecutionReplayService({
      config: {
        replayWindowMs: 30_000,
        replayNonceTtlMs: 10_000,
        maxReplayNoncesPerCaller: 4,
      },
      now: () => now,
    });

    expect(service.validate('peer:a', now, 'nonce-1')).toEqual({ ok: true });
    expect(service.validate('peer:a', now, 'nonce-1')).toEqual({
      ok: false,
      reason: 'replayed',
      message: 'Peer execution auth nonce has already been used inside the replay window.',
      details: {
        callerKey: 'peer:a',
        nonce: 'nonce-1',
        replayWindowMs: 30_000,
      },
    });

    now += 10_100;
    expect(service.validate('peer:a', now, 'nonce-1')).toEqual({ ok: true });
  });

  it('bounds tracked nonces per caller', () => {
    const now = Date.parse('2026-03-26T00:00:10.000Z');
    const service = new PeerExecutionReplayService({
      config: {
        replayWindowMs: 30_000,
        replayNonceTtlMs: 30_000,
        maxReplayNoncesPerCaller: 2,
      },
      now: () => now,
    });

    expect(service.validate('peer:a', now, 'nonce-1')).toEqual({ ok: true });
    expect(service.validate('peer:a', now, 'nonce-2')).toEqual({ ok: true });
    expect(service.validate('peer:a', now, 'nonce-3')).toEqual({ ok: true });

    expect(service.validate('peer:a', now, 'nonce-1')).toEqual({ ok: true });
    expect(service.validate('peer:a', now, 'nonce-3')).toEqual({
      ok: false,
      reason: 'replayed',
      message: 'Peer execution auth nonce has already been used inside the replay window.',
      details: {
        callerKey: 'peer:a',
        nonce: 'nonce-3',
        replayWindowMs: 30_000,
      },
    });
  });

  it('builds bounded replay summaries and caller snapshots', () => {
    const now = Date.parse('2026-03-26T00:00:10.000Z');
    const service = new PeerExecutionReplayService({
      config: {
        replayWindowMs: 30_000,
        replayNonceTtlMs: 10_000,
        maxReplayNoncesPerCaller: 4,
      },
      now: () => now,
    });

    expect(service.validate('peer:b', now, 'nonce-b1')).toEqual({ ok: true });
    expect(service.validate('peer:b', now, 'nonce-b2')).toEqual({ ok: true });
    expect(service.validate('peer:a', now, 'nonce-a1')).toEqual({ ok: true });

    expect(service.getSummary()).toEqual({
      replayWindowMs: 30_000,
      nonceTtlMs: 10_000,
      maxNoncesPerCaller: 4,
      trackedCallers: 2,
      trackedNonces: 3,
    });

    expect(service.getCallerSummary('peer:b')).toEqual({
      callerKey: 'peer:b',
      trackedNonces: 2,
      maxNoncesPerCaller: 4,
    });

    expect(service.snapshot({ maxCallers: 1 })).toEqual({
      replayWindowMs: 30_000,
      nonceTtlMs: 10_000,
      maxNoncesPerCaller: 4,
      trackedCallers: 2,
      trackedNonces: 3,
      hiddenCallers: 1,
      callers: [{
        callerKey: 'peer:b',
        trackedNonces: 2,
        newestNonceExpiresAt: '2026-03-26T00:00:20.000Z',
      }],
    });
  });
});
