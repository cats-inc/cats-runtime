import { Hono } from 'hono';
import type { RemoteProviderInstanceConfig } from '../../backends/cli/config.js';
import {
  getRuntimeListenerConfig,
  getRuntimeResolvedPaths,
} from '../../core/config.js';
import {
  listProviderCatalog,
  type ProviderTargetDescriptor,
} from '../../core/providerCatalog.js';
import { toCompatibilitySummaryView } from '../../core/compatibility/ProviderCompatibilityService.js';
import type { CompatibilitySummaryView } from '../../core/compatibility/types.js';
import type { HealthStatus } from '../../core/types.js';
import type { AppContext } from '../app.js';
import { getProviderCompatibilityService, getRuntimeMeteringService } from '../app.js';
import {
  getFileBackedProviderDiscoveryInfo,
  getRuntimeEnvironment,
  isFileBackedProvider,
  probeRuntimeAgentInstance,
  runtimePathExists,
  type RuntimeRouteEnv,
} from './diagnosticsSupport.js';
import {
  RUNTIME_SERVICE_NAME,
  RUNTIME_VERSION,
  getRuntimeLifecycleContract,
  getRuntimeOperationalStatus,
  getRuntimeReadinessSnapshot,
  getRuntimeShutdownContract,
} from '../../startup.js';

type DiagnosticStatus = HealthStatus['status'];
type DiagnosticsProbeMode = 'light' | 'live';

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
  compatibility?: CompatibilitySummaryView;
}

const diagnosticsRoutes = new Hono<RuntimeRouteEnv>();

interface ProviderSummaryOptions {
  defaultTargetsOnly?: boolean;
  useAttentionSummary?: boolean;
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
  forceRefresh = false,
): Promise<{
    checks: DiagnosticCheck[];
    config: Record<string, unknown>;
    compatibility: CompatibilitySummaryView;
  }> {
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
      compatibility: {
        classification: 'probe_failed',
        status: 'unavailable',
        summary: `CLI target '${target.providerName}/${target.instanceId}' is not initialized`,
        checkedAt: new Date().toISOString(),
        profile: {
          id: 'missing-cli-instance',
          label: 'Missing CLI instance',
          protocolFamily: 'unknown',
          parserId: 'none',
          confidence: 'weak',
        },
        fingerprint: {
          version: {
            source: 'unknown',
            detected: false,
          },
          features: [],
          runtime: {
            mode: 'native',
          },
        },
        warnings: [
          `CLI target '${target.providerName}/${target.instanceId}' is not initialized`,
        ],
      },
    };
  }

  const assessment = await getProviderCompatibilityService(ctx).assessCliTarget(target, {
    force: forceRefresh,
    purpose: 'diagnostics',
  });
  const checks: DiagnosticCheck[] = assessment.checks.map((check) => ({
    ...check,
  }));
  const runtime = instance.commandConfig.runtime;
  const config: Record<string, unknown> = {
    command: instance.commandConfig.path,
    runner: instance.commandConfig.runner,
    runtime,
    compatibility: toCompatibilitySummaryView(assessment),
  };

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

  return {
    checks,
    config,
    compatibility: toCompatibilitySummaryView(assessment),
  };
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
): { checks: DiagnosticCheck[]; config: Record<string, unknown>; compatibility?: CompatibilitySummaryView } {
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
  forceRefresh = false,
): Promise<ProviderDiagnosticResult> {
  let result: {
    checks: DiagnosticCheck[];
    config: Record<string, unknown>;
    compatibility?: CompatibilitySummaryView;
  };
  if (target.backend === 'cli') {
    result = await diagnoseCliTarget(ctx, target, forceRefresh);
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
    compatibility: result.compatibility,
  };
}

function getRuntimeStartupDetails(
  ctx: AppContext,
  readiness = getRuntimeReadinessSnapshot(ctx.startup),
) {
  return {
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
  };
}

async function collectProviderDiagnostics(
  ctx: AppContext,
  probeMode: DiagnosticsProbeMode,
  env: Readonly<NodeJS.ProcessEnv>,
  forceRefresh = false,
): Promise<{
  catalog: ReturnType<typeof listProviderCatalog>;
  providers: ProviderDiagnosticResult[];
}> {
  const catalog = listProviderCatalog(ctx.config);
  const providers = await Promise.all(
    Object.values(catalog)
      .flatMap((entry) => entry.instances)
      .map((target) => diagnoseTarget(ctx, target, probeMode, env, forceRefresh)),
  );

  return {
    catalog,
    providers,
  };
}

function summarizeProviderDiagnostics(
  catalog: ReturnType<typeof listProviderCatalog>,
  providers: ProviderDiagnosticResult[],
  options: ProviderSummaryOptions = {},
) {
  const selectedProviders = options.defaultTargetsOnly
    ? providers.filter((provider) => provider.defaultTarget)
    : providers;
  const defaultTargets = providers.filter((provider) => provider.defaultTarget).length;
  const summary = selectedProviders.reduce<{
    status: DiagnosticStatus;
    summary: string;
    configuredProviders: number;
    targets: number;
    defaultTargets: number;
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
      status: 'ok',
      summary: 'All configured provider targets passed the current probe mode.',
      configuredProviders: Object.keys(catalog).length,
      targets: selectedProviders.length,
      defaultTargets: options.defaultTargetsOnly ? selectedProviders.length : defaultTargets,
      ok: 0,
      degraded: 0,
      unavailable: 0,
    },
  );

  if (summary.configuredProviders === 0 || summary.targets === 0) {
    summary.status = 'degraded';
    summary.summary = options.defaultTargetsOnly
      ? 'No default provider targets are configured yet.'
      : 'No provider targets are configured yet.';
    return summary;
  }

  const attentionCount = summary.degraded + summary.unavailable;
  if (attentionCount === 0) {
    return summary;
  }

  const allUnavailable = summary.unavailable === summary.targets;
  summary.status = allUnavailable ? 'unavailable' : 'degraded';

  if (options.useAttentionSummary && !allUnavailable) {
    summary.summary = `${attentionCount} provider target(s) need attention.`;
    return summary;
  }

  if (summary.unavailable > 0) {
    summary.summary = `${summary.unavailable} provider target(s) are unavailable.`;
    return summary;
  }

  if (summary.degraded > 0) {
    summary.summary = `${summary.degraded} provider target(s) need attention.`;
    return summary;
  }

  return summary;
}

diagnosticsRoutes.get('/diagnostics/runtime', (c) => {
  const ctx = c.get('ctx');
  const readiness = getRuntimeReadinessSnapshot(ctx.startup);
  const listener = getRuntimeListenerConfig(ctx.config);
  const paths = getRuntimeResolvedPaths(ctx.config);
  const runtime = getRuntimeOperationalStatus(ctx.startup);
  const metering = getRuntimeMeteringService(ctx).buildSnapshot(ctx.registry.list());

  return c.json({
    service: RUNTIME_SERVICE_NAME,
    version: RUNTIME_VERSION,
    timestamp: new Date().toISOString(),
    status: runtime.status,
    summary: runtime.summary,
    contract: getRuntimeLifecycleContract(ctx.startup),
    readiness,
    runtime: {
      startup: getRuntimeStartupDetails(ctx, readiness),
      shutdown: getRuntimeShutdownContract(ctx.startup),
      listener,
      paths,
      process: {
        pid: process.pid,
        ppid: process.ppid,
        platform: process.platform,
        nodeVersion: process.version,
      },
    },
    metering,
  });
});

diagnosticsRoutes.get('/diagnostics/providers', async (c) => {
  const ctx = c.get('ctx');
  const probeMode = c.req.query('probe') === 'live' ? 'live' : 'light';
  const forceRefresh = parseForceRefreshQuery(c.req.query('force'));
  const env = getRuntimeEnvironment();
  const { catalog, providers } = await collectProviderDiagnostics(
    ctx,
    probeMode,
    env,
    forceRefresh,
  );
  const summary = summarizeProviderDiagnostics(catalog, providers);

  return c.json({
    service: RUNTIME_SERVICE_NAME,
    version: RUNTIME_VERSION,
    timestamp: new Date().toISOString(),
    probe: probeMode,
    readiness: getRuntimeReadinessSnapshot(ctx.startup),
    summary,
    providers,
  });
});

diagnosticsRoutes.get('/diagnostics/health', async (c) => {
  const ctx = c.get('ctx');
  const probeMode = c.req.query('probe') === 'live' ? 'live' : 'light';
  const forceRefresh = parseForceRefreshQuery(c.req.query('force'));
  const env = getRuntimeEnvironment();
  const readiness = getRuntimeReadinessSnapshot(ctx.startup);
  const runtime = getRuntimeOperationalStatus(ctx.startup);
  const metering = getRuntimeMeteringService(ctx).buildSummary(ctx.registry.list());
  const { catalog, providers } = await collectProviderDiagnostics(
    ctx,
    probeMode,
    env,
    forceRefresh,
  );
  const providerSummary = summarizeProviderDiagnostics(catalog, providers, {
    defaultTargetsOnly: true,
    useAttentionSummary: true,
  });
  const status = providerSummary.status === 'unavailable'
    ? 'unavailable'
    : runtime.status === 'unavailable'
      ? 'unavailable'
      : providerSummary.status === 'degraded' || runtime.status === 'degraded'
        ? 'degraded'
        : 'ok';

  return c.json({
    service: RUNTIME_SERVICE_NAME,
    version: RUNTIME_VERSION,
    timestamp: new Date().toISOString(),
    status,
    contract: getRuntimeLifecycleContract(ctx.startup),
    readiness,
    runtime: {
      status: runtime.status,
      summary: runtime.summary,
      startup: getRuntimeStartupDetails(ctx, readiness),
      shutdown: getRuntimeShutdownContract(ctx.startup),
    },
    providers: {
      probe: probeMode,
      summary: providerSummary,
      defaults: providers
        .filter((provider) => provider.defaultTarget)
        .map((provider) => ({
          provider: provider.provider,
          backend: provider.backend,
          instance: provider.instance,
          target: provider.target,
          status: provider.availability.status,
          summary: provider.availability.summary,
        })),
    },
    metering,
  });
});

export { diagnosticsRoutes };

function parseForceRefreshQuery(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'refresh';
}
