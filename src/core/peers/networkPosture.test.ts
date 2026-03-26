import { describe, expect, it } from 'vitest';
import { buildPeerNetworkPostureSnapshot, evaluatePeerIdentityPosture } from './networkPosture.js';
import type { PeerRegistryEntry } from './types.js';

function createPeer(
  peerId: string,
  advertisedUrl: string | undefined,
): Pick<PeerRegistryEntry, 'identity' | 'trust'> {
  return {
    identity: {
      peerId,
      displayName: peerId,
      runtimeVersion: '0.1.0-test',
      ...(advertisedUrl ? { advertisedUrl } : {}),
    },
    trust: {
      state: 'trusted',
      reason: 'configured_trust',
    },
  };
}

describe('peer network posture', () => {
  it('classifies tls endpoints as ok', () => {
    expect(evaluatePeerIdentityPosture({
      advertisedUrl: 'https://peer.example:3110',
    })).toEqual({
      endpoint: 'https://peer.example:3110/',
      host: 'peer.example',
      port: 3110,
      scheme: 'https',
      scope: 'public',
      classification: 'tls',
      level: 'ok',
      attention: 'none',
      summary: 'Peer endpoint is advertised over TLS.',
    });
  });

  it('classifies private-lan plaintext endpoints as attention-only', () => {
    expect(evaluatePeerIdentityPosture({
      advertisedHost: '192.168.1.20',
      advertisedPort: 3110,
    })).toEqual({
      endpoint: 'http://192.168.1.20:3110',
      host: '192.168.1.20',
      port: 3110,
      scheme: 'http',
      scope: 'private',
      classification: 'trusted_lan_plaintext',
      level: 'attention',
      attention: 'lan_only_plaintext',
      summary: 'Peer endpoint is plaintext HTTP on a loopback/private/LAN address; keep it behind a tightly trusted network or add TLS.',
    });
  });

  it('classifies public plaintext endpoints as warnings', () => {
    expect(evaluatePeerIdentityPosture({
      advertisedUrl: 'http://peer.example:3110',
    })).toEqual({
      endpoint: 'http://peer.example:3110/',
      host: 'peer.example',
      port: 3110,
      scheme: 'http',
      scope: 'public',
      classification: 'external_plaintext',
      level: 'warning',
      attention: 'tls_required',
      summary: 'Peer endpoint is plaintext HTTP on a non-private address; front it with TLS before using it outside a tightly trusted LAN.',
    });
  });

  it('surfaces missing auth and mixed peer posture in the snapshot summary', () => {
    const snapshot = buildPeerNetworkPostureSnapshot({
      localIdentity: {
        advertisedHost: '127.0.0.1',
        advertisedPort: 3110,
      },
      peers: [
        createPeer('tls-peer', 'https://peer.example'),
        createPeer('lan-peer', 'http://peer.local:3110'),
        createPeer('public-peer', 'http://peer.example:3110'),
        createPeer('missing-peer', undefined),
      ],
      sharedSecretCount: 0,
    });

    expect(snapshot).toEqual({
      summary: 'Peer execution auth is not configured; inbound peer execution will stay unavailable even if endpoints are advertised.',
      auth: {
        sharedSecretConfigured: false,
        sharedSecretCount: 0,
      },
      local: {
        endpoint: 'http://127.0.0.1:3110',
        host: '127.0.0.1',
        port: 3110,
        scheme: 'http',
        scope: 'loopback',
        classification: 'trusted_lan_plaintext',
        level: 'attention',
        attention: 'lan_only_plaintext',
        summary: 'Peer endpoint is plaintext HTTP on a loopback/private/LAN address; keep it behind a tightly trusted network or add TLS.',
      },
      peers: {
        total: 4,
        tls: 1,
        trustedLanPlaintext: 1,
        externalPlaintext: 1,
        unresolved: 1,
        attention: 1,
        warning: 2,
      },
      entries: [
        {
          peerId: 'tls-peer',
          displayName: 'tls-peer',
          trustState: 'trusted',
          trustReason: 'configured_trust',
          posture: {
            endpoint: 'https://peer.example/',
            host: 'peer.example',
            scheme: 'https',
            scope: 'public',
            classification: 'tls',
            level: 'ok',
            attention: 'none',
            summary: 'Peer endpoint is advertised over TLS.',
          },
        },
        {
          peerId: 'lan-peer',
          displayName: 'lan-peer',
          trustState: 'trusted',
          trustReason: 'configured_trust',
          posture: {
            endpoint: 'http://peer.local:3110/',
            host: 'peer.local',
            port: 3110,
            scheme: 'http',
            scope: 'local',
            classification: 'trusted_lan_plaintext',
            level: 'attention',
            attention: 'lan_only_plaintext',
            summary: 'Peer endpoint is plaintext HTTP on a loopback/private/LAN address; keep it behind a tightly trusted network or add TLS.',
          },
        },
        {
          peerId: 'public-peer',
          displayName: 'public-peer',
          trustState: 'trusted',
          trustReason: 'configured_trust',
          posture: {
            endpoint: 'http://peer.example:3110/',
            host: 'peer.example',
            port: 3110,
            scheme: 'http',
            scope: 'public',
            classification: 'external_plaintext',
            level: 'warning',
            attention: 'tls_required',
            summary: 'Peer endpoint is plaintext HTTP on a non-private address; front it with TLS before using it outside a tightly trusted LAN.',
          },
        },
        {
          peerId: 'missing-peer',
          displayName: 'missing-peer',
          trustState: 'trusted',
          trustReason: 'configured_trust',
          posture: {
            scheme: 'unknown',
            scope: 'unknown',
            classification: 'unresolved',
            level: 'warning',
            attention: 'endpoint_missing',
            summary: 'No advertised peer endpoint is configured; remote peers should not route to this runtime until a stable advertised URL or host is set.',
          },
        },
      ],
    });
  });
});
