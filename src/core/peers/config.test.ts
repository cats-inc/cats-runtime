import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { loadPeerRuntimeConfig } from './config.js';

function createEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-peer-config-'));
  return {
    HOME: root,
    USERPROFILE: root,
    CATS_RUNTIME_DATA_DIR: join(root, 'data'),
    CATS_RUNTIME_SESSION_BASE_DIR: join(root, 'sessions'),
    ...overrides,
  };
}

describe('peer runtime config', () => {
  it('defaults to disabled discovery with no static peers', () => {
    const config = loadConfig(createEnv());
    expect(loadPeerRuntimeConfig(config)).toEqual({
      enabled: false,
      peerId: undefined,
      displayName: expect.any(String),
      advertisedUrl: undefined,
      advertisedHost: undefined,
      advertisedPort: undefined,
      stalePeerTtlMs: 30_000,
      pruneIntervalMs: 10_000,
      advertiseIntervalMs: 15_000,
      maxAdvertisedTargets: 16,
      requestTimeoutMs: 120_000,
      authFailureWindowMs: 60_000,
      maxAuthFailuresPerWindow: 5,
      maxInboundExecutions: 8,
      maxInboundExecutionsPerPeer: 2,
      replayWindowMs: 120_000,
      replayNonceTtlMs: 120_000,
      maxReplayNoncesPerCaller: 64,
      allowHeuristicRouting: false,
      sharedSecret: undefined,
      sharedSecrets: [],
      trustedPeerIds: [],
      rejectedPeerIds: [],
      staticPeers: [],
    });
  });

  it('parses bounded static peers and ignores unknown fields', () => {
    const config = loadConfig(createEnv({
      CATS_RUNTIME_PEERS_ENABLED: 'true',
      CATS_RUNTIME_PEER_NAME: 'local-dev',
      CATS_RUNTIME_PEER_STATIC_PEERS: JSON.stringify([{
        displayName: 'lab-peer',
        baseUrl: 'http://10.0.0.9:3110',
        secret: 'discard-me',
        targets: [
          {
            provider: 'codex',
            backend: 'cli',
            instance: 'default',
            default: true,
          },
        ],
        trust: {
          state: 'trusted',
          reason: 'pinned',
        },
      }]),
    }));

    const peerConfig = loadPeerRuntimeConfig(config);
    expect(peerConfig.enabled).toBe(true);
    expect(peerConfig.staticPeers).toEqual([{
      peerId: expect.any(String),
      displayName: 'lab-peer',
      advertisedUrl: 'http://10.0.0.9:3110',
      advertisedHost: undefined,
      advertisedPort: undefined,
      providers: ['codex'],
      targets: [{
        provider: 'codex',
        backend: 'cli',
        instance: 'default',
        default: true,
      }],
      trust: {
        state: 'trusted',
        reason: 'pinned',
      },
    }]);
    expect(peerConfig.staticPeers[0]).not.toHaveProperty('secret');
  });

  it('parses routing and trust execution config additively', () => {
    const config = loadConfig(createEnv({
      CATS_RUNTIME_PEERS_ENABLED: 'true',
      CATS_RUNTIME_PEER_REQUEST_TIMEOUT_MS: '45000',
      CATS_RUNTIME_PEER_AUTH_FAILURE_WINDOW_MS: '120000',
      CATS_RUNTIME_PEER_AUTH_FAILURE_LIMIT: '7',
      CATS_RUNTIME_PEER_MAX_INBOUND_EXECUTIONS: '12',
      CATS_RUNTIME_PEER_MAX_INBOUND_EXECUTIONS_PER_PEER: '3',
      CATS_RUNTIME_PEER_REPLAY_WINDOW_MS: '90000',
      CATS_RUNTIME_PEER_REPLAY_NONCE_TTL_MS: '180000',
      CATS_RUNTIME_PEER_MAX_REPLAY_NONCES_PER_CALLER: '96',
      CATS_RUNTIME_PEER_ALLOW_HEURISTIC_ROUTING: 'true',
      CATS_RUNTIME_PEER_SHARED_SECRET: 'lan-secret',
      CATS_RUNTIME_PEER_SHARED_SECRETS: '["lan-secret-old","lan-secret-older"]',
      CATS_RUNTIME_PEER_TRUSTED_IDS: 'peer-a, peer-b , peer-a',
      CATS_RUNTIME_PEER_REJECTED_IDS: '["peer-c","peer-d"]',
    }));

    expect(loadPeerRuntimeConfig(config)).toEqual(expect.objectContaining({
      enabled: true,
      requestTimeoutMs: 45_000,
      authFailureWindowMs: 120_000,
      maxAuthFailuresPerWindow: 7,
      maxInboundExecutions: 12,
      maxInboundExecutionsPerPeer: 3,
      replayWindowMs: 90_000,
      replayNonceTtlMs: 180_000,
      maxReplayNoncesPerCaller: 96,
      allowHeuristicRouting: true,
      sharedSecret: 'lan-secret',
      sharedSecrets: ['lan-secret', 'lan-secret-old', 'lan-secret-older'],
      trustedPeerIds: ['peer-a', 'peer-b'],
      rejectedPeerIds: ['peer-c', 'peer-d'],
    }));
  });
});
