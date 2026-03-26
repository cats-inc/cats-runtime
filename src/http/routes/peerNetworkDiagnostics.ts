import { buildPeerNetworkPostureSnapshot, describePeerNetworkPosture, summarizePeerNetworkPosture } from '../../core/peers/networkPosture.js';
import type { AppContext } from '../app.js';

export function getPeerNetworkPostureSnapshot(
  ctx: AppContext,
  includeStale = false,
) {
  const localIdentity = (
    ctx.peerCapabilities
    && 'buildLocalAdvertisement' in ctx.peerCapabilities
    && typeof ctx.peerCapabilities.buildLocalAdvertisement === 'function'
  )
    ? ctx.peerCapabilities.buildLocalAdvertisement().identity
    : null;

  return buildPeerNetworkPostureSnapshot({
    localIdentity,
    peers: ctx.peerRegistry?.list({ includeStale }) || [],
    sharedSecretCount: ctx.peerTrust?.sharedSecretCount || 0,
  });
}

export function buildPeerNetworkPostureSummary(
  ctx: AppContext,
  includeStale = false,
): { network: ReturnType<typeof summarizePeerNetworkPosture> } {
  return {
    network: summarizePeerNetworkPosture(getPeerNetworkPostureSnapshot(ctx, includeStale)),
  };
}

export function buildPeerNetworkPostureDetail(
  ctx: AppContext,
  peerId: string,
  includeStale = false,
): { network: { summary: ReturnType<typeof summarizePeerNetworkPosture>; peer?: ReturnType<typeof describePeerNetworkPosture> } } {
  const snapshot = getPeerNetworkPostureSnapshot(ctx, includeStale);
  const peer = describePeerNetworkPosture(snapshot, peerId);

  return {
    network: {
      summary: summarizePeerNetworkPosture(snapshot),
      ...(peer ? { peer } : {}),
    },
  };
}
