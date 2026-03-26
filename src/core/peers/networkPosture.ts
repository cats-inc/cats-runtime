import { isIP } from 'node:net';
import type {
  PeerIdentity,
  PeerNetworkEndpointPosture,
  PeerNetworkPostureCounts,
  PeerNetworkPostureEntry,
  PeerNetworkPostureSnapshot,
  PeerNetworkPostureSummary,
  PeerRegistryEntry,
} from './types.js';

interface BuildPeerNetworkPostureOptions {
  localIdentity?: Pick<
    PeerIdentity,
    'advertisedUrl' | 'advertisedHost' | 'advertisedPort'
  > | null;
  peers: Array<Pick<PeerRegistryEntry, 'identity' | 'trust'>>;
  sharedSecretCount: number;
}

export function buildPeerNetworkPostureSnapshot(
  options: BuildPeerNetworkPostureOptions,
): PeerNetworkPostureSnapshot {
  const local = options.localIdentity
    ? evaluatePeerIdentityPosture(options.localIdentity)
    : null;
  const entries = options.peers.map((peer) => ({
    peerId: peer.identity.peerId,
    displayName: peer.identity.displayName,
    trustState: peer.trust.state,
    trustReason: peer.trust.reason,
    posture: evaluatePeerIdentityPosture(peer.identity),
  }));
  const counts = createCounts(entries);
  const auth = {
    sharedSecretConfigured: options.sharedSecretCount > 0,
    sharedSecretCount: options.sharedSecretCount,
  };

  return {
    summary: summarizeNetworkPosture(local, counts, auth.sharedSecretConfigured),
    auth,
    local,
    peers: counts,
    entries,
  };
}

export function summarizePeerNetworkPosture(
  snapshot: PeerNetworkPostureSnapshot,
): PeerNetworkPostureSummary {
  return {
    summary: snapshot.summary,
    auth: snapshot.auth,
    local: snapshot.local,
    peers: snapshot.peers,
  };
}

export function describePeerNetworkPosture(
  snapshot: PeerNetworkPostureSnapshot,
  peerId: string,
): PeerNetworkPostureEntry | undefined {
  return snapshot.entries.find((entry) => entry.peerId === peerId);
}

export function evaluatePeerIdentityPosture(
  identity: Pick<PeerIdentity, 'advertisedUrl' | 'advertisedHost' | 'advertisedPort'>,
): PeerNetworkEndpointPosture {
  if (identity.advertisedUrl) {
    try {
      const url = new URL(identity.advertisedUrl);
      const scheme = url.protocol === 'https:' ? 'https' : url.protocol === 'http:' ? 'http' : 'unknown';
      const port = url.port ? Number.parseInt(url.port, 10) : undefined;
      return buildEndpointPosture({
        endpoint: url.toString(),
        host: url.hostname || undefined,
        port,
        scheme,
      });
    } catch {
      return {
        endpoint: identity.advertisedUrl,
        scheme: 'unknown',
        scope: 'unknown',
        classification: 'unresolved',
        level: 'warning',
        attention: 'endpoint_invalid',
        summary: `Advertised peer URL '${identity.advertisedUrl}' is invalid and should be replaced with a stable http(s) endpoint.`,
      };
    }
  }

  if (identity.advertisedHost && identity.advertisedPort) {
    return buildEndpointPosture({
      endpoint: `http://${identity.advertisedHost}:${identity.advertisedPort}`,
      host: identity.advertisedHost,
      port: identity.advertisedPort,
      scheme: 'http',
    });
  }

  return {
    scheme: 'unknown',
    scope: 'unknown',
    classification: 'unresolved',
    level: 'warning',
    attention: 'endpoint_missing',
    summary: 'No advertised peer endpoint is configured; remote peers should not route to this runtime until a stable advertised URL or host is set.',
  };
}

function buildEndpointPosture(
  input: {
    endpoint: string;
    host?: string;
    port?: number;
    scheme: 'https' | 'http' | 'unknown';
  },
): PeerNetworkEndpointPosture {
  const scope = classifyHostScope(input.host);
  if (input.scheme === 'https') {
    return {
      endpoint: input.endpoint,
      ...(input.host ? { host: input.host } : {}),
      ...(input.port ? { port: input.port } : {}),
      scheme: input.scheme,
      scope,
      classification: 'tls',
      level: 'ok',
      attention: 'none',
      summary: 'Peer endpoint is advertised over TLS.',
    };
  }

  if (input.scheme === 'http') {
    if (scope === 'loopback' || scope === 'private' || scope === 'local') {
      return {
        endpoint: input.endpoint,
        ...(input.host ? { host: input.host } : {}),
        ...(input.port ? { port: input.port } : {}),
        scheme: input.scheme,
        scope,
        classification: 'trusted_lan_plaintext',
        level: 'attention',
        attention: 'lan_only_plaintext',
        summary: 'Peer endpoint is plaintext HTTP on a loopback/private/LAN address; keep it behind a tightly trusted network or add TLS.',
      };
    }

    return {
      endpoint: input.endpoint,
      ...(input.host ? { host: input.host } : {}),
      ...(input.port ? { port: input.port } : {}),
      scheme: input.scheme,
      scope,
      classification: 'external_plaintext',
      level: 'warning',
      attention: 'tls_required',
      summary: 'Peer endpoint is plaintext HTTP on a non-private address; front it with TLS before using it outside a tightly trusted LAN.',
    };
  }

  return {
    endpoint: input.endpoint,
    ...(input.host ? { host: input.host } : {}),
    ...(input.port ? { port: input.port } : {}),
    scheme: input.scheme,
    scope,
    classification: 'unresolved',
    level: 'warning',
    attention: 'endpoint_invalid',
    summary: 'Peer endpoint uses an unsupported URL scheme; configure a stable http(s) advertised endpoint.',
  };
}

function classifyHostScope(host: string | undefined) {
  if (!host) {
    return 'unknown' as const;
  }

  const normalized = host.trim().toLowerCase();
  if (normalized.length === 0 || normalized === '0.0.0.0' || normalized === '::') {
    return 'unknown' as const;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return classifyIpv4Scope(normalized);
  }
  if (ipVersion === 6) {
    return classifyIpv6Scope(normalized);
  }

  if (
    normalized === 'localhost'
    || normalized.endsWith('.local')
    || normalized.endsWith('.lan')
    || normalized.endsWith('.home.arpa')
    || !normalized.includes('.')
  ) {
    return 'local' as const;
  }

  return 'public' as const;
}

function classifyIpv4Scope(address: string) {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return 'unknown' as const;
  }

  const [first, second] = octets;
  if (first === 127) {
    return 'loopback' as const;
  }
  if (first === 10) {
    return 'private' as const;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return 'private' as const;
  }
  if (first === 192 && second === 168) {
    return 'private' as const;
  }
  if (first === 169 && second === 254) {
    return 'private' as const;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return 'private' as const;
  }

  return 'public' as const;
}

function classifyIpv6Scope(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === '::1') {
    return 'loopback' as const;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return 'private' as const;
  }
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return 'private' as const;
  }

  return 'public' as const;
}

function createCounts(entries: PeerNetworkPostureEntry[]): PeerNetworkPostureCounts {
  return entries.reduce<PeerNetworkPostureCounts>((counts, entry) => {
    counts.total += 1;
    if (entry.posture.classification === 'tls') {
      counts.tls += 1;
    } else if (entry.posture.classification === 'trusted_lan_plaintext') {
      counts.trustedLanPlaintext += 1;
    } else if (entry.posture.classification === 'external_plaintext') {
      counts.externalPlaintext += 1;
    } else {
      counts.unresolved += 1;
    }

    if (entry.posture.level === 'attention') {
      counts.attention += 1;
    } else if (entry.posture.level === 'warning') {
      counts.warning += 1;
    }

    return counts;
  }, {
    total: 0,
    tls: 0,
    trustedLanPlaintext: 0,
    externalPlaintext: 0,
    unresolved: 0,
    attention: 0,
    warning: 0,
  });
}

function summarizeNetworkPosture(
  local: PeerNetworkEndpointPosture | null,
  counts: PeerNetworkPostureCounts,
  sharedSecretConfigured: boolean,
): string {
  if (!sharedSecretConfigured) {
    return 'Peer execution auth is not configured; inbound peer execution will stay unavailable even if endpoints are advertised.';
  }

  if (!local || local.classification === 'unresolved') {
    return 'Local peer execution does not advertise a stable endpoint yet; configure an advertised URL or host before relying on peer routing.';
  }

  if (local.classification === 'external_plaintext' || counts.externalPlaintext > 0) {
    return 'One or more peer endpoints are exposed over plaintext HTTP on non-private addresses; front peer traffic with TLS before using it outside a tightly trusted LAN.';
  }

  if (local.classification === 'trusted_lan_plaintext' || counts.trustedLanPlaintext > 0) {
    return 'Peer endpoints are plaintext HTTP on loopback/private/LAN addresses; keep peer routing inside a tightly trusted network or add TLS.';
  }

  return 'Peer endpoints are advertised over TLS or otherwise have no current network posture warnings.';
}
