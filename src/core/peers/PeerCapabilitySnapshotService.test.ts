import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createRuntimeStartupState } from '../../startup.js';
import { PeerCapabilitySnapshotService } from './PeerCapabilitySnapshotService.js';
import type { PeerRuntimeConfig } from './types.js';
import { createRuntimeTestEnv } from '../../../tests/support/runtimeTestPaths.js';

const createdRoots: string[] = [];

function createConfigEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-peer-capability-'));
  createdRoots.push(root);
  return createRuntimeTestEnv(root, {
    CATS_RUNTIME_HOST: '127.0.0.1',
    CATS_RUNTIME_PORT: '3110',
    AUGGIE_SESSIONS_DIR: join(root, '.augment', 'sessions'),
    CLAUDE_PROJECTS_DIR: join(root, '.claude', 'projects'),
    CODEX_SESSIONS_DIR: join(root, '.codex', 'sessions'),
    COPILOT_SESSIONS_DIR: join(root, '.copilot', 'session-state'),
    CURSOR_CHATS_DIR: join(root, '.cursor', 'chats'),
    KIRO_DB_PATH: join(root, '.kiro', 'data.sqlite3'),
    PI_SESSIONS_DIR: join(root, '.pi', 'agent', 'sessions'),
    ...overrides,
  });
}

function createPeerConfig(overrides: Partial<PeerRuntimeConfig> = {}): PeerRuntimeConfig {
  return {
    enabled: true,
    displayName: 'local-runtime',
    stalePeerTtlMs: 30_000,
    pruneIntervalMs: 10_000,
    advertiseIntervalMs: 15_000,
    maxAdvertisedTargets: 2,
    staticPeers: [],
    ...overrides,
  };
}

describe('PeerCapabilitySnapshotService', () => {
  afterEach(() => {
    while (createdRoots.length > 0) {
      const root = createdRoots.pop();
      if (root) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('prefers explicit advertised endpoint metadata for the local peer advertisement', () => {
    const config = loadConfig(createConfigEnv());
    const startup = createRuntimeStartupState();
    startup.address = {
      host: '10.0.0.20',
      port: 4000,
      healthUrl: 'http://10.0.0.20:4000/health',
    };

    const service = new PeerCapabilitySnapshotService({
      config,
      peerConfig: createPeerConfig({
        peerId: 'LOCAL PEER',
        advertisedUrl: 'https://lan-peer.example',
        advertisedHost: 'lan-peer.example',
        advertisedPort: 443,
      }),
      startup,
      registry: {
        list: () => [{ id: 'session-a' }],
      } as never,
      pool: {
        status: () => ({
          busy: 1,
          idle: 2,
          providers: { codex: 1 },
        }),
      } as never,
      now: () => Date.parse('2026-03-25T00:00:00.000Z'),
    });

    expect(service.buildLocalAdvertisement()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        peerId: 'local-peer',
        displayName: 'local-runtime',
        advertisedUrl: 'https://lan-peer.example',
        advertisedHost: 'lan-peer.example',
        advertisedPort: 443,
      }),
      observedAt: '2026-03-25T00:00:00.000Z',
      ttlMs: 30_000,
      load: {
        activeSessions: 1,
        busyWorkers: 1,
        idleWorkers: 2,
        providerWorkers: { codex: 1 },
        capacityState: 'busy',
      },
      trust: {
        state: 'self',
        reason: 'local_runtime',
      },
      capabilities: expect.objectContaining({
        targetLimit: 2,
        targets: expect.any(Array),
      }),
    }));
  });

  it('builds bounded static advertisements with normalized identity and fallback trust/load', () => {
    const config = loadConfig(createConfigEnv({
      CATS_RUNTIME_HOST: '0.0.0.0',
      CATS_RUNTIME_PORT: '3110',
    }));
    const service = new PeerCapabilitySnapshotService({
      config,
      peerConfig: createPeerConfig({
        maxAdvertisedTargets: 1,
      }),
      startup: createRuntimeStartupState(),
      registry: {
        list: () => [],
      } as never,
      pool: {
        status: () => ({
          busy: 0,
          idle: 0,
          providers: {},
        }),
      } as never,
      now: () => Date.parse('2026-03-25T00:00:05.000Z'),
    });

    const advertisement = service.buildStaticAdvertisement({
      displayName: 'Lab Peer 01',
      targets: [
        {
          provider: 'codex',
          backend: 'cli',
          instance: 'default',
          default: true,
        },
        {
          provider: 'claude',
          backend: 'cli',
          instance: 'default',
          default: false,
        },
      ],
      providers: ['codex', 'claude'],
    });

    expect(advertisement).toEqual({
      identity: {
        peerId: 'lab-peer-01',
        displayName: 'Lab Peer 01',
        runtimeVersion: expect.any(String),
      },
      observedAt: '2026-03-25T00:00:05.000Z',
      ttlMs: 30_000,
      capabilities: {
        providers: ['claude', 'codex'],
        targets: [
          {
            provider: 'codex',
            backend: 'cli',
            instance: 'default',
            default: true,
          },
        ],
        targetLimit: 1,
        truncated: true,
      },
      load: {
        activeSessions: 0,
        busyWorkers: 0,
        idleWorkers: 0,
        providerWorkers: {},
        capacityState: 'unknown',
      },
      trust: {
        state: 'unknown',
        reason: 'unverified',
      },
    });
  });
});
