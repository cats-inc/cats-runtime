import { PeerRegistry } from './PeerRegistry.js';
import { PeerCapabilitySnapshotService } from './PeerCapabilitySnapshotService.js';
import type {
  PeerAdvertisement,
  PeerDiscoveryAdapterSnapshot,
  PeerDiscoverySnapshot,
  PeerRegistrySummary,
  PeerRuntimeConfig,
  PeerSourceKind,
} from './types.js';

interface PeerDiscoveryAdapterRuntime {
  upsert(
    advertisement: PeerAdvertisement,
    options: {
      sourceId: string;
      sourceKind: PeerSourceKind;
    },
  ): void;
  removeSource(sourceId: string): void;
}

export interface PeerDiscoveryAdapter {
  readonly id: string;
  readonly kind: PeerSourceKind;
  start(runtime: PeerDiscoveryAdapterRuntime): void;
  stop(): void;
  snapshot(): PeerDiscoveryAdapterSnapshot;
  refresh?(): void;
}

export interface PeerDiscoveryControllerOptions {
  config: PeerRuntimeConfig;
  registry: PeerRegistry;
  capabilitySnapshot: PeerCapabilitySnapshotService;
  adapters?: PeerDiscoveryAdapter[];
  now?: () => number;
}

export class PeerDiscoveryController {
  private readonly now: () => number;

  private readonly adapters: PeerDiscoveryAdapter[];

  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  private started = false;

  private lastStartedAt?: string;

  private lastStoppedAt?: string;

  constructor(private readonly options: PeerDiscoveryControllerOptions) {
    this.now = options.now || (() => Date.now());
    this.adapters = options.adapters || createDefaultPeerDiscoveryAdapters(
      options.config,
      options.capabilitySnapshot,
      this.now,
    );
  }

  start(): void {
    if (this.started || !this.options.config.enabled) {
      return;
    }

    this.started = true;
    this.lastStartedAt = new Date(this.now()).toISOString();
    const runtime: PeerDiscoveryAdapterRuntime = {
      upsert: (advertisement, options) => {
        this.options.registry.upsert(advertisement, options);
      },
      removeSource: (sourceId) => {
        this.options.registry.removeSource(sourceId);
      },
    };

    for (const adapter of this.adapters) {
      adapter.start(runtime);
    }

    this.pruneTimer = setInterval(() => {
      this.options.registry.pruneStale();
    }, this.options.config.pruneIntervalMs);
    this.pruneTimer.unref?.();
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.lastStoppedAt = new Date(this.now()).toISOString();
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    for (const adapter of this.adapters) {
      adapter.stop();
    }
  }

  refreshSelf(): void {
    for (const adapter of this.adapters) {
      adapter.refresh?.();
    }
  }

  snapshot(): PeerDiscoverySnapshot {
    const registrySummary = this.options.registry.summary(this.now());
    return {
      enabled: this.options.config.enabled,
      status: !this.options.config.enabled
        ? 'disabled'
        : this.started
          ? 'running'
          : 'stopped',
      localPeerId: this.options.capabilitySnapshot.getLocalPeerId(),
      stalePeerTtlMs: this.options.config.stalePeerTtlMs,
      pruneIntervalMs: this.options.config.pruneIntervalMs,
      advertiseIntervalMs: this.options.config.advertiseIntervalMs,
      ...(this.lastStartedAt ? { lastStartedAt: this.lastStartedAt } : {}),
      ...(this.lastStoppedAt ? { lastStoppedAt: this.lastStoppedAt } : {}),
      summary: buildPeerDiscoverySummary(
        this.options.config.enabled,
        this.started,
        registrySummary,
      ),
      registry: registrySummary,
      adapters: this.adapters.map((adapter) => adapter.snapshot()),
    };
  }
}

export function createDisabledPeerDiscoverySnapshot(
  localPeerId: string | null = null,
  registrySummary?: PeerRegistrySummary,
): PeerDiscoverySnapshot {
  return {
    enabled: false,
    status: 'disabled',
    localPeerId,
    stalePeerTtlMs: 0,
    pruneIntervalMs: 0,
    advertiseIntervalMs: 0,
    summary: 'Peer discovery is disabled.',
    registry: registrySummary || {
      total: 0,
      self: 0,
      remote: 0,
      alive: 0,
      stale: 0,
      trusted: 0,
      unknown: 0,
      rejected: 0,
    },
    adapters: [],
  };
}

function buildPeerDiscoverySummary(
  enabled: boolean,
  started: boolean,
  registry: PeerRegistrySummary,
): string {
  if (!enabled) {
    return 'Peer discovery is disabled.';
  }
  if (!started) {
    return 'Peer discovery is configured but not running.';
  }
  if (registry.alive === 0) {
    return 'Peer discovery is running with no live peers.';
  }
  return `Peer discovery is running with ${registry.alive} live peer(s).`;
}

function createDefaultPeerDiscoveryAdapters(
  config: PeerRuntimeConfig,
  capabilitySnapshot: PeerCapabilitySnapshotService,
  now: () => number,
): PeerDiscoveryAdapter[] {
  const adapters: PeerDiscoveryAdapter[] = [
    new LocalPeerDiscoveryAdapter(config, capabilitySnapshot, now),
  ];

  if (config.staticPeers.length > 0) {
    adapters.push(new StaticPeerDiscoveryAdapter(config, capabilitySnapshot, now));
  }

  return adapters;
}

class LocalPeerDiscoveryAdapter implements PeerDiscoveryAdapter {
  readonly id = 'self';

  readonly kind = 'self' as const;

  private runtime?: PeerDiscoveryAdapterRuntime;

  private timer: ReturnType<typeof setInterval> | null = null;

  private state: PeerDiscoveryAdapterSnapshot = {
    id: this.id,
    kind: this.kind,
    state: 'idle',
    publishedPeers: 0,
  };

  constructor(
    private readonly config: PeerRuntimeConfig,
    private readonly capabilitySnapshot: PeerCapabilitySnapshotService,
    private readonly now: () => number,
  ) {}

  start(runtime: PeerDiscoveryAdapterRuntime): void {
    this.runtime = runtime;
    this.state = {
      ...this.state,
      state: 'running',
      lastStartedAt: toIsoTimestamp(this.now),
    };
    this.publish();
    this.timer = setInterval(() => {
      this.publish();
    }, this.config.advertiseIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.runtime?.removeSource(this.id);
    this.state = {
      ...this.state,
      state: 'stopped',
      publishedPeers: 0,
      lastStoppedAt: toIsoTimestamp(this.now),
    };
  }

  refresh(): void {
    if (this.state.state !== 'running') {
      return;
    }
    this.publish();
  }

  snapshot(): PeerDiscoveryAdapterSnapshot {
    return { ...this.state };
  }

  private publish(): void {
    if (!this.runtime) {
      return;
    }
    this.runtime.upsert(this.capabilitySnapshot.buildLocalAdvertisement(), {
      sourceId: this.id,
      sourceKind: this.kind,
    });
    this.state = {
      ...this.state,
      publishedPeers: 1,
      lastPublishedAt: toIsoTimestamp(this.now),
    };
  }
}

class StaticPeerDiscoveryAdapter implements PeerDiscoveryAdapter {
  readonly id = 'static';

  readonly kind = 'static' as const;

  private runtime?: PeerDiscoveryAdapterRuntime;

  private timer: ReturnType<typeof setInterval> | null = null;

  private state: PeerDiscoveryAdapterSnapshot = {
    id: this.id,
    kind: this.kind,
    state: 'idle',
    publishedPeers: 0,
  };

  constructor(
    private readonly config: PeerRuntimeConfig,
    private readonly capabilitySnapshot: PeerCapabilitySnapshotService,
    private readonly now: () => number,
  ) {}

  start(runtime: PeerDiscoveryAdapterRuntime): void {
    this.runtime = runtime;
    this.state = {
      ...this.state,
      state: 'running',
      lastStartedAt: toIsoTimestamp(this.now),
    };
    this.publish();
    this.timer = setInterval(() => {
      this.publish();
    }, this.config.advertiseIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const seed of this.config.staticPeers) {
      const advertisement = this.capabilitySnapshot.buildStaticAdvertisement(seed);
      this.runtime?.removeSource(this.sourceId(advertisement.identity.peerId));
    }
    this.state = {
      ...this.state,
      state: 'stopped',
      publishedPeers: 0,
      lastStoppedAt: toIsoTimestamp(this.now),
    };
  }

  snapshot(): PeerDiscoveryAdapterSnapshot {
    return { ...this.state };
  }

  private publish(): void {
    if (!this.runtime) {
      return;
    }

    let publishedPeers = 0;
    for (const seed of this.config.staticPeers) {
      const advertisement = this.capabilitySnapshot.buildStaticAdvertisement(seed);
      this.runtime.upsert(advertisement, {
        sourceId: this.sourceId(advertisement.identity.peerId),
        sourceKind: this.kind,
      });
      publishedPeers += 1;
    }

    this.state = {
      ...this.state,
      publishedPeers,
      lastPublishedAt: toIsoTimestamp(this.now),
    };
  }

  private sourceId(peerId: string): string {
    return `${this.id}:${peerId}`;
  }
}

function toIsoTimestamp(now: () => number): string {
  return new Date(now()).toISOString();
}
