import type { AgentAdapterInspection } from '../backends/agent/types.js';
import type { ProviderCapabilities } from './types.js';
import type { ProviderTargetDescriptor } from './providerCatalog.js';

export interface ProviderContinuitySummary {
  source: 'runtime_stateful' | 'provider_native' | 'provider_managed';
  summary: string;
  resume: boolean;
  fork: boolean;
  permissions: boolean;
  providerManagedSessions: boolean;
  sessionKey: boolean;
  providerSessionState: boolean;
  remoteCancel: boolean;
}

interface ProviderContinuitySummaryOptions {
  capabilities: ProviderCapabilities;
  agentRuntime?: AgentAdapterInspection;
}

export function buildProviderContinuitySummary(
  target: ProviderTargetDescriptor,
  options: ProviderContinuitySummaryOptions,
): ProviderContinuitySummary {
  if (target.backend === 'api' || target.backend === 'local') {
    return {
      source: 'runtime_stateful',
      summary: `cats-runtime owns the host-visible session lifecycle for ${target.providerName}/${target.instanceId} `
        + 'and persists bounded provider continuation state without relying on a provider-managed remote session.',
      resume: options.capabilities.resume,
      fork: options.capabilities.fork,
      permissions: options.capabilities.permissions,
      providerManagedSessions: false,
      sessionKey: false,
      providerSessionState: true,
      remoteCancel: false,
    };
  }

  if (target.backend === 'agent') {
    const continuity = options.agentRuntime?.continuity;
    return {
      source: 'provider_managed',
      summary: `The external agent runtime owns provider-managed session continuity for `
        + `${target.providerName}/${target.instanceId} while cats-runtime keeps the caller-visible session facade local.`,
      resume: options.capabilities.resume,
      fork: options.capabilities.fork,
      permissions: options.capabilities.permissions,
      providerManagedSessions: continuity?.providerManagedSessions === true,
      sessionKey: continuity?.sessionKey === true,
      providerSessionState: continuity?.providerSessionState === true,
      remoteCancel: continuity?.cancel === true,
    };
  }

  return {
    source: 'provider_native',
    summary: `The CLI provider owns native conversation continuity for ${target.providerName}/${target.instanceId}; `
      + 'cats-runtime can reuse provider-native resume identifiers when supported but does not expose provider-managed remote cancel.',
    resume: options.capabilities.resume,
    fork: options.capabilities.fork,
    permissions: options.capabilities.permissions,
    providerManagedSessions: true,
    sessionKey: false,
    providerSessionState: false,
    remoteCancel: false,
  };
}
