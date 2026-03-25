import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '../types.js';
import { isPeerExecutionError } from './errors.js';
import { PeerRegistry } from './PeerRegistry.js';
import { PeerRoutingService, parsePeerMessageRoutingInput } from './PeerRoutingService.js';
import { PeerTrustService } from './PeerTrustService.js';
import type { PeerAdvertisement } from './types.js';

function createSession(
  overrides: Partial<SessionInfo> = {},
): SessionInfo {
  return {
    id: 'session-1',
    providerName: 'codex',
    providerBackend: 'api',
    providerInstanceId: 'main',
    status: 'ready',
    origin: 'runtime',
    cwd: '/workspace',
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: '2026-03-25T00:00:00.000Z',
    updatedAt: '2026-03-25T00:00:00.000Z',
    ...overrides,
  };
}

function createAdvertisement(
  peerId: string,
  trust: PeerAdvertisement['trust'],
  busyWorkers = 0,
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
      activeSessions: busyWorkers,
      busyWorkers,
      idleWorkers: 1,
      providerWorkers: { codex: 1 },
      capacityState: busyWorkers > 0 ? 'busy' : 'idle',
    },
    trust,
  };
}

describe('PeerRoutingService', () => {
  it('routes to an explicitly selected trusted peer', () => {
    const registry = new PeerRegistry({
      stalePeerTtlMs: 30_000,
      now: () => Date.parse('2026-03-25T00:00:01.000Z'),
    });
    registry.upsert(
      createAdvertisement('peer-a', { state: 'trusted', reason: 'configured_static_peer' }),
      { sourceId: 'static:peer-a', sourceKind: 'static' },
    );
    const trust = new PeerTrustService({
      config: {
        sharedSecret: 'lan-secret',
        trustedPeerIds: ['peer-a'],
        rejectedPeerIds: [],
      },
      localPeerId: 'local-peer',
    });
    const routing = new PeerRoutingService({
      config: {
        enabled: true,
        allowHeuristicRouting: false,
      },
      registry,
      trust,
      localPeerId: 'local-peer',
    });

    const decision = routing.decide(
      createSession(),
      parsePeerMessageRoutingInput({ mode: 'peer', peerId: 'peer-a' }),
    );

    expect(decision).toEqual(expect.objectContaining({
      mode: 'peer',
      strategy: 'explicit',
      peer: expect.objectContaining({
        identity: expect.objectContaining({
          peerId: 'peer-a',
        }),
      }),
    }));
  });

  it('falls back to local execution when heuristic routing finds no trusted peer', () => {
    const registry = new PeerRegistry({
      stalePeerTtlMs: 30_000,
      now: () => Date.parse('2026-03-25T00:00:01.000Z'),
    });
    registry.upsert(
      createAdvertisement('peer-a', { state: 'unknown', reason: 'unverified' }),
      { sourceId: 'static:peer-a', sourceKind: 'static' },
    );
    registry.upsert(
      createAdvertisement('peer-b', { state: 'trusted', reason: 'configured_static_peer' }, 2),
      { sourceId: 'static:peer-b', sourceKind: 'static' },
    );
    const trust = new PeerTrustService({
      config: {
        sharedSecret: 'lan-secret',
        trustedPeerIds: ['peer-b'],
        rejectedPeerIds: [],
      },
      localPeerId: 'peer-b',
    });
    const routing = new PeerRoutingService({
      config: {
        enabled: true,
        allowHeuristicRouting: true,
      },
      registry,
      trust,
      localPeerId: 'peer-b',
    });

    const decision = routing.decide(
      createSession({ providerName: 'claude' }),
      parsePeerMessageRoutingInput({ mode: 'peer', strategy: 'least_busy' }),
    );

    expect(decision).toEqual(expect.objectContaining({
      mode: 'local',
      localFallback: true,
      strategy: 'least_busy',
    }));
  });

  it('rejects explicitly selected peers that are no longer live', () => {
    const registry = new PeerRegistry({
      stalePeerTtlMs: 30_000,
      now: () => Date.parse('2026-03-25T00:00:35.000Z'),
    });
    registry.upsert(
      createAdvertisement('peer-a', { state: 'trusted', reason: 'configured_static_peer' }),
      { sourceId: 'static:peer-a', sourceKind: 'static' },
    );
    const trust = new PeerTrustService({
      config: {
        sharedSecret: 'lan-secret',
        trustedPeerIds: ['peer-a'],
        rejectedPeerIds: [],
      },
      localPeerId: 'local-peer',
    });
    const routing = new PeerRoutingService({
      config: {
        enabled: true,
        allowHeuristicRouting: false,
      },
      registry,
      trust,
      localPeerId: 'local-peer',
    });

    try {
      routing.decide(
        createSession(),
        parsePeerMessageRoutingInput({ mode: 'peer', peerId: 'peer-a' }),
      );
      throw new Error('Expected routing.decide() to fail for a stale peer.');
    } catch (error) {
      expect(isPeerExecutionError(error)).toBe(true);
      if (!isPeerExecutionError(error)) {
        return;
      }
      expect(error.failure).toEqual(expect.objectContaining({
        code: 'peer_unhealthy',
        peerId: 'peer-a',
        status: 503,
      }));
    }
  });
});
