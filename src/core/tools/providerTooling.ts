import type { ProviderTargetDescriptor } from '../providerCatalog.js';
import type { RuntimeToolPolicyInspection } from '../types.js';
import {
  buildRuntimeToolCatalogInspection,
  buildRuntimeToolCatalogSummary,
  buildToolPolicyInspection,
} from './LocalToolRuntime.js';
import type {
  AgentAdapterInspection,
  AgentAdapterToolCatalog,
  AgentAdapterToolCatalogRequest,
} from '../../backends/agent/types.js';

export interface ProviderRemoteToolCatalog {
  source: 'provider_remote';
  status: 'ready' | 'unavailable';
  method: AgentAdapterToolCatalog['method'];
  summary: string;
  toolCount: number;
  groupCount: number;
  groups: AgentAdapterToolCatalog['groups'];
  tools: AgentAdapterToolCatalog['tools'];
  error?: string;
}

export interface ProviderToolingSummary {
  source: 'runtime_local' | 'provider_native' | 'provider_managed';
  discoverable: boolean;
  sessionScopedOverrides: boolean;
  summary: string;
  policy?: RuntimeToolPolicyInspection;
  profiles?: ProviderLocalToolProfileCatalog;
  catalog?: ProviderLocalToolCatalog | ProviderRemoteToolCatalog;
  observability: {
    catalog: 'runtime_enumerated' | 'provider_remote_enumerated' | 'not_enumerated';
    toolCallEvents: boolean;
    runtimeServices: boolean;
  };
}

export interface ProviderLocalToolProfileCatalog {
  defaultProfile: RuntimeToolPolicyInspection['profile'];
  availableProfiles: Array<{
    profile: 'standard' | 'extended' | 'read_only';
    totalTools: number;
    mutatingTools: number;
    readOnlyCompatibleTools: number;
  }>;
  summary: string;
}

export interface ProviderLocalToolCatalog {
  source: 'runtime_local';
  toolCount: number;
  summary: string;
  tools: Array<{
    name: string;
    domain: RuntimeToolPolicyInspection['capabilities'][number]['domain'];
    mutating: boolean;
    readOnlyCompatible: boolean;
    defaultAccess: 'full_access' | 'blocked';
    profileAccess: {
      standard: 'full_access' | 'blocked';
      extended: 'full_access' | 'blocked';
      read_only: 'full_access' | 'blocked';
    };
  }>;
}

interface ProviderToolingSummaryOptions {
  agentRuntime?: AgentAdapterInspection;
  remoteCatalog?: ProviderRemoteToolCatalog;
}

interface ProviderRemoteToolCatalogLoader {
  listTools(
    target: ProviderTargetDescriptor,
    request?: AgentAdapterToolCatalogRequest,
  ): Promise<AgentAdapterToolCatalog>;
}

interface ProviderRemoteToolCatalogLoadOptions {
  agentRuntime?: AgentAdapterInspection;
  agentBackend?: ProviderRemoteToolCatalogLoader;
  request?: AgentAdapterToolCatalogRequest;
}

export function getProviderRemoteToolDiscoveryMethod(
  agentRuntime?: AgentAdapterInspection,
  request?: AgentAdapterToolCatalogRequest,
): ProviderRemoteToolCatalog['method'] {
  if (request?.scope === 'effective') {
    return 'tools_effective';
  }
  const discovery = agentRuntime?.transport.toolDiscovery;
  if (!discovery || discovery === 'none') {
    return 'tools_catalog';
  }
  if (discovery === 'session_bootstrap') {
    return 'tools_effective';
  }
  return discovery;
}

export function buildProviderRemoteToolCatalog(
  catalog: AgentAdapterToolCatalog,
): ProviderRemoteToolCatalog {
  return {
    source: 'provider_remote',
    status: 'ready',
    method: catalog.method,
    summary: catalog.summary,
    toolCount: catalog.toolCount,
    groupCount: catalog.groupCount,
    groups: catalog.groups,
    tools: catalog.tools,
  };
}

export function buildUnavailableProviderRemoteToolCatalog(
  method: ProviderRemoteToolCatalog['method'],
  error: string,
): ProviderRemoteToolCatalog {
  return {
    source: 'provider_remote',
    status: 'unavailable',
    method,
    summary: `Remote tool catalog could not be loaded: ${error}`,
    toolCount: 0,
    groupCount: 0,
    groups: [],
    tools: [],
    error,
  };
}

export async function loadProviderRemoteToolCatalog(
  target: ProviderTargetDescriptor,
  options: ProviderRemoteToolCatalogLoadOptions = {},
): Promise<ProviderRemoteToolCatalog | undefined> {
  if (target.backend !== 'agent' || options.agentRuntime?.capabilities.toolCatalog !== true) {
    return undefined;
  }

  const method = getProviderRemoteToolDiscoveryMethod(options.agentRuntime, options.request);
  if (options.request?.scope === 'effective') {
    if (!options.request.sessionKey) {
      return buildUnavailableProviderRemoteToolCatalog(
        method,
        'Session-effective remote tool discovery requires a sessionKey.',
      );
    }

    if (options.agentRuntime?.capabilities.effectiveToolCatalog !== true) {
      return buildUnavailableProviderRemoteToolCatalog(
        method,
        `Agent target '${target.providerName}/${target.instanceId}' does not support `
          + 'session-effective remote tool discovery.',
      );
    }
  }

  if (!options.agentBackend) {
    return buildUnavailableProviderRemoteToolCatalog(
      method,
      'Agent backend is not initialized.',
    );
  }

  try {
    return buildProviderRemoteToolCatalog(
      await options.agentBackend.listTools(target, options.request),
    );
  } catch (error) {
    return buildUnavailableProviderRemoteToolCatalog(
      method,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function buildProviderToolingSummary(
  target: ProviderTargetDescriptor,
  options: ProviderToolingSummaryOptions = {},
): ProviderToolingSummary {
  if (target.backend === 'api' || target.backend === 'local') {
    const policy = buildToolPolicyInspection({
      toolProfile: target.remoteInstance?.toolProfile,
    });
    const profiles = buildProviderLocalToolProfileCatalog(policy.profile);
    const catalog = buildProviderLocalToolCatalog(policy.profile);

    return {
      source: 'runtime_local',
      discoverable: true,
      sessionScopedOverrides: true,
      summary: `Runtime-managed local tools default to the '${policy.profile}' profile `
        + `(${policy.counts.total} tool(s)) before per-session permission narrowing.`,
      policy,
      profiles,
      catalog,
      observability: {
        catalog: 'runtime_enumerated',
        toolCallEvents: true,
        runtimeServices: false,
      },
    };
  }

  if (target.backend === 'agent') {
    const remoteCatalogCapable = options.agentRuntime?.capabilities.toolCatalog === true;
    const toolCallEvents = options.agentRuntime?.capabilities.toolCallEvents === true;
    const runtimeServices = options.agentRuntime?.capabilities.runtimeServices === true;
    const effectiveToolCatalog = options.agentRuntime?.capabilities.effectiveToolCatalog === true;
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
    const discoverySummary = remoteCatalogCapable
      ? effectiveToolCatalog
        ? 'The runtime can query a bounded remote tool catalog from the external agent runtime and a session-effective inventory for active sessions.'
        : 'The runtime can query a bounded remote tool catalog from the external agent runtime.'
      : 'cats-runtime does not enumerate a remote tool catalog.';

    return {
      source: 'provider_managed',
      discoverable: remoteCatalogCapable,
      sessionScopedOverrides: false,
      summary: `Tool execution for ${target.providerName}/${target.instanceId} is owned `
        + `by the external agent runtime; ${discoverySummary} ${observationSummary}`,
      ...(options.remoteCatalog ? { catalog: options.remoteCatalog } : {}),
      observability: {
        catalog: remoteCatalogCapable ? 'provider_remote_enumerated' : 'not_enumerated',
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

function buildProviderLocalToolProfileCatalog(
  defaultProfile: RuntimeToolPolicyInspection['profile'],
): ProviderLocalToolProfileCatalog {
  const summary = buildRuntimeToolCatalogSummary();

  return {
    defaultProfile,
    availableProfiles: [
      {
        profile: 'standard',
        totalTools: summary.profiles.standard.totalTools,
        mutatingTools: summary.profiles.standard.mutatingTools,
        readOnlyCompatibleTools: summary.profiles.standard.readOnlyCompatibleTools,
      },
      {
        profile: 'extended',
        totalTools: summary.profiles.extended.totalTools,
        mutatingTools: summary.profiles.extended.mutatingTools,
        readOnlyCompatibleTools: summary.profiles.extended.readOnlyCompatibleTools,
      },
      {
        profile: 'read_only',
        totalTools: summary.profiles.readOnly.totalTools,
        mutatingTools: summary.profiles.readOnly.mutatingTools,
        readOnlyCompatibleTools: summary.profiles.readOnly.readOnlyCompatibleTools,
      },
    ],
    summary: `Runtime-local tooling currently exposes 3 selectable profiles; `
      + `the default target uses '${defaultProfile}'.`,
  };
}

function buildProviderLocalToolCatalog(
  defaultProfile: RuntimeToolPolicyInspection['profile'],
): ProviderLocalToolCatalog {
  const inspection = buildRuntimeToolCatalogInspection();
  const resolvedDefaultProfile = defaultProfile === 'extended' || defaultProfile === 'read_only'
    ? defaultProfile
    : 'standard';

  return {
    source: 'runtime_local',
    toolCount: inspection.toolCount,
    summary: `${inspection.summary} Per-tool defaultAccess reflects the `
      + `'${resolvedDefaultProfile}' profile for this target.`,
    tools: inspection.tools.map((tool) => ({
      name: tool.name,
      domain: tool.domain,
      mutating: tool.mutating,
      readOnlyCompatible: tool.readOnlyCompatible,
      defaultAccess: tool.profileAccess[resolvedDefaultProfile],
      profileAccess: tool.profileAccess,
    })),
  };
}
