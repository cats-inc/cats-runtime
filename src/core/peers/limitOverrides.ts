import type { PeerLimitOverride } from './types.js';

export function normalizePeerLimitKey(value: string): string {
  return value.trim().toLowerCase();
}

export function peerIdFromCallerKey(callerKey: string): string | undefined {
  const normalized = normalizePeerLimitKey(callerKey);
  if (!normalized.startsWith('peer:')) {
    return undefined;
  }

  const peerId = normalized.slice('peer:'.length).trim();
  return peerId.length > 0 ? peerId : undefined;
}

export function resolvePeerLimitOverride(
  overrides: readonly PeerLimitOverride[],
  peerId: string | undefined,
): PeerLimitOverride | undefined {
  if (!peerId) {
    return undefined;
  }

  const normalizedPeerId = normalizePeerLimitKey(peerId);
  return overrides.find((override) => override.peerId === normalizedPeerId);
}
