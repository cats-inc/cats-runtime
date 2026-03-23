import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { SessionInfo } from '../backends/cli/pool/types.js';
import {
  resolveProviderTarget,
  type ProviderTargetDescriptor,
} from '../core/providerCatalog.js';

export function resolveSessionProviderTarget(
  config: CliRuntimeConfig,
  session: Pick<SessionInfo, 'providerName' | 'providerBackend' | 'providerInstanceId'>,
): ProviderTargetDescriptor {
  return resolveProviderTarget(
    config,
    session.providerName,
    session.providerBackend && session.providerInstanceId
      ? `${session.providerBackend}/${session.providerInstanceId}`
      : session.providerInstanceId,
  );
}
