import type { SessionInfo } from '../types.js';
import { createPeerExecutionError } from './errors.js';
import type {
  ParsedPeerMessageRoutingInput,
  PeerExecutionFailure,
  PeerMessageRoutingInput,
  PeerRegistryEntry,
  PeerRuntimeConfig,
  PeerRoutingDecision,
  PeerRoutingStrategy,
} from './types.js';
import { PeerRegistry } from './PeerRegistry.js';
import { PeerTrustService } from './PeerTrustService.js';

export class PeerRoutingService {
  constructor(
    private readonly options: {
      config: Pick<PeerRuntimeConfig, 'enabled' | 'allowHeuristicRouting'>;
      registry: PeerRegistry;
      trust: PeerTrustService;
      localPeerId?: string | null;
    },
  ) {}

  decide(
    session: Pick<
      SessionInfo,
      'origin' | 'providerName' | 'providerBackend' | 'providerInstanceId' | 'model'
    >,
    routing: ParsedPeerMessageRoutingInput | undefined,
  ): PeerRoutingDecision {
    const target = {
      provider: session.providerName,
      backend: session.providerBackend || 'cli',
      instance: session.providerInstanceId || 'default',
      model: session.model,
    };
    const defaultStrategy = routing?.peerId ? 'explicit' : routing?.strategy;

    if (!routing || routing.mode === 'local') {
      return {
        mode: 'local',
        reason: 'Peer routing was not requested.',
        localFallback: false,
        strategy: defaultStrategy,
        target,
      };
    }

    if (session.origin !== 'runtime') {
      throw this.fail({
        code: 'peer_not_routable',
        message: 'Peer routing is only supported for runtime-owned sessions.',
        retryable: false,
        status: 409,
      });
    }

    if (!this.options.config.enabled) {
      throw this.fail({
        code: 'peer_route_disabled',
        message: 'Peer routing is disabled on this runtime.',
        retryable: false,
        status: 409,
      });
    }

    if (routing.peerId) {
      const peer = this.requirePeer(routing.peerId, target.provider, target.backend, target.instance);
      if (this.options.localPeerId && peer.identity.peerId === this.options.localPeerId) {
        return {
          mode: 'local',
          reason: `Peer '${routing.peerId}' resolves to the local runtime.`,
          localFallback: true,
          strategy: 'explicit',
          target,
        };
      }

      return {
        mode: 'peer',
        reason: `Routing to peer '${peer.identity.peerId}' by explicit selection.`,
        localFallback: false,
        strategy: 'explicit',
        target,
        peer,
      };
    }

    if (!this.options.config.allowHeuristicRouting) {
      throw this.fail({
        code: 'peer_route_disabled',
        message: 'Heuristic peer routing is disabled. Select a peer explicitly.',
        retryable: false,
        status: 409,
      });
    }

    const strategy = routing.strategy || 'provider_affinity';
    const candidates = this.options.registry.list().filter((entry) =>
      this.isHeuristicCandidate(entry, target.provider, target.backend, target.instance),
    );

    if (candidates.length === 0) {
      return {
        mode: 'local',
        reason: 'No trusted live peers support this provider target.',
        localFallback: true,
        strategy,
        target,
      };
    }

    const peer = pickPeerByStrategy(candidates, strategy);
    return {
      mode: 'peer',
      reason: `Routing to peer '${peer.identity.peerId}' via ${strategy}.`,
      localFallback: false,
      strategy,
      target,
      peer,
    };
  }

  private requirePeer(
    peerId: string,
    provider: string,
    backend: string,
    instance: string,
  ): PeerRegistryEntry {
    const peer = this.options.registry.get(peerId, { includeStale: true });
    if (!peer) {
      throw this.fail({
        code: 'peer_not_found',
        message: `Peer '${peerId}' is not available.`,
        retryable: true,
        peerId,
        status: 404,
      });
    }

    this.assertRoutablePeer(peer, provider, backend, instance);
    return peer;
  }

  private isHeuristicCandidate(
    entry: PeerRegistryEntry,
    provider: string,
    backend: string,
    instance: string,
  ): boolean {
    if (this.options.localPeerId && entry.identity.peerId === this.options.localPeerId) {
      return false;
    }

    if (entry.liveness.state !== 'alive' || !this.options.trust.canRouteTo(entry)) {
      return false;
    }

    return supportsTarget(entry, provider, backend, instance);
  }

  private assertRoutablePeer(
    entry: PeerRegistryEntry,
    provider: string,
    backend: string,
    instance: string,
  ): void {
    if (entry.liveness.state !== 'alive') {
      throw this.fail({
        code: 'peer_unhealthy',
        message: `Peer '${entry.identity.peerId}' is not live.`,
        retryable: true,
        peerId: entry.identity.peerId,
        status: 503,
      });
    }

    if (entry.trust.state === 'rejected') {
      throw this.fail({
        code: 'peer_rejected',
        message: `Peer '${entry.identity.peerId}' is rejected by local trust policy.`,
        retryable: false,
        peerId: entry.identity.peerId,
        status: 403,
      });
    }

    if (!this.options.trust.canRouteTo(entry)) {
      throw this.fail({
        code: 'peer_untrusted',
        message: `Peer '${entry.identity.peerId}' is not trusted for execution routing.`,
        retryable: false,
        peerId: entry.identity.peerId,
        status: 403,
      });
    }

    if (!supportsTarget(entry, provider, backend, instance)) {
      throw this.fail({
        code: 'peer_not_routable',
        message: `Peer '${entry.identity.peerId}' does not advertise ${provider}/${backend}/${instance}.`,
        retryable: false,
        peerId: entry.identity.peerId,
        status: 409,
      });
    }
  }

  private fail(failure: PeerExecutionFailure) {
    return createPeerExecutionError(failure);
  }
}

export function parsePeerMessageRoutingInput(
  value: unknown,
): ParsedPeerMessageRoutingInput | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createPeerExecutionError({
      code: 'peer_not_routable',
      message: 'routing must be an object when provided.',
      retryable: false,
      status: 400,
    });
  }

  const record = value as Record<string, unknown>;
  const mode = parseRoutingMode(record.mode);
  const peerId = parseOptionalString(record.peerId);
  const strategy = parseRoutingStrategy(record.strategy)
    || (peerId ? 'explicit' : undefined);
  const resolvedMode = mode || (peerId || strategy ? 'peer' : 'local');
  const shareWorkspace = record.shareWorkspace === true;

  if (resolvedMode === 'peer' && !peerId && !strategy) {
    throw createPeerExecutionError({
      code: 'peer_not_routable',
      message: 'routing must include peerId or strategy when peer routing is requested.',
      retryable: false,
      status: 400,
    });
  }

  return {
    mode: resolvedMode,
    ...(peerId ? { peerId } : {}),
    ...(strategy ? { strategy } : {}),
    shareWorkspace,
  };
}

function supportsTarget(
  entry: PeerRegistryEntry,
  provider: string,
  backend: string,
  instance: string,
): boolean {
  if (
    entry.capabilities.targets.some((target) =>
      target.provider === provider
      && target.backend === backend
      && target.instance === instance)
  ) {
    return true;
  }

  return entry.capabilities.providers.includes(provider);
}

function pickPeerByStrategy(
  peers: PeerRegistryEntry[],
  strategy: PeerRoutingStrategy,
): PeerRegistryEntry {
  const sorted = [...peers].sort((left, right) => {
    if (strategy === 'least_busy') {
      if (left.load.busyWorkers !== right.load.busyWorkers) {
        return left.load.busyWorkers - right.load.busyWorkers;
      }
      if (left.load.activeSessions !== right.load.activeSessions) {
        return left.load.activeSessions - right.load.activeSessions;
      }
    }

    if (left.load.capacityState !== right.load.capacityState) {
      return rankCapacity(left.load.capacityState) - rankCapacity(right.load.capacityState);
    }

    return left.identity.displayName.localeCompare(right.identity.displayName);
  });

  return sorted[0];
}

function rankCapacity(
  value: PeerRegistryEntry['load']['capacityState'],
): number {
  switch (value) {
    case 'idle':
      return 0;
    case 'busy':
      return 1;
    case 'unknown':
      return 2;
    case 'saturated':
      return 3;
    default:
      return 4;
  }
}

function parseRoutingMode(
  value: unknown,
): PeerMessageRoutingInput['mode'] | undefined {
  return value === 'local' || value === 'peer'
    ? value
    : undefined;
}

function parseRoutingStrategy(
  value: unknown,
): PeerMessageRoutingInput['strategy'] | undefined {
  return value === 'explicit'
    || value === 'provider_affinity'
    || value === 'least_busy'
    ? value
    : undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}
