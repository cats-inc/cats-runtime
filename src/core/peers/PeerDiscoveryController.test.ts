import { describe, expect, it, vi } from 'vitest';
import { PeerDiscoveryController, type PeerDiscoveryAdapter } from './PeerDiscoveryController.js';
import { PeerRegistry } from './PeerRegistry.js';
import type { PeerAdvertisement, PeerRuntimeConfig } from './types.js';

function createConfig(overrides: Partial<PeerRuntimeConfig> = {}): PeerRuntimeConfig {
  return {
    enabled: true,
    displayName: 'local',
    stalePeerTtlMs: 5_000,
    pruneIntervalMs: 2_000,
    advertiseIntervalMs: 2_500,
    maxAdvertisedTargets: 16,
    staticPeers: [],
    ...overrides,
  };
}

function createAdvertisement(peerId: string): PeerAdvertisement {
  return {
    identity: {
      peerId,
      displayName: peerId,
      runtimeVersion: '0.1.0-test',
      advertisedUrl: `http://${peerId}.local:3110`,
    },
    observedAt: new Date().toISOString(),
    ttlMs: 5_000,
    capabilities: {
      providers: ['codex'],
      targets: [{
        provider: 'codex',
        backend: 'cli',
        instance: 'default',
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
    trust: {
      state: 'unknown',
      reason: 'unverified',
    },
  };
}

describe('PeerDiscoveryController', () => {
  it('stays disabled by default and does not start adapters', () => {
    const adapter = {
      id: 'lan-test',
      kind: 'lan',
      start: vi.fn(),
      stop: vi.fn(),
      snapshot: vi.fn(() => ({
        id: 'lan-test',
        kind: 'lan',
        state: 'idle',
        publishedPeers: 0,
      })),
    } satisfies PeerDiscoveryAdapter;

    const controller = new PeerDiscoveryController({
      config: createConfig({ enabled: false }),
      registry: new PeerRegistry({ stalePeerTtlMs: 5_000 }),
      capabilitySnapshot: {
        getLocalPeerId: () => 'local-peer',
      } as never,
      adapters: [adapter],
    });

    controller.start();
    expect(adapter.start).not.toHaveBeenCalled();
    expect(controller.snapshot()).toEqual(expect.objectContaining({
      enabled: false,
      status: 'disabled',
      summary: 'Peer discovery is disabled.',
    }));
  });

  it('starts and stops adapters while deduplicating duplicate peer advertisements', () => {
    let runtimeApi:
      | Parameters<PeerDiscoveryAdapter['start']>[0]
      | undefined;
    const adapter: PeerDiscoveryAdapter = {
      id: 'lan-test',
      kind: 'lan',
      start(runtime) {
        runtimeApi = runtime;
        runtime.upsert(createAdvertisement('peer-a'), {
          sourceId: 'lan:peer-a',
          sourceKind: 'lan',
        });
        runtime.upsert(createAdvertisement('peer-a'), {
          sourceId: 'lan:mirror',
          sourceKind: 'lan',
        });
      },
      stop() {
        runtimeApi?.removeSource('lan:peer-a');
        runtimeApi?.removeSource('lan:mirror');
      },
      snapshot() {
        return {
          id: 'lan-test',
          kind: 'lan',
          state: 'running',
          publishedPeers: 1,
        };
      },
    };

    const registry = new PeerRegistry({ stalePeerTtlMs: 5_000 });
    const controller = new PeerDiscoveryController({
      config: createConfig(),
      registry,
      capabilitySnapshot: {
        getLocalPeerId: () => 'local-peer',
      } as never,
      adapters: [adapter],
    });

    controller.start();
    expect(registry.list({ includeStale: true })).toHaveLength(1);
    expect(controller.snapshot()).toEqual(expect.objectContaining({
      enabled: true,
      status: 'running',
      registry: expect.objectContaining({
        total: 1,
        alive: 1,
      }),
    }));

    controller.stop();
    expect(registry.list({ includeStale: true })).toEqual([]);
  });
});
