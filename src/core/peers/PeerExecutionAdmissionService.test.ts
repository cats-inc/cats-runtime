import { describe, expect, it } from 'vitest';
import { PeerExecutionAdmissionService } from './PeerExecutionAdmissionService.js';

describe('PeerExecutionAdmissionService', () => {
  it('rate-limits repeated auth failures inside the configured window', () => {
    let now = 10_000;
    const service = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 1_000,
        maxAuthFailuresPerWindow: 3,
        maxInboundExecutions: 4,
        maxInboundExecutionsPerPeer: 2,
      },
      now: () => now,
    });

    expect(service.recordAuthFailure('peer:caller-a')).toEqual({
      limited: false,
      retryAfterMs: 0,
      failureCount: 1,
    });
    now += 100;
    expect(service.recordAuthFailure('peer:caller-a')).toEqual({
      limited: false,
      retryAfterMs: 0,
      failureCount: 2,
    });
    now += 100;
    const limited = service.recordAuthFailure('peer:caller-a');
    expect(limited.limited).toBe(true);
    expect(limited.failureCount).toBe(3);
    expect(limited.retryAfterMs).toBeGreaterThan(0);

    now += 1_100;
    expect(service.getAuthFailureStatus('peer:caller-a')).toEqual({
      limited: false,
      retryAfterMs: 0,
      failureCount: 0,
    });
  });

  it('clears prior auth failures after a successful authenticated turn', () => {
    const service = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 1_000,
        maxAuthFailuresPerWindow: 2,
        maxInboundExecutions: 4,
        maxInboundExecutionsPerPeer: 2,
      },
    });

    service.recordAuthFailure('peer:caller-a');
    service.clearAuthFailures('peer:caller-a');

    expect(service.getAuthFailureStatus('peer:caller-a')).toEqual({
      limited: false,
      retryAfterMs: 0,
      failureCount: 0,
    });
  });

  it('enforces per-peer and global inbound execution limits', () => {
    const service = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 1_000,
        maxAuthFailuresPerWindow: 3,
        maxInboundExecutions: 2,
        maxInboundExecutionsPerPeer: 1,
      },
    });

    const first = service.acquireInboundExecution('caller-a');
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('Expected first admission to succeed.');
    }

    const peerLimited = service.acquireInboundExecution('caller-a');
    expect(peerLimited).toMatchObject({
      ok: false,
      reason: 'peer_limit',
      activeGlobal: 1,
      activeForPeer: 1,
      maxGlobal: 2,
      maxPerPeer: 1,
    });

    const second = service.acquireInboundExecution('caller-b');
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error('Expected second admission to succeed.');
    }

    const globalLimited = service.acquireInboundExecution('caller-c');
    expect(globalLimited).toMatchObject({
      ok: false,
      reason: 'global_limit',
      activeGlobal: 2,
      activeForPeer: 0,
      maxGlobal: 2,
      maxPerPeer: 1,
    });

    first.release();
    second.release();

    expect(service.acquireInboundExecution('caller-a').ok).toBe(true);
  });
});
