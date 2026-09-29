import type { AgentAdapterInspection } from '../backends/agent/types.js';
import type { ProviderCapabilities } from './types.js';
import type { ProviderTargetDescriptor } from './providerCatalog.js';

export interface ProviderContinuitySummary {
  source: 'runtime_stateful' | 'provider_native' | 'provider_managed';
  summary: string;
  resume: boolean;
  fork: boolean;
  permissions: boolean;
  /** Target accepts SPEC-035 per-session `mcpServers` (a supporting CLI adapter in a native runtime). */
  sessionMcpServers: boolean;
  providerManagedSessions: boolean;
  sessionKey: boolean;
  providerSessionState: boolean;
  remoteCancel: boolean;
}

interface ProviderContinuitySummaryOptions {
  capabilities: ProviderCapabilities;
  agentRuntime?: AgentAdapterInspection;
}

/**
 * Whether Runtime delivers SPEC-035 session MCP servers for a target. This mirrors the
 * gate that session create, resume and send apply: only a CLI adapter that declares
 * support, running in a native runtime, receives the set.
 */
export function targetSupportsSessionMcpServers(
  target: Pick<ProviderTargetDescriptor, 'backend' | 'cliInstance'>,
  capabilities: Pick<ProviderCapabilities, 'sessionMcpServers'>,
): boolean {
  return target.backend === 'cli'
    && target.cliInstance?.commandConfig.runtime.mode === 'native'
    && capabilities.sessionMcpServers === true;
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
      sessionMcpServers: false,
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
      sessionMcpServers: false,
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
    sessionMcpServers: targetSupportsSessionMcpServers(target, options.capabilities),
    providerManagedSessions: true,
    sessionKey: false,
    providerSessionState: false,
    remoteCancel: false,
  };
}
