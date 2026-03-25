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
});
