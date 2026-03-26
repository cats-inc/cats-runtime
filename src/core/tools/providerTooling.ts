import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { RuntimeToolPolicyInspection } from '../types.js';
import { buildToolPolicyInspection } from './LocalToolRuntime.js';

export interface ProviderToolingSummary {
  source: 'runtime_local' | 'provider_native' | 'provider_managed';
  discoverable: boolean;
  sessionScopedOverrides: boolean;
  summary: string;
  policy?: RuntimeToolPolicyInspection;
}

export function buildProviderToolingSummary(
  target: ProviderTargetDescriptor,
): ProviderToolingSummary {
  if (target.backend === 'api' || target.backend === 'local') {
    const policy = buildToolPolicyInspection({
      toolProfile: target.remoteInstance?.toolProfile,
    });

    return {
      source: 'runtime_local',
      discoverable: true,
      sessionScopedOverrides: true,
      summary: `Runtime-managed local tools default to the '${policy.profile}' profile `
        + `(${policy.counts.total} tool(s)) before per-session permission narrowing.`,
      policy,
    };
  }

  if (target.backend === 'agent') {
    return {
      source: 'provider_managed',
      discoverable: false,
      sessionScopedOverrides: false,
      summary: `Tool execution for ${target.providerName}/${target.instanceId} is owned `
        + 'by the external agent runtime; cats-runtime does not enumerate a remote tool catalog.',
    };
  }

  return {
    source: 'provider_native',
    discoverable: false,
    sessionScopedOverrides: false,
    summary: `Tool execution for ${target.providerName}/${target.instanceId} is owned `
      + 'by the CLI provider; cats-runtime does not enumerate provider-native tools.',
  };
}
