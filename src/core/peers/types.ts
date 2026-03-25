import type { BackendKind } from '../../backends/cli/config.js';
import type {
  SessionInvocationContext,
} from '../types.js';

export type PeerDiscoveryStatus = 'disabled' | 'stopped' | 'running';
export type PeerSourceKind = 'self' | 'static' | 'lan';
export type PeerTrustState = 'self' | 'unknown' | 'trusted' | 'rejected';
export type PeerLivenessState = 'alive' | 'stale';
export type PeerCapacityState = 'idle' | 'busy' | 'saturated' | 'unknown';
export type PeerAdapterState = 'idle' | 'running' | 'stopped' | 'error';
export type PeerRoutingMode = 'local' | 'peer';
export type PeerRoutingStrategy = 'explicit' | 'provider_affinity' | 'least_busy';
export type PeerExecutionTransport = 'sse' | 'ndjson';
export type PeerExecutionWorkspaceMode = 'none' | 'read_only';
export type PeerExecutionFailureCode =
  | 'peer_route_disabled'
  | 'peer_not_found'
  | 'peer_not_routable'
  | 'peer_untrusted'
  | 'peer_rejected'
  | 'peer_unhealthy'
  | 'peer_auth_required'
  | 'peer_auth_failed'
  | 'peer_request_timeout'
  | 'peer_http_error'
  | 'peer_protocol_error'
  | 'peer_stream_disconnect'
  | 'peer_execution_rejected';

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
  requestTimeoutMs: number;
  authFailureWindowMs: number;
  maxAuthFailuresPerWindow: number;
  maxInboundExecutions: number;
  maxInboundExecutionsPerPeer: number;
  allowHeuristicRouting: boolean;
  sharedSecret?: string;
  trustedPeerIds: string[];
  rejectedPeerIds: string[];
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

export interface PeerMessageRoutingInput {
  mode?: PeerRoutingMode;
  peerId?: string;
  strategy?: PeerRoutingStrategy;
  shareWorkspace?: boolean;
}

export interface ParsedPeerMessageRoutingInput {
  mode: PeerRoutingMode;
  peerId?: string;
  strategy?: PeerRoutingStrategy;
  shareWorkspace: boolean;
}

export interface PeerExecutionCaller {
  peerId: string;
  sessionId: string;
  runId: string;
  traceId?: string;
}

export interface PeerExecutionTarget {
  provider: string;
  backend?: BackendKind;
  instance?: string;
  model?: string;
}

export interface PeerExecutionWorkspace {
  mode: PeerExecutionWorkspaceMode;
  cwd?: string;
}

export interface PeerExecutionTurn {
  message: string;
  instructions?: string;
  context?: SessionInvocationContext;
}

export interface PeerExecutionRequest {
  caller: PeerExecutionCaller;
  target: PeerExecutionTarget;
  workspace: PeerExecutionWorkspace;
  turn: PeerExecutionTurn;
}

export interface PeerExecutionTrace {
  requestId: string;
  callerPeerId: string;
  callerSessionId: string;
  callerRunId: string;
  peerId: string;
  routedAt: string;
  transport: PeerExecutionTransport;
  strategy: PeerRoutingStrategy;
  workspaceMode: PeerExecutionWorkspaceMode;
}

export interface PeerExecutionFailure {
  code: PeerExecutionFailureCode;
  message: string;
  retryable: boolean;
  peerId?: string;
  status?: number;
  details?: Record<string, unknown>;
}

export interface PeerRoutingDecision {
  mode: PeerRoutingMode;
  reason: string;
  localFallback: boolean;
  strategy?: PeerRoutingStrategy;
  target: {
    provider: string;
    backend: BackendKind;
    instance: string;
    model?: string;
  };
  peer?: PeerRegistryEntry;
}
