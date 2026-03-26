import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { RuntimeToolPolicyInspection } from '../types.js';
import { buildToolPolicyInspection } from './LocalToolRuntime.js';
import type { AgentAdapterInspection } from '../../backends/agent/types.js';

export interface ProviderToolingSummary {
  source: 'runtime_local' | 'provider_native' | 'provider_managed';
  discoverable: boolean;
  sessionScopedOverrides: boolean;
  summary: string;
  policy?: RuntimeToolPolicyInspection;
  observability: {
    catalog: 'runtime_enumerated' | 'not_enumerated';
    toolCallEvents: boolean;
    runtimeServices: boolean;
  };
}

interface ProviderToolingSummaryOptions {
  agentRuntime?: AgentAdapterInspection;
}

export function buildProviderToolingSummary(
  target: ProviderTargetDescriptor,
  options: ProviderToolingSummaryOptions = {},
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
      observability: {
        catalog: 'runtime_enumerated',
        toolCallEvents: true,
        runtimeServices: false,
      },
    };
  }

  if (target.backend === 'agent') {
    const toolCallEvents = options.agentRuntime?.capabilities.toolCallEvents === true;
    const runtimeServices = options.agentRuntime?.capabilities.runtimeServices === true;
    const observationSummary = (() => {
      if (toolCallEvents && runtimeServices) {
        return 'The runtime can still observe remote tool-call events and runtime service updates.';
      }
      if (toolCallEvents) {
        return 'The runtime can still observe remote tool-call events.';
      }
      if (runtimeServices) {
        return 'The runtime can still observe runtime service updates.';
      }
      return 'The runtime currently does not expose bounded remote tool-call or service-update observation.';
    })();

    return {
      source: 'provider_managed',
      discoverable: false,
      sessionScopedOverrides: false,
      summary: `Tool execution for ${target.providerName}/${target.instanceId} is owned `
        + 'by the external agent runtime; cats-runtime does not enumerate a remote tool catalog. '
        + observationSummary,
      observability: {
        catalog: 'not_enumerated',
        toolCallEvents,
        runtimeServices,
      },
    };
  }

  return {
    source: 'provider_native',
    discoverable: false,
    sessionScopedOverrides: false,
    summary: `Tool execution for ${target.providerName}/${target.instanceId} is owned `
      + 'by the CLI provider; cats-runtime does not enumerate provider-native tools.',
    observability: {
      catalog: 'not_enumerated',
      toolCallEvents: false,
      runtimeServices: false,
    },
  };
}
