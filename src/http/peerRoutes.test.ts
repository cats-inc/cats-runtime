import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { PeerRegistry } from '../core/peers/PeerRegistry.js';
import { createDisabledPeerDiscoverySnapshot } from '../core/peers/PeerDiscoveryController.js';
import { PeerExecutionAdmissionService } from '../core/peers/PeerExecutionAdmissionService.js';
import { PeerExecutionReplayService } from '../core/peers/PeerExecutionReplayService.js';
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
    const admission = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 1_000,
        maxAuthFailuresPerWindow: 2,
        maxInboundExecutions: 4,
        maxInboundExecutionsPerPeer: 2,
      },
      now: () => now,
    });
    const replay = new PeerExecutionReplayService({
      config: {
        replayWindowMs: 60_000,
        replayNonceTtlMs: 120_000,
        maxReplayNoncesPerCaller: 16,
      },
      now: () => now,
    });
    admission.recordAuthFailure('peer:lab');
    admission.recordAuthFailure('peer:lab');
    replay.validate('peer:peer-live', now, 'nonce-1');
    replay.validate('peer:peer-live', now, 'nonce-2');
    const inbound = admission.acquireInboundExecution('peer-live');
    if (!inbound.ok) {
      throw new Error('expected peer admission grant');
    }

    const ctx: AppContext = {
      startup: createRuntimeStartupState(),
      peerRegistry: registry,
      peerExecutionAdmission: admission,
      peerExecutionReplay: replay,
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
      guardrails: {
        authFailures: {
          windowMs: 1_000,
          maxFailuresPerWindow: 2,
          trackedCallers: 1,
          limitedCallers: 1,
          hiddenCallers: 0,
          callers: [
            expect.objectContaining({
              callerKey: 'peer:lab',
              failureCount: 2,
              limited: true,
            }),
          ],
        },
        inboundExecutions: {
          activeGlobal: 1,
          maxGlobal: 4,
          maxPerPeer: 2,
          activePeers: 1,
          hiddenPeers: 0,
          peers: [
            {
              peerId: 'peer-live',
              activeExecutions: 1,
            },
          ],
        },
        replay: {
          replayWindowMs: 60_000,
          nonceTtlMs: 120_000,
          maxNoncesPerCaller: 16,
          trackedCallers: 1,
          trackedNonces: 2,
          hiddenCallers: 0,
          callers: [
            expect.objectContaining({
              callerKey: 'peer:peer-live',
              trackedNonces: 2,
            }),
          ],
        },
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

  it('adds guardrail summaries to peer read surfaces when admission control is enabled', async () => {
    const now = Date.parse('2026-03-25T00:00:04.000Z');
    const registry = new PeerRegistry({
      stalePeerTtlMs: 5_000,
      now: () => now,
    });
    registry.upsert(
      createAdvertisement('peer-live', '2026-03-25T00:00:03.000Z', 5_000),
      { sourceId: 'lan:live', sourceKind: 'lan' },
    );
    const admission = new PeerExecutionAdmissionService({
      config: {
        authFailureWindowMs: 1_000,
        maxAuthFailuresPerWindow: 3,
        maxInboundExecutions: 2,
        maxInboundExecutionsPerPeer: 1,
      },
    });
    const replay = new PeerExecutionReplayService({
      config: {
        replayWindowMs: 60_000,
        replayNonceTtlMs: 120_000,
        maxReplayNoncesPerCaller: 16,
      },
      now: () => now,
    });
    admission.recordAuthFailure('peer:caller-a');
    replay.validate('peer:peer-live', now, 'nonce-1');
    const inbound = admission.acquireInboundExecution('peer-live');
    if (!inbound.ok) {
      throw new Error('expected peer admission grant');
    }

    const ctx: AppContext = {
      startup: createRuntimeStartupState(),
      peerRegistry: registry,
      peerExecutionAdmission: admission,
      peerExecutionReplay: replay,
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

    const peersResponse = await app.request('/peers');
    expect(peersResponse.status).toBe(200);
    expect(await peersResponse.json()).toEqual(expect.objectContaining({
      guardrails: {
        authFailures: {
          windowMs: 1_000,
          maxFailuresPerWindow: 3,
          trackedCallers: 1,
          limitedCallers: 0,
        },
        inboundExecutions: {
          activeGlobal: 1,
          maxGlobal: 2,
          maxPerPeer: 1,
          activePeers: 1,
          saturated: false,
        },
        replay: {
          replayWindowMs: 60_000,
          nonceTtlMs: 120_000,
          maxNoncesPerCaller: 16,
          trackedCallers: 1,
          trackedNonces: 1,
        },
      },
    }));

    const peerResponse = await app.request('/peers/peer-live');
    expect(peerResponse.status).toBe(200);
    expect(await peerResponse.json()).toEqual(expect.objectContaining({
      guardrails: {
        inboundExecutions: {
          peerId: 'peer-live',
          activeExecutions: 1,
          maxPerPeer: 1,
          saturated: true,
        },
        replay: {
          callerKey: 'peer:peer-live',
          trackedNonces: 1,
          maxNoncesPerCaller: 16,
        },
      },
    }));
  });
});
