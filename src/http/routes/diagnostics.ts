import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { Hono } from 'hono';
import { buildAgentAdapter } from '../../backends/agent/adapters/registry.js';
import type { RemoteProviderInstanceConfig } from '../../backends/cli/config.js';
import {
  getConfiguredFileBackedProviderPath,
  resolveFileBackedProviderPath,
  supportsHostFileBackedProviderDiscovery,
} from '../../backends/cli/providerPaths.js';
import {
  getRuntimeListenerConfig,
  getRuntimeResolvedPaths,
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
type FileBackedProviderName = 'auggie' | 'claude' | 'codex' | 'copilot' | 'gemini' | 'pi';

interface DiagnosticCheck {
  code: string;
  status: DiagnosticStatus;
  message: string;
  details?: Record<string, unknown>;
}

const diagnosticsRoutes = new Hono();

function isFileBackedProvider(
  providerName: string,
): providerName is FileBackedProviderName {
  return [
    'auggie',
    'claude',
    'codex',
    'copilot',
    'gemini',
    'pi',
  ].includes(providerName);
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function pathExists(pathValue: string): boolean {
  try {
    accessSync(pathValue, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function lookupCommand(
  command: string,
): { available: boolean; resolvedPath?: string } {
  if (!command.trim()) {
    return { available: false };
  }

  if (isAbsolute(command) || hasPathSeparator(command)) {
    const resolvedPath = isAbsolute(command) ? command : resolve(command);
    return {
      available: pathExists(resolvedPath),
      resolvedPath,
    };
  }

  const lookupCommandName = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(lookupCommandName, [command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const resolvedPath = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return {
    available: result.status === 0 && Boolean(resolvedPath),
    resolvedPath,
  };
}

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
  env: NodeJS.ProcessEnv,
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

function diagnoseCliTarget(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
): { checks: DiagnosticCheck[]; config: Record<string, unknown> } {
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
      const command = lookupCommand(instance.commandConfig.path);
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
      const wsl = lookupCommand('wsl.exe');
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
      const docker = lookupCommand('docker');
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
    const configuredPath = getConfiguredFileBackedProviderPath(
      ctx.config,
      target.providerName,
      target.instanceId,
    );
    config.discoveryPath = {
      configured: configuredPath,
      hostDiscoverySupported: supportsHostFileBackedProviderDiscovery(
        ctx.config,
        target.providerName,
        target.instanceId,
      ),
    };

    if (supportsHostFileBackedProviderDiscovery(ctx.config, target.providerName, target.instanceId)) {
      try {
        const resolvedPath = resolveFileBackedProviderPath(
          ctx.config,
          target.providerName,
          target.instanceId,
        );
        (config.discoveryPath as Record<string, unknown>).resolved = resolvedPath;
        checks.push(
          createCheck(
            'discovery_path_resolved',
            'ok',
            `Resolved host discovery path for ${target.providerName}/${target.instanceId}`,
            {
              configuredPath,
              resolvedPath,
            },
          ),
        );
        checks.push(
          createCheck(
            'discovery_path_exists',
            pathExists(resolvedPath) ? 'ok' : 'degraded',
            pathExists(resolvedPath)
              ? `Discovery path exists for ${target.providerName}/${target.instanceId}`
              : `Discovery path is missing for ${target.providerName}/${target.instanceId}`,
            {
              resolvedPath,
            },
          ),
        );
      } catch (error) {
        checks.push(
          createCheck(
            'discovery_path_invalid',
            'unavailable',
            error instanceof Error ? error.message : String(error),
            {
              configuredPath,
            },
          ),
        );
      }
    } else {
      checks.push(
        createCheck(
          'discovery_path_host_unsupported',
          'degraded',
          `Host-side discovery is not supported for Docker-backed ${target.providerName}/${target.instanceId}`,
          {
            configuredPath,
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

  const env = process.env;
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
    const adapter = buildAgentAdapter(instance);
    if (!adapter.probe) {
      checks.push(
        createCheck(
          'probe_unavailable',
          'degraded',
          `Agent adapter '${adapter.kind}' does not expose a diagnostics probe`,
        ),
      );
      return { checks, config };
    }

    const shouldProbeLive = probeMode === 'live'
      || instance.transport === 'openclaw'
      || instance.transport === 'openclaw_gateway';
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

    const result = await adapter.probe(instance);
    checks.push(
      createCheck(
        'probe',
        result.status,
        result.details || `Probe completed for ${target.providerName}/${target.instanceId}`,
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

  const env = process.env;
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

  if (instance.transport === 'ollama') {
    checks.push(
      createCheck(
        'live_probe_unimplemented',
        'degraded',
        `Transport '${instance.transport}' is configured, but this contract only exposes light diagnostics for ${target.backend} targets`,
      ),
    );
  } else if (!requiresApiKey || (apiKey.name && apiKey.present)) {
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
): Promise<Record<string, unknown>> {
  let result: { checks: DiagnosticCheck[]; config: Record<string, unknown> };
  if (target.backend === 'cli') {
    result = diagnoseCliTarget(ctx, target);
  } else if (target.backend === 'agent') {
    result = await diagnoseAgentTarget(target, probeMode);
  } else {
    result = diagnoseRemoteConfigOnly(target);
  }

  const availability = {
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
  const ctx = c.get('ctx' as never) as AppContext;
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
  const ctx = c.get('ctx' as never) as AppContext;
  const probeMode = c.req.query('probe') === 'live' ? 'live' : 'light';
  const catalog = listProviderCatalog(ctx.config);
  const providers = await Promise.all(
    Object.values(catalog)
      .flatMap((entry) => entry.instances)
      .map((target) => diagnoseTarget(ctx, target, probeMode)),
  );

  const summary = providers.reduce<{
    configuredProviders: number;
    targets: number;
    ok: number;
    degraded: number;
    unavailable: number;
  }>(
    (accumulator, provider) => {
      const status = provider.availability
        && typeof provider.availability === 'object'
        ? (provider.availability as { status?: DiagnosticStatus }).status
        : undefined;
      if (status === 'ok') {
        accumulator.ok += 1;
      } else if (status === 'degraded') {
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
