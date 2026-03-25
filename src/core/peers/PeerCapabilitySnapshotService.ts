import { createHash } from 'node:crypto';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../../backends/cli/pool/WorkerPool.js';
import type { RuntimeStartupState } from '../../startup.js';
import { RUNTIME_VERSION } from '../../startup.js';
import type { RuntimeConfig } from '../config.js';
import { listProviderCatalog } from '../providerCatalog.js';
import type {
  PeerAdvertisement,
  PeerCapabilitySummary,
  PeerCapacityState,
  PeerIdentity,
  PeerLoadSummary,
  PeerRuntimeConfig,
  StaticPeerSeed,
} from './types.js';

interface PeerCapabilitySnapshotServiceOptions {
  config: RuntimeConfig;
  peerConfig: PeerRuntimeConfig;
  startup: RuntimeStartupState;
  registry: SessionRegistry;
  pool: WorkerPool;
  now?: () => number;
}

export class PeerCapabilitySnapshotService {
  private readonly now: () => number;

  private readonly localPeerId: string;

  constructor(private readonly options: PeerCapabilitySnapshotServiceOptions) {
    this.now = options.now || (() => Date.now());
    this.localPeerId = normalizePeerId(
      options.peerConfig.peerId
      || createHash('sha256')
        .update([
          options.config.dataDir || '',
          options.config.sessionBaseDir,
          options.config.host,
          options.peerConfig.displayName || '',
        ].join('|'))
        .digest('hex')
        .slice(0, 16),
    );
  }

  getLocalPeerId(): string {
    return this.localPeerId;
  }

  buildLocalAdvertisement(): PeerAdvertisement {
    return {
      identity: this.buildLocalIdentity(),
      observedAt: new Date(this.now()).toISOString(),
      ttlMs: this.options.peerConfig.stalePeerTtlMs,
      capabilities: this.buildLocalCapabilities(),
      load: this.buildLocalLoad(),
      trust: {
        state: 'self',
        reason: 'local_runtime',
      },
    };
  }

  buildStaticAdvertisement(seed: StaticPeerSeed): PeerAdvertisement {
    return {
      identity: {
        peerId: normalizePeerId(seed.peerId || seed.displayName || 'peer'),
        displayName: seed.displayName || 'peer',
        runtimeVersion: RUNTIME_VERSION,
        ...(seed.advertisedUrl ? { advertisedUrl: seed.advertisedUrl } : {}),
        ...(seed.advertisedHost ? { advertisedHost: seed.advertisedHost } : {}),
        ...(seed.advertisedPort ? { advertisedPort: seed.advertisedPort } : {}),
      },
      observedAt: new Date(this.now()).toISOString(),
      ttlMs: seed.ttlMs || this.options.peerConfig.stalePeerTtlMs,
      capabilities: this.buildStaticCapabilities(seed),
      load: this.buildStaticLoad(seed),
      trust: {
        state: seed.trust?.state || 'unknown',
        reason: seed.trust?.reason || 'unverified',
      },
    };
  }

  private buildLocalIdentity(): PeerIdentity {
    return {
      peerId: this.localPeerId,
      displayName: this.options.peerConfig.displayName || 'cats-runtime',
      runtimeVersion: RUNTIME_VERSION,
      ...resolveAdvertisedEndpoint(this.options.config, this.options.peerConfig, this.options.startup),
    };
  }

  private buildLocalCapabilities(): PeerCapabilitySummary {
    const catalog = listProviderCatalog(this.options.config);
    const targets = Object.values(catalog)
      .flatMap((entry) => entry.instances)
      .map((target) => ({
        provider: target.providerName,
        backend: target.backend,
        instance: target.instanceId,
        default: target.defaultTarget,
      }));

    const boundedTargets = targets.slice(0, this.options.peerConfig.maxAdvertisedTargets);
    return {
      providers: Array.from(new Set(boundedTargets.map((target) => target.provider)))
        .sort((left, right) => left.localeCompare(right)),
      targets: boundedTargets,
      targetLimit: this.options.peerConfig.maxAdvertisedTargets,
      truncated: targets.length > boundedTargets.length,
    };
  }

  private buildStaticCapabilities(seed: StaticPeerSeed): PeerCapabilitySummary {
    const targets = (seed.targets || []).slice(0, this.options.peerConfig.maxAdvertisedTargets);
    const providers = Array.from(
      new Set([
        ...(seed.providers || []),
        ...targets.map((target) => target.provider),
      ]),
    ).sort((left, right) => left.localeCompare(right));

    return {
      providers,
      targets: targets.map((target) => ({
        ...target,
      })),
      targetLimit: this.options.peerConfig.maxAdvertisedTargets,
      truncated: (seed.targets?.length || 0) > targets.length,
    };
  }

  private buildLocalLoad(): PeerLoadSummary {
    const workerStatus = this.options.pool.status();
    return {
      activeSessions: this.options.registry.list().length,
      busyWorkers: workerStatus.busy,
      idleWorkers: workerStatus.idle,
      providerWorkers: {
        ...workerStatus.providers,
      },
      capacityState: inferCapacityState(workerStatus.busy, workerStatus.idle),
    };
  }

  private buildStaticLoad(seed: StaticPeerSeed): PeerLoadSummary {
    const activeSessions = seed.load?.activeSessions ?? 0;
    const busyWorkers = seed.load?.busyWorkers ?? 0;
    const idleWorkers = seed.load?.idleWorkers ?? 0;
    return {
      activeSessions,
      busyWorkers,
      idleWorkers,
      providerWorkers: {
        ...(seed.load?.providerWorkers || {}),
      },
      capacityState: inferCapacityState(busyWorkers, idleWorkers, true),
    };
  }
}

function normalizePeerId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'peer';
}

function inferCapacityState(
  busyWorkers: number,
  idleWorkers: number,
  preferUnknown = false,
): PeerCapacityState {
  if (busyWorkers === 0 && idleWorkers === 0) {
    return preferUnknown ? 'unknown' : 'idle';
  }
  if (busyWorkers > 0 && idleWorkers === 0) {
    return 'saturated';
  }
  if (busyWorkers > 0) {
    return 'busy';
  }
  return 'idle';
}

function resolveAdvertisedEndpoint(
  config: RuntimeConfig,
  peerConfig: PeerRuntimeConfig,
  startup: RuntimeStartupState,
): Partial<PeerIdentity> {
  if (peerConfig.advertisedUrl) {
    return {
      advertisedUrl: peerConfig.advertisedUrl,
      ...(peerConfig.advertisedHost ? { advertisedHost: peerConfig.advertisedHost } : {}),
      ...(peerConfig.advertisedPort ? { advertisedPort: peerConfig.advertisedPort } : {}),
    };
  }

  if (peerConfig.advertisedHost && peerConfig.advertisedPort) {
    return {
      advertisedHost: peerConfig.advertisedHost,
      advertisedPort: peerConfig.advertisedPort,
      advertisedUrl: `http://${peerConfig.advertisedHost}:${peerConfig.advertisedPort}`,
    };
  }

  if (startup.address) {
    return {
      advertisedHost: startup.address.host,
      advertisedPort: startup.address.port,
      advertisedUrl: `http://${startup.address.host}:${startup.address.port}`,
    };
  }

  if (config.host && config.host !== '0.0.0.0' && config.port > 0) {
    return {
      advertisedHost: config.host,
      advertisedPort: config.port,
      advertisedUrl: `http://${config.host}:${config.port}`,
    };
  }

  return {};
}
