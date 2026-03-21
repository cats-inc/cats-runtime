import { Hono } from 'hono';
import type { RemoteProviderInstanceConfig } from '../../backends/cli/config.js';
import {
  getFileBackedProviderDiscoveryInfo,
  getRuntimeEnvironment,
  getRuntimeListenerConfig,
  getRuntimeResolvedPaths,
  isFileBackedProvider,
  lookupRuntimeCommand,
  probeRuntimeAgentInstance,
  runtimePathExists,
} from '../../core/config.js';
import {
  listProviderCatalog,
  type ProviderTargetDescriptor,
} from '../../core/providerCatalog.js';
import type { HealthStatus } from '../../core/types.js';
import type { AppContext } from '../app.js';
import {
  RUNTIME_LIFECYCLE_EVENTS,
  RUNTIME_SERVICE_NAME,
  RUNTIME_VERSION,
  getRuntimeReadinessSnapshot,
} from '../../startup.js';

type DiagnosticStatus = HealthStatus['status'];
type DiagnosticsProbeMode = 'light' | 'live';
type RuntimeRouteEnv = {
  Variables: {
    ctx: AppContext;
  };
};

interface DiagnosticCheck {
  code: string;
  status: DiagnosticStatus;
  message: string;
  details?: Record<string, unknown>;
}

interface ProviderDiagnosticAvailability {
  status: DiagnosticStatus;
  checkedAt: string;
  probe: DiagnosticsProbeMode;
  summary: string;
}

interface ProviderDiagnosticResult {
  provider: string;
  backend: ProviderTargetDescriptor['backend'];
  instance: string;
  target: string;
  defaultTarget: boolean;
  availability: ProviderDiagnosticAvailability;
  config: Record<string, unknown>;
  checks: DiagnosticCheck[];
}

const diagnosticsRoutes = new Hono<RuntimeRouteEnv>();

function combineDiagnosticStatus(checks: DiagnosticCheck[]): DiagnosticStatus {
  if (checks.some((check) => check.status === 'unavailable')) {
    return 'unavailable';
  }
  if (checks.some((check) => check.status === 'degraded')) {
    return 'degraded';
  }
  return 'ok';
}

function pickAvailabilitySummary(checks: DiagnosticCheck[]): string {
  const unavailable = checks.find((check) => check.status === 'unavailable');
  if (unavailable) {
    return unavailable.message;
  }

  const degraded = checks.find((check) => check.status === 'degraded');
  if (degraded) {
    return degraded.message;
  }

  return checks[0]?.message || 'No diagnostics collected';
}

function buildEnvDescriptor(
  env: Readonly<NodeJS.ProcessEnv>,
  envName?: string,
  required = false,
): { name?: string; present: boolean; required: boolean } {
  if (!envName) {
    return {
      present: false,
      required,
    };
  }

  return {
    name: envName,
    present: Boolean(env[envName]),
    required,
  };
}

function getRemoteEndpoint(instance: RemoteProviderInstanceConfig): string | null {
  if (instance.transport === 'openclaw' || instance.transport === 'openclaw_gateway') {
    return instance.url || instance.baseUrl || null;
  }
  if (instance.transport === 'agent_sdk' || instance.transport === 'agent_sdk_bridge') {
    return instance.baseUrl || 'http://127.0.0.1:8082';
  }
  if (instance.transport === 'anthropic') {
    return instance.baseUrl || 'https://api.anthropic.com';
  }
  if (instance.transport === 'openai') {
    return instance.baseUrl || 'https://api.openai.com';
  }
  if (instance.transport === 'google' || instance.transport === 'gemini') {
    return instance.baseUrl || 'https://generativelanguage.googleapis.com';
  }
  if (instance.transport === 'ollama') {
    return instance.baseUrl || 'http://127.0.0.1:11434';
  }
  return instance.baseUrl || instance.url || null;
}

function createCheck(
  code: string,
  status: DiagnosticStatus,
  message: string,
  details?: Record<string, unknown>,
): DiagnosticCheck {
  return { code, status, message, details };
}

async function diagnoseCliTarget(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
): Promise<{ checks: DiagnosticCheck[]; config: Record<string, unknown> }> {
  const instance = target.cliInstance;
  if (!instance) {
    return {
      checks: [
        createCheck(
          'cli_instance_missing',
          'unavailable',
          `CLI target '${target.providerName}/${target.instanceId}' is not initialized`,
        ),
      ],
      config: {},
    };
  }

  const checks: DiagnosticCheck[] = [];
  const runtime = instance.commandConfig.runtime;
  const config: Record<string, unknown> = {
    command: instance.commandConfig.path,
    runner: instance.commandConfig.runner,
    runtime,
  };

  switch (runtime.mode) {
    case 'native': {
      const command = await lookupRuntimeCommand(instance.commandConfig.path);
      checks.push(
        createCheck(
          'command_available',
          command.available ? 'ok' : 'unavailable',
          command.available
            ? `Resolved CLI command '${instance.commandConfig.path}'`
            : `Could not resolve CLI command '${instance.commandConfig.path}'`,
          {
            command: instance.commandConfig.path,
            resolvedPath: command.resolvedPath,
          },
        ),
      );
      break;
    }
    case 'wsl': {
      const wsl = await lookupRuntimeCommand('wsl.exe');
      const distro = runtime.distro || 'Ubuntu';
      checks.push(
        createCheck(
          'wsl_available',
          wsl.available ? 'ok' : 'unavailable',
          wsl.available
            ? `WSL is available for distro '${distro}'`
            : 'WSL is not available on the host PATH',
          {
            distro,
            resolvedPath: wsl.resolvedPath,
          },
        ),
      );
      checks.push(
        createCheck(
          'command_probe_skipped',
          'degraded',
          `WSL-backed command '${instance.commandConfig.path}' is configured but not probed inside '${distro}'`,
        ),
      );
      break;
    }
    case 'docker': {
      const docker = await lookupRuntimeCommand('docker');
      checks.push(
        createCheck(
          'docker_available',
          docker.available ? 'ok' : 'unavailable',
          docker.available
            ? 'Docker is available for runtime-managed provider execution'
            : 'Docker is not available on the host PATH',
          {
            resolvedPath: docker.resolvedPath,
          },
        ),
      );
      checks.push(
        createCheck(
          'command_probe_skipped',
          'degraded',
          `Docker-backed command '${instance.commandConfig.path}' is configured but not probed inside the container runtime`,
        ),
      );
      break;
    }
    default:
      break;
  }

  if (isFileBackedProvider(target.providerName)) {
    try {
      const discoveryPath = getFileBackedProviderDiscoveryInfo(
        ctx.config,
        target.providerName,
        target.instanceId,
      );
      config.discoveryPath = {
        configured: discoveryPath.configuredPath,
        hostDiscoverySupported: discoveryPath.hostDiscoverySupported,
      };

      if (discoveryPath.resolvedPath) {
        const exists = await runtimePathExists(discoveryPath.resolvedPath);
        (config.discoveryPath as Record<string, unknown>).resolved = discoveryPath.resolvedPath;
        checks.push(
          createCheck(
            'discovery_path_resolved',
            'ok',
            `Resolved host discovery path for ${target.providerName}/${target.instanceId}`,
            {
              configuredPath: discoveryPath.configuredPath,
              resolvedPath: discoveryPath.resolvedPath,
            },
          ),
        );
        checks.push(
          createCheck(
            'discovery_path_exists',
            exists ? 'ok' : 'degraded',
            exists
              ? `Discovery path exists for ${target.providerName}/${target.instanceId}`
              : `Discovery path is missing for ${target.providerName}/${target.instanceId}`,
            {
              resolvedPath: discoveryPath.resolvedPath,
            },
          ),
        );
      } else {
        checks.push(
          createCheck(
            'discovery_path_host_unsupported',
            'degraded',
            `Host-side discovery is not supported for Docker-backed ${target.providerName}/${target.instanceId}`,
            {
              configuredPath: discoveryPath.configuredPath,
            },
          ),
        );
      }
    } catch (error) {
      checks.push(
        createCheck(
          'discovery_path_invalid',
          'unavailable',
          error instanceof Error ? error.message : String(error),
          {
            instanceId: target.instanceId,
          },
        ),
      );
    }
  }

  return { checks, config };
}

async function diagnoseAgentTarget(
  target: ProviderTargetDescriptor,
  probeMode: DiagnosticsProbeMode,
  env: Readonly<NodeJS.ProcessEnv>,
): Promise<{ checks: DiagnosticCheck[]; config: Record<string, unknown> }> {
  const instance = target.remoteInstance;
  if (!instance) {
    return {
      checks: [
        createCheck(
          'agent_instance_missing',
          'unavailable',
          `Agent target '${target.providerName}/${target.instanceId}' is not initialized`,
        ),
      ],
      config: {},
    };
  }

  const config: Record<string, unknown> = {
    transport: instance.transport,
    model: instance.model || null,
    endpoint: getRemoteEndpoint(instance),
    credentials: {
      urlEnv: buildEnvDescriptor(env, instance.urlEnv, false),
      baseUrlEnv: buildEnvDescriptor(env, instance.baseUrlEnv, false),
      authTokenEnv: buildEnvDescriptor(env, instance.authTokenEnv, false),
    },
  };
  const checks: DiagnosticCheck[] = [];

  try {
    const shouldProbeLive = probeMode === 'live'
      || instance.transport === 'openclaw'
      || instance.transport === 'openclaw_gateway';
    const probe = await probeRuntimeAgentInstance(instance, shouldProbeLive);
    if (!probe.supported) {
      checks.push(
        createCheck(
          'probe_unavailable',
          'degraded',
          `Agent adapter '${probe.kind}' does not expose a diagnostics probe`,
        ),
      );
      return { checks, config };
    }

    if (!shouldProbeLive) {
      checks.push(
        createCheck(
          'probe_skipped',
          'degraded',
          `Live probe skipped for agent target '${target.providerName}/${target.instanceId}'`,
        ),
      );
      return { checks, config };
    }

    if (!probe.result) {
      checks.push(
        createCheck(
          'probe_unavailable',
          'degraded',
          `Agent adapter '${probe.kind}' did not return probe output`,
        ),
      );
      return { checks, config };
    }

    checks.push(
      createCheck(
        'probe',
        probe.result.status,
        probe.result.details || `Probe completed for ${target.providerName}/${target.instanceId}`,
      ),
    );
  } catch (error) {
    checks.push(
      createCheck(
        'probe_failed',
        'unavailable',
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  return { checks, config };
}

function diagnoseRemoteConfigOnly(
  target: ProviderTargetDescriptor,
  env: Readonly<NodeJS.ProcessEnv>,
): { checks: DiagnosticCheck[]; config: Record<string, unknown> } {
  const instance = target.remoteInstance;
  if (!instance) {
    return {
      checks: [
        createCheck(
          'remote_instance_missing',
          'unavailable',
          `Remote target '${target.providerName}/${target.instanceId}' is not initialized`,
        ),
      ],
      config: {},
    };
  }

  const checks: DiagnosticCheck[] = [];
  const requiresApiKey = instance.transport === 'anthropic'
    || instance.transport === 'openai'
    || instance.transport === 'google'
    || instance.transport === 'gemini';
  const apiKey = buildEnvDescriptor(env, instance.apiKeyEnv, requiresApiKey);

  if (requiresApiKey) {
    checks.push(
      createCheck(
        'api_key_present',
        apiKey.name && apiKey.present ? 'ok' : 'unavailable',
        apiKey.name && apiKey.present
          ? `Required API key env '${apiKey.name}' is set`
          : `Required API key env '${apiKey.name || 'missing'}' is not ready`,
      ),
    );
  }

  if (instance.transport === 'ollama' || !requiresApiKey || (apiKey.name && apiKey.present)) {
    checks.push(
      createCheck(
        'live_probe_unimplemented',
        'degraded',
        `Transport '${instance.transport || 'unknown'}' is configured, but this contract only exposes light diagnostics for ${target.backend} targets`,
      ),
    );
  }

  return {
    checks,
    config: {
      transport: instance.transport,
      model: instance.model || null,
      endpoint: getRemoteEndpoint(instance),
      credentials: {
        apiKeyEnv: apiKey,
        authTokenEnv: buildEnvDescriptor(env, instance.authTokenEnv, false),
      },
    },
  };
}

async function diagnoseTarget(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
  probeMode: DiagnosticsProbeMode,
  env: Readonly<NodeJS.ProcessEnv>,
): Promise<ProviderDiagnosticResult> {
  let result: { checks: DiagnosticCheck[]; config: Record<string, unknown> };
  if (target.backend === 'cli') {
    result = await diagnoseCliTarget(ctx, target);
  } else if (target.backend === 'agent') {
    result = await diagnoseAgentTarget(target, probeMode, env);
  } else {
    result = diagnoseRemoteConfigOnly(target, env);
  }

  const availability: ProviderDiagnosticAvailability = {
    status: combineDiagnosticStatus(result.checks),
    checkedAt: new Date().toISOString(),
    probe: probeMode,
    summary: pickAvailabilitySummary(result.checks),
  };

  return {
    provider: target.providerName,
    backend: target.backend,
    instance: target.instanceId,
    target: `${target.backend}/${target.instanceId}`,
    defaultTarget: target.defaultTarget,
    availability,
    config: result.config,
    checks: result.checks,
  };
}

diagnosticsRoutes.get('/diagnostics/runtime', (c) => {
  const ctx = c.get('ctx');
  const readiness = getRuntimeReadinessSnapshot(ctx.startup);
  const listener = getRuntimeListenerConfig(ctx.config);
  const paths = getRuntimeResolvedPaths(ctx.config);

  return c.json({
    service: RUNTIME_SERVICE_NAME,
    version: RUNTIME_VERSION,
    timestamp: new Date().toISOString(),
    contract: {
      startup: ctx.startup.contractVersion,
      supportedModes: ['standalone', 'app-managed'],
      readinessPath: ctx.startup.readinessPath,
      lifecycleEvents: [...RUNTIME_LIFECYCLE_EVENTS],
    },
    readiness,
    runtime: {
      startup: {
        contractVersion: ctx.startup.contractVersion,
        mode: ctx.startup.mode,
        managedBy: ctx.startup.managedBy,
        phase: ctx.startup.phase,
        readySignal: ctx.startup.readySignal,
        ready: readiness.ready,
        pid: ctx.startup.pid,
        startedAt: ctx.startup.startedAt,
        address: ctx.startup.address,
        shutdownReason: ctx.startup.shutdownReason,
        lastEvent: ctx.startup.lastEvent,
      },
      listener,
      paths,
      process: {
        pid: process.pid,
        ppid: process.ppid,
        platform: process.platform,
        nodeVersion: process.version,
      },
    },
  });
});

diagnosticsRoutes.get('/diagnostics/providers', async (c) => {
  const ctx = c.get('ctx');
  const probeMode = c.req.query('probe') === 'live' ? 'live' : 'light';
  const env = getRuntimeEnvironment();
  const catalog = listProviderCatalog(ctx.config);
  const providers = await Promise.all(
    Object.values(catalog)
      .flatMap((entry) => entry.instances)
      .map((target) => diagnoseTarget(ctx, target, probeMode, env)),
  );

  const summary = providers.reduce<{
    configuredProviders: number;
    targets: number;
    ok: number;
    degraded: number;
    unavailable: number;
  }>(
    (accumulator, provider) => {
      if (provider.availability.status === 'ok') {
        accumulator.ok += 1;
      } else if (provider.availability.status === 'degraded') {
        accumulator.degraded += 1;
      } else {
        accumulator.unavailable += 1;
      }
      return accumulator;
    },
    {
      configuredProviders: Object.keys(catalog).length,
      targets: providers.length,
      ok: 0,
      degraded: 0,
      unavailable: 0,
    },
  );

  return c.json({
    service: RUNTIME_SERVICE_NAME,
    version: RUNTIME_VERSION,
    timestamp: new Date().toISOString(),
    readiness: getRuntimeReadinessSnapshot(ctx.startup),
    summary,
    providers,
  });
});

export { diagnosticsRoutes };
