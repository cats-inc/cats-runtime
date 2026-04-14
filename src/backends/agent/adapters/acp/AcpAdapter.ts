import type {
  AgentAdapter,
  AgentAdapterInspection,
  AgentAdapterProbeResult,
  AgentBackendOptions,
  AgentInvokeInput,
} from '../../types.js';
import type { StreamEvent } from '../../../../core/types.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import { runCliCommand } from '../../../../core/management/cli.js';
import { buildAcpHelpProbeArgs, resolveAcpProviderProfile } from './profiles.js';

const DEFAULT_ACP_STDIN_PROBE_TIMEOUT_MS = 5_000;

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

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      clean[key] = value;
    }
  }
  return clean;
}

function buildInspection(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
  hostBridgeConfigured: boolean,
): AgentAdapterInspection {
  const endpoint = resolveEndpoint(instance, env);
  const command = instance.command?.trim() || undefined;
  const profile = resolveAcpProviderProfile(instance);
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
  const profileSummary = profile
    ? ` ${profile.label} is the current ACP pilot target because its lifecycle overlaps with an existing runtime seam.`
    : '';
  const summary = command
    ? `ACP target '${instance.providerName}/${instance.id}' is configured as a provider-managed stdio agent command.${profileSummary} ${hostBridgeSummary}`
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
      liveProbe: command ? 'command_help' : 'none',
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
      probe: Boolean(command),
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

  async probe(instance: RemoteProviderInstanceConfig): Promise<AgentAdapterProbeResult> {
    const checkedAt = new Date().toISOString();
    const command = instance.command?.trim();
    const profile = resolveAcpProviderProfile(instance);
    if (!command) {
      return {
        health: {
          status: 'degraded',
          checkedAt,
          details: 'ACP diagnostics probe currently supports stdio agent commands only.',
        },
        checks: [
          {
            code: 'acp_probe_transport_unsupported',
            status: 'degraded',
            message: 'ACP probe skipped because this target is not configured as a stdio command.',
            details: {
              transport: instance.transport || 'unknown',
            },
          },
        ],
      };
    }

    const env = sanitizeEnv(this.options.env || process.env);
    const args = buildAcpHelpProbeArgs(instance, profile);
    const runner = this.options.cliCommandRunner || runCliCommand;
    const result = await runner(command, args, {
      cwd: instance.cwd,
      timeoutMs: instance.startupTimeoutMs ?? DEFAULT_ACP_STDIN_PROBE_TIMEOUT_MS,
      env,
    });
    const commandSummary = [command, ...args].join(' ');
    const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
    const status = !result.timedOut && result.code === 0 ? 'ok' : 'unavailable';

    return {
      health: {
        status,
        checkedAt,
        details: status === 'ok'
          ? `ACP stdio help probe succeeded for '${commandSummary}'.`
          : `ACP stdio help probe failed for '${commandSummary}'.`,
      },
      liveProbe: {
        transport: 'stdio',
        command,
        args,
        ...(profile ? { profile: profile.id, profileLabel: profile.label } : {}),
        exitCode: result.code,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        hasOutput: combinedOutput.length > 0,
      },
      checks: [
        {
          code: 'acp_help_probe_exit',
          status,
          message: status === 'ok'
            ? 'ACP stdio command accepted the help probe.'
            : 'ACP stdio command did not complete the help probe successfully.',
          details: {
            command: commandSummary,
            exitCode: result.code,
            timedOut: result.timedOut,
            durationMs: result.durationMs,
          },
        },
        {
          code: 'acp_target_profile',
          status: profile ? 'ok' : 'degraded',
          message: profile
            ? `Resolved ACP target profile '${profile.label}'.`
            : 'ACP target is using the generic stdio profile with no runtime-owned pilot hints.',
          details: profile
            ? {
                profile: profile.id,
                label: profile.label,
                family: profile.family,
              }
            : {
                provider: instance.providerName,
              },
        },
      ],
    };
  }

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
