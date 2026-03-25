import type {
  PeerAdvertisement,
  PeerRegistryEntry,
  PeerRegistrySummary,
  PeerSourceKind,
} from './types.js';

interface StoredPeerEntry {
  advertisement: PeerAdvertisement;
  firstSeenAtMs: number;
  observedAtMs: number;
  expiresAtMs: number;
  sources: Set<string>;
  sourceKinds: Set<PeerSourceKind>;
}

export interface PeerRegistryOptions {
  stalePeerTtlMs: number;
  now?: () => number;
}

export interface PeerRegistryListOptions {
  includeStale?: boolean;
  now?: number;
}

export interface PeerRegistryUpsertOptions {
  sourceId: string;
  sourceKind: PeerSourceKind;
}

export class PeerRegistry {
  private readonly entries = new Map<string, StoredPeerEntry>();

  private readonly now: () => number;

  constructor(private readonly options: PeerRegistryOptions) {
    this.now = options.now || (() => Date.now());
  }

  upsert(
    advertisement: PeerAdvertisement,
    options: PeerRegistryUpsertOptions,
  ): PeerRegistryEntry {
    const now = this.now();
    const observedAtMs = parseTimestamp(advertisement.observedAt, now);
    const ttlMs = normalizeTtl(advertisement.ttlMs, this.options.stalePeerTtlMs);
    const expiresAtMs = observedAtMs + ttlMs;
    const peerId = advertisement.identity.peerId;
    const existing = this.entries.get(peerId);

    if (!existing) {
      const created: StoredPeerEntry = {
        advertisement,
        firstSeenAtMs: observedAtMs,
        observedAtMs,
        expiresAtMs,
        sources: new Set([options.sourceId]),
        sourceKinds: new Set([options.sourceKind]),
      };
      this.entries.set(peerId, created);
      return this.materialize(created, now);
    }

    existing.sources.add(options.sourceId);
    existing.sourceKinds.add(options.sourceKind);
    if (observedAtMs >= existing.observedAtMs) {
      existing.advertisement = advertisement;
      existing.observedAtMs = observedAtMs;
      existing.expiresAtMs = expiresAtMs;
    } else {
      existing.expiresAtMs = Math.max(existing.expiresAtMs, expiresAtMs);
    }

    return this.materialize(existing, now);
  }

  get(
    peerId: string,
    options: PeerRegistryListOptions = {},
  ): PeerRegistryEntry | undefined {
    const entry = this.entries.get(peerId);
    if (!entry) {
      return undefined;
    }

    const now = options.now ?? this.now();
    const materialized = this.materialize(entry, now);
    if (!options.includeStale && materialized.liveness.state === 'stale') {
      return undefined;
    }
    return materialized;
  }

  list(options: PeerRegistryListOptions = {}): PeerRegistryEntry[] {
    const now = options.now ?? this.now();
    return Array.from(this.entries.values())
      .map((entry) => this.materialize(entry, now))
      .filter((entry) => options.includeStale || entry.liveness.state === 'alive')
      .sort((left, right) => left.identity.displayName.localeCompare(right.identity.displayName));
  }

  summary(now = this.now()): PeerRegistrySummary {
    return Array.from(this.entries.values())
      .map((entry) => this.materialize(entry, now))
      .reduce<PeerRegistrySummary>(
        (summary, entry) => {
          summary.total += 1;
          if (entry.trust.state === 'self') {
            summary.self += 1;
          } else {
            summary.remote += 1;
          }

          if (entry.liveness.state === 'alive') {
            summary.alive += 1;
          } else {
            summary.stale += 1;
          }

          if (entry.trust.state === 'trusted') {
            summary.trusted += 1;
          } else if (entry.trust.state === 'rejected') {
            summary.rejected += 1;
          } else if (entry.trust.state === 'unknown') {
            summary.unknown += 1;
          }
          return summary;
        },
        {
          total: 0,
          self: 0,
          remote: 0,
          alive: 0,
          stale: 0,
          trusted: 0,
          unknown: 0,
          rejected: 0,
        },
      );
  }

  pruneStale(now = this.now()): string[] {
    const removed: string[] = [];
    for (const [peerId, entry] of this.entries) {
      if (entry.expiresAtMs > now) {
        continue;
      }
      this.entries.delete(peerId);
      removed.push(peerId);
    }
    return removed;
  }

  removeSource(sourceId: string): string[] {
    const removed: string[] = [];
    for (const [peerId, entry] of this.entries) {
      if (!entry.sources.has(sourceId)) {
        continue;
      }
      entry.sources.delete(sourceId);
      if (entry.sources.size > 0) {
        continue;
      }
      this.entries.delete(peerId);
      removed.push(peerId);
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  private materialize(entry: StoredPeerEntry, now: number): PeerRegistryEntry {
    return {
      identity: {
        ...entry.advertisement.identity,
      },
      liveness: {
        state: entry.expiresAtMs > now ? 'alive' : 'stale',
        firstSeenAt: new Date(entry.firstSeenAtMs).toISOString(),
        observedAt: new Date(entry.observedAtMs).toISOString(),
        expiresAt: new Date(entry.expiresAtMs).toISOString(),
        ageMs: Math.max(0, now - entry.observedAtMs),
        expiresInMs: entry.expiresAtMs - now,
      },
      capabilities: {
        providers: [...entry.advertisement.capabilities.providers],
        targets: entry.advertisement.capabilities.targets.map((target) => ({
          ...target,
        })),
        targetLimit: entry.advertisement.capabilities.targetLimit,
        truncated: entry.advertisement.capabilities.truncated,
      },
      load: {
        ...entry.advertisement.load,
        providerWorkers: {
          ...entry.advertisement.load.providerWorkers,
        },
      },
      trust: {
        ...entry.advertisement.trust,
      },
      sources: Array.from(entry.sources).sort((left, right) => left.localeCompare(right)),
      sourceKinds: Array.from(entry.sourceKinds).sort((left, right) => left.localeCompare(right)),
    };
  }
}

function parseTimestamp(value: string, fallback: number): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTtl(value: number, fallback: number): number {
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}
