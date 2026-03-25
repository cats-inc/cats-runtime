import { timingSafeEqual } from 'node:crypto';
import type {
  PeerAdvertisement,
  PeerRegistryEntry,
  PeerRuntimeConfig,
  PeerSourceKind,
  PeerTrustSummary,
} from './types.js';

interface PeerTrustServiceOptions {
  config: Pick<PeerRuntimeConfig, 'sharedSecret' | 'trustedPeerIds' | 'rejectedPeerIds'>;
  localPeerId?: string | null;
}

export class PeerTrustService {
  private readonly trustedPeerIds: Set<string>;

  private readonly rejectedPeerIds: Set<string>;

  private readonly sharedSecretBuffer?: Buffer;

  constructor(private readonly options: PeerTrustServiceOptions) {
    this.trustedPeerIds = new Set(options.config.trustedPeerIds);
    this.rejectedPeerIds = new Set(options.config.rejectedPeerIds);
    this.sharedSecretBuffer = typeof options.config.sharedSecret === 'string'
      && options.config.sharedSecret.length > 0
      ? Buffer.from(options.config.sharedSecret)
      : undefined;
  }

  get hasSharedSecret(): boolean {
    return Boolean(this.sharedSecretBuffer && this.sharedSecretBuffer.length > 0);
  }

  validateSharedSecret(token: string | undefined): boolean {
    if (!this.sharedSecretBuffer || typeof token !== 'string') {
      return false;
    }

    const tokenBuffer = Buffer.from(token);
    if (tokenBuffer.length !== this.sharedSecretBuffer.length) {
      return false;
    }

    return timingSafeEqual(tokenBuffer, this.sharedSecretBuffer);
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
