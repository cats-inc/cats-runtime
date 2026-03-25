import os from 'node:os';
import { createHash } from 'node:crypto';
import type { RuntimeConfig } from '../config.js';
import { getRuntimeConfigEnv } from '../config.js';
import type {
  PeerCapabilityTarget,
  PeerLoadSummary,
  PeerRuntimeConfig,
  PeerTrustSummary,
  StaticPeerSeed,
} from './types.js';

const DEFAULT_STALE_PEER_TTL_MS = 30_000;
const DEFAULT_MAX_ADVERTISED_TARGETS = 16;
const DEFAULT_PEER_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_PEER_AUTH_FAILURE_WINDOW_MS = 60_000;
const DEFAULT_PEER_AUTH_FAILURE_LIMIT = 5;
const DEFAULT_MAX_INBOUND_PEER_EXECUTIONS = 8;
const DEFAULT_MAX_INBOUND_PEER_EXECUTIONS_PER_PEER = 2;

export function loadPeerRuntimeConfig(config: RuntimeConfig): PeerRuntimeConfig {
  const env = getRuntimeConfigEnv(config);
  const enabled = parseBoolean(env.CATS_RUNTIME_PEERS_ENABLED, false);
  const stalePeerTtlMs = parsePositiveInt(
    env.CATS_RUNTIME_PEER_STALE_TTL_MS,
    DEFAULT_STALE_PEER_TTL_MS,
  );
  const pruneIntervalMs = parsePositiveInt(
    env.CATS_RUNTIME_PEER_PRUNE_INTERVAL_MS,
    Math.max(1_000, Math.floor(stalePeerTtlMs / 3)),
  );
  const advertiseIntervalMs = parsePositiveInt(
    env.CATS_RUNTIME_PEER_ADVERTISE_INTERVAL_MS,
    Math.max(1_000, Math.floor(stalePeerTtlMs / 2)),
  );
  const maxAdvertisedTargets = parsePositiveInt(
    env.CATS_RUNTIME_PEER_MAX_TARGETS,
    DEFAULT_MAX_ADVERTISED_TARGETS,
  );
  const requestTimeoutMs = parsePositiveInt(
    env.CATS_RUNTIME_PEER_REQUEST_TIMEOUT_MS,
    DEFAULT_PEER_REQUEST_TIMEOUT_MS,
  );
  const authFailureWindowMs = parsePositiveInt(
    env.CATS_RUNTIME_PEER_AUTH_FAILURE_WINDOW_MS,
    DEFAULT_PEER_AUTH_FAILURE_WINDOW_MS,
  );
  const maxAuthFailuresPerWindow = parsePositiveInt(
    env.CATS_RUNTIME_PEER_AUTH_FAILURE_LIMIT,
    DEFAULT_PEER_AUTH_FAILURE_LIMIT,
  );
  const maxInboundExecutions = parsePositiveInt(
    env.CATS_RUNTIME_PEER_MAX_INBOUND_EXECUTIONS,
    DEFAULT_MAX_INBOUND_PEER_EXECUTIONS,
  );
  const maxInboundExecutionsPerPeer = parsePositiveInt(
    env.CATS_RUNTIME_PEER_MAX_INBOUND_EXECUTIONS_PER_PEER,
    DEFAULT_MAX_INBOUND_PEER_EXECUTIONS_PER_PEER,
  );
  const sharedSecrets = mergeSharedSecrets(
    sanitizeString(env.CATS_RUNTIME_PEER_SHARED_SECRET),
    parseStringList(env.CATS_RUNTIME_PEER_SHARED_SECRETS),
  );

  return {
    enabled,
    peerId: sanitizeString(env.CATS_RUNTIME_PEER_ID),
    displayName: sanitizeString(env.CATS_RUNTIME_PEER_NAME) || os.hostname(),
    advertisedUrl: sanitizeString(env.CATS_RUNTIME_PEER_ADVERTISE_URL),
    advertisedHost: sanitizeString(env.CATS_RUNTIME_PEER_ADVERTISE_HOST),
    advertisedPort: parseOptionalPort(env.CATS_RUNTIME_PEER_ADVERTISE_PORT),
    stalePeerTtlMs,
    pruneIntervalMs,
    advertiseIntervalMs,
    maxAdvertisedTargets,
    requestTimeoutMs,
    authFailureWindowMs,
    maxAuthFailuresPerWindow,
    maxInboundExecutions,
    maxInboundExecutionsPerPeer,
    allowHeuristicRouting: parseBoolean(
      env.CATS_RUNTIME_PEER_ALLOW_HEURISTIC_ROUTING,
      false,
    ),
    sharedSecret: sharedSecrets[0],
    sharedSecrets,
    trustedPeerIds: parseStringList(env.CATS_RUNTIME_PEER_TRUSTED_IDS),
    rejectedPeerIds: parseStringList(env.CATS_RUNTIME_PEER_REJECTED_IDS),
    staticPeers: enabled
      ? parseStaticPeers(env.CATS_RUNTIME_PEER_STATIC_PEERS, maxAdvertisedTargets)
      : [],
  };
}

function parseStaticPeers(
  raw: string | undefined,
  maxAdvertisedTargets: number,
): StaticPeerSeed[] {
  const trimmed = sanitizeString(raw);
  if (!trimmed) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Invalid CATS_RUNTIME_PEER_STATIC_PEERS JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .map((item, index) => normalizeStaticPeerSeed(item, index, maxAdvertisedTargets))
    .filter((item): item is StaticPeerSeed => item !== undefined);
}

function normalizeStaticPeerSeed(
  value: unknown,
  index: number,
  maxAdvertisedTargets: number,
): StaticPeerSeed | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const advertisedUrl = sanitizeString(record.advertisedUrl) || sanitizeString(record.baseUrl);
  const displayName = sanitizeString(record.displayName)
    || sanitizeString(record.name)
    || `peer-${index + 1}`;
  const peerId = sanitizeString(record.peerId)
    || deriveSeedPeerId(displayName, advertisedUrl, record);
  const targets = normalizeTargets(record.targets, maxAdvertisedTargets);
  const providers = normalizeProviders(record.providers, targets);
  const load = normalizeLoad(record.load);
  const trust = normalizeTrust(record.trust);
  const ttlMs = parsePositiveIntOrUndefined(record.ttlMs);

  return {
    peerId,
    displayName,
    advertisedUrl,
    advertisedHost: sanitizeString(record.advertisedHost),
    advertisedPort: parseOptionalPort(record.advertisedPort),
    ...(providers.length > 0 ? { providers } : {}),
    ...(targets.length > 0 ? { targets } : {}),
    ...(load ? { load } : {}),
    ...(trust ? { trust } : {}),
    ...(ttlMs ? { ttlMs } : {}),
  };
}

function deriveSeedPeerId(
  displayName: string,
  advertisedUrl: string | undefined,
  record: Record<string, unknown>,
): string {
  const fingerprint = advertisedUrl
    || sanitizeString(record.advertisedHost)
    || `${displayName}:${parseOptionalPort(record.advertisedPort) ?? 'unknown'}`;
  return `peer_${createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)}`;
}

function normalizeTargets(
  value: unknown,
  maxAdvertisedTargets: number,
): PeerCapabilityTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return [];
      }
      const record = item as Record<string, unknown>;
      const provider = sanitizeString(record.provider);
      const backend = sanitizeBackend(record.backend);
      const instance = sanitizeString(record.instance);
      if (!provider || !backend || !instance) {
        return [];
      }
      return [{
        provider,
        backend,
        instance,
        default: parseBoolean(record.default, false),
      }];
    })
    .slice(0, maxAdvertisedTargets);
}

function normalizeProviders(
  value: unknown,
  targets: PeerCapabilityTarget[],
): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => sanitizeString(item))
          .filter((item): item is string => Boolean(item)),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }

  return Array.from(new Set(targets.map((target) => target.provider)))
    .sort((left, right) => left.localeCompare(right));
}

function mergeSharedSecrets(
  primary: string | undefined,
  rotationList: string[],
): string[] {
  return Array.from(new Set([
    ...(
      typeof primary === 'string' && primary.length > 0
        ? [primary]
        : []
    ),
    ...rotationList,
  ]));
}

function normalizeLoad(value: unknown): Partial<PeerLoadSummary> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const activeSessions = parseNonNegativeInt(record.activeSessions);
  const busyWorkers = parseNonNegativeInt(record.busyWorkers);
  const idleWorkers = parseNonNegativeInt(record.idleWorkers);
  const providerWorkers = normalizeProviderWorkers(record.providerWorkers);

  return {
    ...(activeSessions !== undefined ? { activeSessions } : {}),
    ...(busyWorkers !== undefined ? { busyWorkers } : {}),
    ...(idleWorkers !== undefined ? { idleWorkers } : {}),
    ...(providerWorkers ? { providerWorkers } : {}),
  };
}

function normalizeProviderWorkers(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .flatMap(([provider, count]) => {
      const normalized = parseNonNegativeInt(count);
      if (normalized === undefined) {
        return [];
      }
      return [[provider, normalized] as const];
    });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeTrust(value: unknown): Partial<PeerTrustSummary> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const state = sanitizeTrustState(record.state);
  const reason = sanitizeString(record.reason);
  if (!state && !reason) {
    return undefined;
  }

  return {
    ...(state ? { state } : {}),
    ...(reason ? { reason } : {}),
  };
}

function sanitizeBackend(value: unknown): PeerCapabilityTarget['backend'] | undefined {
  if (value !== 'cli' && value !== 'api' && value !== 'local' && value !== 'agent') {
    return undefined;
  }
  return value;
}

function sanitizeTrustState(value: unknown): PeerTrustSummary['state'] | undefined {
  if (value !== 'self' && value !== 'unknown' && value !== 'trusted' && value !== 'rejected') {
    return undefined;
  }
  return value;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === '1' || value === 'true' || value === 'yes') {
    return true;
  }
  if (value === false || value === '0' || value === 'false' || value === 'no') {
    return false;
  }
  return fallback;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = parsePositiveIntOrUndefined(value);
  return parsed ?? fallback;
}

function parsePositiveIntOrUndefined(value: unknown): number | undefined {
  const text = sanitizeString(value);
  if (!text) {
    return undefined;
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseNonNegativeInt(value: unknown): number | undefined {
  const text = sanitizeString(value);
  if (!text) {
    return undefined;
  }
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseOptionalPort(value: unknown): number | undefined {
  const parsed = parsePositiveIntOrUndefined(value);
  if (parsed === undefined || parsed > 65_535) {
    return undefined;
  }
  return parsed;
}

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseStringList(value: unknown): string[] {
  const text = sanitizeString(value);
  if (!text) {
    return [];
  }

  const parsedJson = tryParseStringArrayJson(text);
  const values = parsedJson
    ?? text.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);

  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function tryParseStringArrayJson(value: string): string[] | undefined {
  if (!value.startsWith('[')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed
      .map((entry) => sanitizeString(entry))
      .filter((entry): entry is string => Boolean(entry));
  } catch {
    return undefined;
  }
}
