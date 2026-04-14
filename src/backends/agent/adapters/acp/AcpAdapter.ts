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
  hostBridgeConfigured: boolean,
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
  const hostBridgeSummary = hostBridgeConfigured
    ? 'A runtime ACP host-capability bridge is configured for filesystem, terminal, and tool-policy mediation, but ACP session execution is not enabled yet.'
    : 'It will require a runtime ACP host-capability bridge before turn execution is enabled.';
  const summary = command
    ? `ACP target '${instance.providerName}/${instance.id}' is configured as a provider-managed stdio agent command. ${hostBridgeSummary}`
    : `ACP target '${instance.providerName}/${instance.id}' is configured as a provider-managed ACP transport. ${hostBridgeSummary}`;

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
      runtimeServices: hostBridgeConfigured,
      toolCallEvents: false,
    },
  };
}

export class AcpAdapter implements AgentAdapter {
  readonly kind = 'acp';

  constructor(private readonly options: AgentBackendOptions = {}) {}

  async *invoke(_input: AgentInvokeInput): AsyncGenerator<StreamEvent> {
    if (!_input.acpHost) {
      throw new Error(
        'ACP agent transport is configured but no runtime ACP host-capability bridge '
        + 'is attached. Continue with PLAN-032 Phase 2 before enabling turn execution.',
      );
    }

    throw new Error(
      'ACP agent transport is configured and the runtime ACP host-capability bridge is available, '
      + 'but session lifecycle execution is not implemented yet. Continue with PLAN-032 Phase 3 '
      + 'to pilot a concrete ACP provider target.',
    );
  }

  inspect(instance: RemoteProviderInstanceConfig): AgentAdapterInspection {
    return buildInspection(
      instance,
      this.options.env || process.env,
      Boolean(this.options.acpHostBridge),
    );
  }
}
