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

  it('builds bounded summary and diagnostics snapshots', () => {
    let now = Date.parse('2026-03-26T00:00:00.000Z');
    const service = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 1_000,
        maxAuthFailuresPerWindow: 2,
        maxInboundExecutions: 3,
        maxInboundExecutionsPerPeer: 2,
      },
      now: () => now,
    });

    service.recordAuthFailure('peer:zeta');
    service.recordAuthFailure('peer:zeta');
    service.recordAuthFailure('peer:alpha');
    const first = service.acquireInboundExecution('peer-zeta');
    const second = service.acquireInboundExecution('peer-alpha');

    expect(service.getSummary()).toEqual({
      authFailures: {
        windowMs: 1_000,
        maxFailuresPerWindow: 2,
        trackedCallers: 2,
        limitedCallers: 1,
      },
      inboundExecutions: {
        activeGlobal: 2,
        maxGlobal: 3,
        maxPerPeer: 2,
        activePeers: 2,
        saturated: false,
      },
    });

    expect(service.getInboundExecutionStatus('peer-zeta')).toEqual({
      peerId: 'peer-zeta',
      activeExecutions: 1,
      maxPerPeer: 2,
      saturated: false,
    });

    expect(service.snapshot({ maxCallers: 1, maxPeers: 1 })).toEqual({
      authFailures: {
        windowMs: 1_000,
        maxFailuresPerWindow: 2,
        trackedCallers: 2,
        limitedCallers: 1,
        hiddenCallers: 1,
        callers: [{
          callerKey: 'peer:zeta',
          failureCount: 2,
          limited: true,
          retryAfterMs: 1_000,
          oldestFailureAt: '2026-03-26T00:00:00.000Z',
          newestFailureAt: '2026-03-26T00:00:00.000Z',
        }],
      },
      inboundExecutions: {
        activeGlobal: 2,
        maxGlobal: 3,
        maxPerPeer: 2,
        activePeers: 2,
        hiddenPeers: 1,
        peers: [{
          peerId: 'peer-alpha',
          activeExecutions: 1,
        }],
      },
    });

    first.ok && first.release();
    second.ok && second.release();
    now += 1_100;

    expect(service.snapshot()).toEqual({
      authFailures: {
        windowMs: 1_000,
        maxFailuresPerWindow: 2,
        trackedCallers: 0,
        limitedCallers: 0,
        hiddenCallers: 0,
        callers: [],
      },
      inboundExecutions: {
        activeGlobal: 0,
        maxGlobal: 3,
        maxPerPeer: 2,
        activePeers: 0,
        hiddenPeers: 0,
        peers: [],
      },
    });
  });
});
