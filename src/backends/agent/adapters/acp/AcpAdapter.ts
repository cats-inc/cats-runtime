import type {
  AgentAdapter,
  AgentAdapterInspection,
  AgentBackendOptions,
  AgentInvokeInput,
} from '../../types.js';
import type { StreamEvent } from '../../../../core/types.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';

function resolveEndpoint(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const value = (instance.urlEnv ? env[instance.urlEnv] : undefined)
    || instance.url
    || (instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined)
    || instance.baseUrl;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function buildInspection(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): AgentAdapterInspection {
  const endpoint = resolveEndpoint(instance, env);
  const command = instance.command?.trim() || undefined;
  const transportKind = command ? 'stdio' as const : 'http' as const;
  const launch = command
    ? {
        kind: 'stdio' as const,
        command,
        ...(instance.args?.length ? { args: [...instance.args] } : {}),
        ...(instance.cwd ? { cwd: instance.cwd } : {}),
        ...(instance.startupTimeoutMs ? { startupTimeoutMs: instance.startupTimeoutMs } : {}),
      }
    : undefined;
  const authConfigured = Boolean(
    (instance.authTokenEnv && env[instance.authTokenEnv])
    || (instance.headers && Object.keys(instance.headers).some((key) =>
      key.toLowerCase() === 'authorization')),
  );
  const summary = command
    ? `ACP target '${instance.providerName}/${instance.id}' is configured as a provider-managed stdio agent command and will require a runtime ACP host-capability bridge before turn execution is enabled.`
    : `ACP target '${instance.providerName}/${instance.id}' is configured as a provider-managed ACP transport and will require a runtime ACP host-capability bridge before turn execution is enabled.`;

  return {
    adapter: 'acp',
    family: 'protocol',
    summary,
    ...(endpoint ? { endpoint } : {}),
    ...(launch ? { launch } : {}),
    transport: {
      kind: transportKind,
      protocol: 'acp_v1',
      liveProbe: 'none',
      modelDiscovery: 'none',
      toolDiscovery: 'none',
      streaming: 'generic',
    },
    request: {
      headerNames: Object.keys(instance.headers || {})
        .filter((name) => name !== 'content-type' && name !== 'accept')
        .sort(),
    },
    auth: {
      mechanisms: authConfigured && !command ? ['bearer_header'] : [],
      credentials: [
        ...(endpoint
          ? [{
              kind: 'base_url' as const,
              configured: true,
            }]
          : []),
        ...(instance.authTokenEnv || authConfigured
          ? [{
              kind: 'auth_token' as const,
              configured: authConfigured,
            }]
          : []),
      ],
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
      effectiveToolCatalog: false,
      cancel: false,
      runtimeServices: false,
      toolCallEvents: false,
    },
  };
}

export class AcpAdapter implements AgentAdapter {
  readonly kind = 'acp';

  constructor(private readonly options: AgentBackendOptions = {}) {}

  async *invoke(_input: AgentInvokeInput): AsyncGenerator<StreamEvent> {
    throw new Error(
      'ACP agent transport is configured but turn execution is not implemented yet. '
      + 'Start with PLAN-032 Phase 2 to add the ACP host-capability bridge.',
    );
  }

  inspect(instance: RemoteProviderInstanceConfig): AgentAdapterInspection {
    return buildInspection(instance, this.options.env || process.env);
  }
}
