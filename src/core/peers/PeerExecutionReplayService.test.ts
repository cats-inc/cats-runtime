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
});
