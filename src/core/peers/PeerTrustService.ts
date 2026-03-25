import { timingSafeEqual } from 'node:crypto';
import { validatePeerPayloadSignature } from './auth.js';
import type {
  PeerAdvertisement,
  PeerRegistryEntry,
  PeerRuntimeConfig,
  PeerSourceKind,
  PeerTrustSummary,
} from './types.js';

interface PeerTrustServiceOptions {
  config: Pick<PeerRuntimeConfig, 'sharedSecret' | 'sharedSecrets' | 'trustedPeerIds' | 'rejectedPeerIds'>;
  localPeerId?: string | null;
}

export class PeerTrustService {
  private readonly trustedPeerIds: Set<string>;

  private readonly rejectedPeerIds: Set<string>;

  private readonly sharedSecretBuffers: Buffer[];

  constructor(private readonly options: PeerTrustServiceOptions) {
    this.trustedPeerIds = new Set(options.config.trustedPeerIds);
    this.rejectedPeerIds = new Set(options.config.rejectedPeerIds);
    this.sharedSecretBuffers = normalizeSharedSecrets(options.config).map((secret) => Buffer.from(secret));
  }

  get hasSharedSecret(): boolean {
    return this.sharedSecretBuffers.length > 0;
  }

  validateSharedSecret(token: string | undefined): boolean {
    if (this.sharedSecretBuffers.length === 0 || typeof token !== 'string') {
      return false;
    }

    const tokenBuffer = Buffer.from(token);
    for (const sharedSecretBuffer of this.sharedSecretBuffers) {
      if (tokenBuffer.length !== sharedSecretBuffer.length) {
        continue;
      }
      if (timingSafeEqual(tokenBuffer, sharedSecretBuffer)) {
        return true;
      }
    }
    return false;
  }

  validatePayloadSignature(payload: string, signature: string | undefined): boolean {
    return validatePeerPayloadSignature(
      normalizeSharedSecrets(this.options.config),
      payload,
      signature,
    );
  }

  summarizeAdvertisement(
    advertisement: PeerAdvertisement,
    sourceKind: PeerSourceKind,
  ): PeerTrustSummary {
    return this.summarizePeerId(
      advertisement.identity.peerId,
      sourceKind,
      advertisement.trust,
    );
  }

  summarizePeerId(
    peerId: string,
    sourceKind: PeerSourceKind,
    advertised?: Partial<PeerTrustSummary>,
  ): PeerTrustSummary {
    if (this.options.localPeerId && peerId === this.options.localPeerId) {
      return {
        state: 'self',
        reason: 'local_runtime',
      };
    }

    if (this.rejectedPeerIds.has(peerId)) {
      return {
        state: 'rejected',
        reason: 'configured_reject',
      };
    }

    if (this.trustedPeerIds.has(peerId)) {
      return {
        state: 'trusted',
        reason: 'configured_trust',
      };
    }

    if (
      sourceKind === 'static'
      && (advertised?.state === 'trusted' || advertised?.state === 'rejected')
    ) {
      return {
        state: advertised.state,
        reason: advertised.reason || 'configured_static_peer',
      };
    }

    return {
      state: 'unknown',
      reason: advertised?.reason || 'unverified',
    };
  }

  canRouteTo(entry: PeerRegistryEntry): boolean {
    return entry.trust.state === 'trusted';
  }

  canAcceptInboundExecution(peerId: string): boolean {
    const trust = this.summarizePeerId(peerId, 'lan');
    return trust.state === 'self' || trust.state === 'trusted';
  }
}

function normalizeSharedSecrets(
  config: Pick<PeerRuntimeConfig, 'sharedSecret' | 'sharedSecrets'>,
): string[] {
  return Array.from(new Set([
    ...(typeof config.sharedSecret === 'string' && config.sharedSecret.length > 0 ? [config.sharedSecret] : []),
    ...config.sharedSecrets,
  ]));
}
