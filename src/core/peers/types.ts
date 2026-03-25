import type { BackendKind } from '../../backends/cli/config.js';

export type PeerDiscoveryStatus = 'disabled' | 'stopped' | 'running';
export type PeerSourceKind = 'self' | 'static' | 'lan';
export type PeerTrustState = 'self' | 'unknown' | 'trusted' | 'rejected';
export type PeerLivenessState = 'alive' | 'stale';
export type PeerCapacityState = 'idle' | 'busy' | 'saturated' | 'unknown';
export type PeerAdapterState = 'idle' | 'running' | 'stopped' | 'error';

export interface PeerIdentity {
  peerId: string;
  displayName: string;
  runtimeVersion: string;
  advertisedUrl?: string;
  advertisedHost?: string;
  advertisedPort?: number;
}

export interface PeerCapabilityTarget {
  provider: string;
  backend: BackendKind;
  instance: string;
  default: boolean;
}

export interface PeerCapabilitySummary {
  providers: string[];
  targets: PeerCapabilityTarget[];
  targetLimit: number;
  truncated: boolean;
}

export interface PeerLoadSummary {
  activeSessions: number;
  busyWorkers: number;
  idleWorkers: number;
  providerWorkers: Record<string, number>;
  capacityState: PeerCapacityState;
}

export interface PeerTrustSummary {
  state: PeerTrustState;
  reason: string;
}

export interface PeerAdvertisement {
  identity: PeerIdentity;
  observedAt: string;
  ttlMs: number;
  capabilities: PeerCapabilitySummary;
  load: PeerLoadSummary;
  trust: PeerTrustSummary;
}

export interface PeerLivenessSummary {
  state: PeerLivenessState;
  firstSeenAt: string;
  observedAt: string;
  expiresAt: string;
  ageMs: number;
  expiresInMs: number;
}

export interface PeerRegistryEntry {
  identity: PeerIdentity;
  liveness: PeerLivenessSummary;
  capabilities: PeerCapabilitySummary;
  load: PeerLoadSummary;
  trust: PeerTrustSummary;
  sources: string[];
  sourceKinds: PeerSourceKind[];
}

export interface PeerRegistrySummary {
  total: number;
  self: number;
  remote: number;
  alive: number;
  stale: number;
  trusted: number;
  unknown: number;
  rejected: number;
}

export interface StaticPeerSeed {
  peerId?: string;
  displayName?: string;
  advertisedUrl?: string;
  advertisedHost?: string;
  advertisedPort?: number;
  providers?: string[];
  targets?: PeerCapabilityTarget[];
  load?: Partial<PeerLoadSummary>;
  trust?: Partial<PeerTrustSummary>;
  ttlMs?: number;
}

export interface PeerRuntimeConfig {
  enabled: boolean;
  peerId?: string;
  displayName?: string;
  advertisedUrl?: string;
  advertisedHost?: string;
  advertisedPort?: number;
  stalePeerTtlMs: number;
  pruneIntervalMs: number;
  advertiseIntervalMs: number;
  maxAdvertisedTargets: number;
  staticPeers: StaticPeerSeed[];
}

export interface PeerDiscoveryAdapterSnapshot {
  id: string;
  kind: PeerSourceKind;
  state: PeerAdapterState;
  publishedPeers: number;
  lastStartedAt?: string;
  lastStoppedAt?: string;
  lastPublishedAt?: string;
  lastError?: string;
}

export interface PeerDiscoverySnapshot {
  enabled: boolean;
  status: PeerDiscoveryStatus;
  localPeerId: string | null;
  stalePeerTtlMs: number;
  pruneIntervalMs: number;
  advertiseIntervalMs: number;
  lastStartedAt?: string;
  lastStoppedAt?: string;
  summary: string;
  registry: PeerRegistrySummary;
  adapters: PeerDiscoveryAdapterSnapshot[];
}
