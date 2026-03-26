import type { RemoteProviderInstanceConfig } from '../cli/config.js';
import { buildAgentAdapter } from './adapters/registry.js';
import type { AgentAdapterInspection, AgentBackendOptions } from './types.js';

function resolveGenericEndpoint(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const value = (instance.urlEnv ? env[instance.urlEnv] : undefined)
    || instance.url
    || (instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined)
    || instance.baseUrl;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function buildGenericInspection(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): AgentAdapterInspection {
  const endpoint = resolveGenericEndpoint(instance, env);
  const transportKind = endpoint?.startsWith('ws://') || endpoint?.startsWith('wss://')
    ? 'websocket'
    : 'http';

  return {
    adapter: instance.transport || 'unknown',
    family: 'generic',
    summary: `Agent target '${instance.providerName}/${instance.id}' uses provider-managed session continuity through the '${instance.transport || 'unknown'}' adapter.`,
    endpoint,
    transport: {
      kind: transportKind,
      protocol: 'generic',
      liveProbe: 'none',
      modelDiscovery: 'none',
      toolDiscovery: 'none',
      streaming: 'generic',
    },
    request: {
      headerNames: [],
    },
    auth: {
      mechanisms: [],
      credentials: [],
    },
    continuity: {
      providerManagedSessions: true,
      sessionKey: true,
      providerSessionState: true,
      cancel: false,
    },
    capabilities: {
      probe: false,
      modelDiscovery: false,
      toolCatalog: false,
      cancel: false,
      runtimeServices: false,
      toolCallEvents: false,
    },
  };
}

export function inspectAgentTarget(
  instance: RemoteProviderInstanceConfig,
  options: AgentBackendOptions = {},
): AgentAdapterInspection {
  const env = options.env || process.env;
  const adapter = buildAgentAdapter(instance, options);
  return adapter.inspect?.(instance) || buildGenericInspection(instance, env);
}
