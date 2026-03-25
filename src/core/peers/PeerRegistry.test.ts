import { describe, expect, it } from 'vitest';
import { PeerRegistry } from './PeerRegistry.js';
import type { PeerAdvertisement } from './types.js';

function createAdvertisement(
  peerId: string,
  observedAt: string,
  ttlMs: number,
  providers: string[],
): PeerAdvertisement {
  return {
    identity: {
      peerId,
      displayName: peerId,
      runtimeVersion: '0.1.0-test',
      advertisedUrl: `http://${peerId}.local:3110`,
    },
    observedAt,
    ttlMs,
    capabilities: {
      providers,
      targets: providers.map((provider) => ({
        provider,
        backend: 'cli',
        instance: 'default',
        default: true,
      })),
      targetLimit: 16,
      truncated: false,
    },
    load: {
      activeSessions: 1,
      busyWorkers: 0,
      idleWorkers: 1,
      providerWorkers: {},
      capacityState: 'idle',
    },
    trust: {
      state: peerId === 'self' ? 'self' : 'unknown',
      reason: peerId === 'self' ? 'local_runtime' : 'unverified',
    },
  };
}

describe('PeerRegistry', () => {
  it('deduplicates peer advertisements by peerId and keeps the newest snapshot', () => {
    let now = Date.parse('2026-03-25T00:00:20.000Z');
    const registry = new PeerRegistry({
      stalePeerTtlMs: 5_000,
      now: () => now,
    });

    registry.upsert(
      createAdvertisement('peer-a', '2026-03-25T00:00:00.000Z', 5_000, ['claude']),
      { sourceId: 'lan:peer-a', sourceKind: 'lan' },
    );
    registry.upsert(
      createAdvertisement('peer-a', '2026-03-25T00:00:10.000Z', 5_000, ['codex']),
      { sourceId: 'static:peer-a', sourceKind: 'static' },
    );
    registry.upsert(
      createAdvertisement('peer-a', '2026-03-25T00:00:05.000Z', 5_000, ['gemini']),
      { sourceId: 'legacy:peer-a', sourceKind: 'lan' },
    );

    const peer = registry.get('peer-a', { includeStale: true, now });
    expect(peer).toEqual(expect.objectContaining({
      capabilities: expect.objectContaining({
        providers: ['codex'],
      }),
      sources: ['lan:peer-a', 'legacy:peer-a', 'static:peer-a'],
      sourceKinds: ['lan', 'static'],
    }));
  });

  it('marks stale peers as hidden by default and prunes them when requested', () => {
    let now = Date.parse('2026-03-25T00:00:20.000Z');
    const registry = new PeerRegistry({
      stalePeerTtlMs: 1_000,
      now: () => now,
    });

    registry.upsert(
      createAdvertisement('peer-b', '2026-03-25T00:00:00.000Z', 500, ['codex']),
      { sourceId: 'lan:peer-b', sourceKind: 'lan' },
    );

    expect(registry.get('peer-b')).toBeUndefined();
    expect(registry.get('peer-b', { includeStale: true })).toEqual(expect.objectContaining({
      liveness: expect.objectContaining({
        state: 'stale',
      }),
    }));
    expect(registry.summary(now)).toEqual({
      total: 1,
      self: 0,
      remote: 1,
      alive: 0,
      stale: 1,
      trusted: 0,
      unknown: 1,
      rejected: 0,
    });

    expect(registry.pruneStale(now)).toEqual(['peer-b']);
    expect(registry.list({ includeStale: true })).toEqual([]);
  });
});
