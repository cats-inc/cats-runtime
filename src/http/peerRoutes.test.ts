import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { PeerRegistry } from '../core/peers/PeerRegistry.js';
import { createDisabledPeerDiscoverySnapshot } from '../core/peers/PeerDiscoveryController.js';
import type { PeerAdvertisement } from '../core/peers/types.js';
import type { AppContext } from './app.js';
import { diagnosticsRoutes } from './routes/diagnostics.js';
import { peerRoutes } from './routes/peers.js';
import { createRuntimeStartupState } from '../startup.js';

function createAdvertisement(
  peerId: string,
  observedAt: string,
  ttlMs: number,
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

describe('peer routes', () => {
  it('GET /peers returns live peers and can include stale peers on demand', async () => {
    let now = Date.parse('2026-03-25T00:00:05.000Z');
    const registry = new PeerRegistry({
      stalePeerTtlMs: 5_000,
      now: () => now,
    });
    registry.upsert(
      createAdvertisement('peer-live', '2026-03-25T00:00:03.000Z', 5_000),
      { sourceId: 'lan:live', sourceKind: 'lan' },
    );
    registry.upsert(
      createAdvertisement('peer-stale', '2026-03-25T00:00:00.000Z', 1_000),
      { sourceId: 'lan:stale', sourceKind: 'lan' },
    );

    const ctx: AppContext = {
      startup: createRuntimeStartupState(),
      peerRegistry: registry,
      peerCapabilities: {
        getLocalPeerId: () => 'local-peer',
      } as never,
      peerDiscovery: {
        snapshot: () => createDisabledPeerDiscoverySnapshot('local-peer', registry.summary(now)),
      } as never,
    } as AppContext;
    const app = new Hono<{ Variables: { ctx: AppContext } }>();
    app.use('*', async (c, next) => {
      c.set('ctx', ctx);
      await next();
    });
    app.route('/', peerRoutes);

    const liveOnly = await app.request('/peers');
    expect(liveOnly.status).toBe(200);
    expect(await liveOnly.json()).toEqual({
      count: 1,
      query: {
        includeStale: false,
      },
      discovery: expect.objectContaining({
        status: 'disabled',
        registry: expect.objectContaining({
          total: 2,
          alive: 1,
          stale: 1,
        }),
      }),
      peers: [
        expect.objectContaining({
          identity: expect.objectContaining({
            peerId: 'peer-live',
          }),
        }),
      ],
    });

    const withStale = await app.request('/peers?includeStale=true');
    expect(withStale.status).toBe(200);
    expect((await withStale.json()).count).toBe(2);
  });

  it('GET /peers/:peerId returns 404 for unknown peers', async () => {
    const ctx = {
      startup: createRuntimeStartupState(),
      peerRegistry: new PeerRegistry({ stalePeerTtlMs: 5_000 }),
      peerCapabilities: {
        getLocalPeerId: () => 'local-peer',
      },
    } as AppContext;
    const app = new Hono<{ Variables: { ctx: AppContext } }>();
    app.use('*', async (c, next) => {
      c.set('ctx', ctx);
      await next();
    });
    app.route('/', peerRoutes);

    const response = await app.request('/peers/missing');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Unknown peer 'missing'.",
    });
  });

  it('GET /diagnostics/peers returns peer discovery summary and peer list', async () => {
    let now = Date.parse('2026-03-25T00:00:05.000Z');
    const registry = new PeerRegistry({
      stalePeerTtlMs: 5_000,
      now: () => now,
    });
    registry.upsert(
      createAdvertisement('peer-live', '2026-03-25T00:00:03.000Z', 5_000),
      { sourceId: 'lan:live', sourceKind: 'lan' },
    );

    const ctx: AppContext = {
      startup: createRuntimeStartupState(),
      peerRegistry: registry,
      peerCapabilities: {
        getLocalPeerId: () => 'local-peer',
      } as never,
      peerDiscovery: {
        snapshot: () => ({
          ...createDisabledPeerDiscoverySnapshot('local-peer', registry.summary(now)),
          enabled: true,
          status: 'running',
          summary: 'Peer discovery is running with 1 live peer(s).',
        }),
      } as never,
    } as AppContext;
    const app = new Hono<{ Variables: { ctx: AppContext } }>();
    app.use('*', async (c, next) => {
      c.set('ctx', ctx);
      await next();
    });
    app.route('/', diagnosticsRoutes);

    const response = await app.request('/diagnostics/peers');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: 'cats-runtime',
      version: expect.any(String),
      timestamp: expect.any(String),
      readiness: expect.objectContaining({
        ready: false,
      }),
      query: {
        includeStale: false,
      },
      discovery: expect.objectContaining({
        enabled: true,
        status: 'running',
        registry: expect.objectContaining({
          total: 1,
          alive: 1,
        }),
      }),
      summary: {
        total: 1,
        self: 0,
        remote: 1,
        alive: 1,
        stale: 0,
        trusted: 0,
        unknown: 1,
        rejected: 0,
      },
      peers: [
        expect.objectContaining({
          identity: expect.objectContaining({
            peerId: 'peer-live',
          }),
        }),
      ],
    });
  });
});
