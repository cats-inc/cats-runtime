import { describe, expect, it } from 'vitest';
import { createPeerPayloadSignature } from './auth.js';
import { PeerTrustService } from './PeerTrustService.js';
import type { PeerAdvertisement } from './types.js';

function createAdvertisement(
  peerId: string,
  trust: PeerAdvertisement['trust'],
): PeerAdvertisement {
  return {
    identity: {
      peerId,
      displayName: peerId,
      runtimeVersion: '0.1.0-test',
      advertisedUrl: `http://${peerId}.local:3110`,
    },
    observedAt: '2026-03-25T00:00:00.000Z',
    ttlMs: 30_000,
    capabilities: {
      providers: ['codex'],
      targets: [{
        provider: 'codex',
        backend: 'api',
        instance: 'main',
        default: true,
      }],
      targetLimit: 16,
      truncated: false,
    },
    load: {
      activeSessions: 0,
      busyWorkers: 0,
      idleWorkers: 1,
      providerWorkers: {},
      capacityState: 'idle',
    },
    trust,
  };
}

describe('PeerTrustService', () => {
  it('normalizes remote self advertisements into configured trust states', () => {
    const trust = new PeerTrustService({
      config: {
        sharedSecret: 'lan-secret',
        trustedPeerIds: ['trusted-peer'],
        rejectedPeerIds: ['blocked-peer'],
      },
      localPeerId: 'local-peer',
    });

    expect(trust.summarizeAdvertisement(
      createAdvertisement('local-peer', { state: 'self', reason: 'local_runtime' }),
      'self',
    )).toEqual({
      state: 'self',
      reason: 'local_runtime',
    });

    expect(trust.summarizeAdvertisement(
      createAdvertisement('trusted-peer', { state: 'self', reason: 'local_runtime' }),
      'lan',
    )).toEqual({
      state: 'trusted',
      reason: 'configured_trust',
    });

    expect(trust.summarizeAdvertisement(
      createAdvertisement('blocked-peer', { state: 'self', reason: 'local_runtime' }),
      'lan',
    )).toEqual({
      state: 'rejected',
      reason: 'configured_reject',
    });

    expect(trust.summarizeAdvertisement(
      createAdvertisement('unknown-peer', { state: 'trusted', reason: 'self_reported' }),
      'lan',
    )).toEqual({
      state: 'unknown',
      reason: 'self_reported',
    });
  });

  it('accepts static trusted seeds and validates the shared secret', () => {
    const trust = new PeerTrustService({
      config: {
        sharedSecret: 'lan-secret',
        trustedPeerIds: [],
        rejectedPeerIds: [],
      },
      localPeerId: 'local-peer',
    });

    expect(trust.summarizeAdvertisement(
      createAdvertisement('seed-peer', { state: 'trusted', reason: 'configured_static_peer' }),
      'static',
    )).toEqual({
      state: 'trusted',
      reason: 'configured_static_peer',
    });
    expect(trust.validateSharedSecret('lan-secret')).toBe(true);
    expect(trust.validateSharedSecret('wrong-secret')).toBe(false);
    expect(trust.validatePayloadSignature(
      '{"turn":{"message":"hello"}}',
      createPeerPayloadSignature('lan-secret', '{"turn":{"message":"hello"}}'),
    )).toBe(true);
    expect(trust.validatePayloadSignature(
      '{"turn":{"message":"tampered"}}',
      createPeerPayloadSignature('lan-secret', '{"turn":{"message":"hello"}}'),
    )).toBe(false);
    expect(trust.canAcceptInboundExecution('seed-peer')).toBe(false);
  });
});
