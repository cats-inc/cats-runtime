import { createDisabledPeerDiscoverySnapshot } from './PeerDiscoveryController.js';
import type { PeerCapabilitySnapshotService } from './PeerCapabilitySnapshotService.js';
import type { PeerDiscoveryController } from './PeerDiscoveryController.js';
import type { PeerRegistry } from './PeerRegistry.js';

interface PeerDiscoverySnapshotInput {
  peerDiscovery?: Pick<PeerDiscoveryController, 'snapshot'>;
  peerCapabilities?: Pick<PeerCapabilitySnapshotService, 'getLocalPeerId'>;
  peerRegistry?: Pick<PeerRegistry, 'summary'>;
}

export function getPeerDiscoverySnapshot(
  input: PeerDiscoverySnapshotInput,
) {
  return input.peerDiscovery?.snapshot()
    || createDisabledPeerDiscoverySnapshot(
      input.peerCapabilities?.getLocalPeerId() || null,
      input.peerRegistry?.summary(),
    );
}
