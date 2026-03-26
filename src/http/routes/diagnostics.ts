import { Hono } from 'hono';
import type { BackendKind, RemoteProviderInstanceConfig } from '../../backends/cli/config.js';
import {
  getRuntimeListenerConfig,
  getRuntimeResolvedPaths,
} from '../../core/config.js';
import { getPeerDiscoverySnapshot } from '../../core/peers/discoverySnapshot.js';
import {
  listProviderCatalog,
  type ProviderTargetDescriptor,
} from '../../core/providerCatalog.js';
import { inspectProviderActiveConfig } from '../../core/providerActiveConfig.js';
import { toCompatibilitySummaryView } from '../../core/compatibility/ProviderCompatibilityService.js';
import type { CompatibilitySummaryView } from '../../core/compatibility/types.js';
import type { ProviderSetupSummary } from '../../core/provider-install/types.js';
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
  getPeerNetworkPostureSnapshot,
  buildPeerNetworkPostureSummary,
} from './peerNetworkDiagnostics.js';
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
const DIAGNOSTIC_BACKENDS: readonly BackendKind[] = ['cli', 'api', 'local', 'agent'];
const DEFAULT_REMOTE_ENDPOINT_PROBE_TIMEOUT_MS = 5_000;

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
  attentionCodes: string[];
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
  setup?: ProviderSetupSummary;
  compatibility?: CompatibilitySummaryView;
  reprobe: {
    forceSupported: boolean;
    liveSupported: boolean;
  };
}

const diagnosticsRoutes = new Hono<RuntimeRouteEnv>();

interface ProviderSummaryOptions {
  defaultTargetsOnly?: boolean;
  useAttentionSummary?: boolean;
  queryHasFilters?: boolean;
}

interface ProviderDiagnosticsFilters {
  provider?: string;
  backend?: BackendKind;
  instance?: string;
  defaultOnly: boolean;
}

class DiagnosticsQueryError extends Error {}

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

async function appendModelCatalogDiagnostics(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
  checks: DiagnosticCheck[],
  config: Record<string, unknown>,
): Promise<void> {
  try {
    const catalog = await ctx.providerModelCatalog.getCatalog(
      target.providerName,
      `${target.backend}/${target.instanceId}`,
    );
    config.modelCatalog = {
      source: catalog.source,
      defaultModel: catalog.defaultModel,
      modelCount: catalog.models.length,
      warnings: [...catalog.warnings],
      ...(catalog.cache ? { cache: catalog.cache } : {}),
    };

    checks.push(
      createCheck(
        'model_catalog_loaded',
        catalog.models.length > 0 ? 'ok' : 'degraded',
        catalog.models.length > 0
          ? `Loaded ${catalog.models.length} model(s) for ${target.providerName}/${target.instanceId}`
          : `Model catalog is empty for ${target.providerName}/${target.instanceId}`,
        {
          source: catalog.source,
          modelCount: catalog.models.length,
          ...(catalog.defaultModel ? { defaultModel: catalog.defaultModel } : {}),
        },
      ),
    );

    if (catalog.warnings.length > 0) {
      checks.push(
        createCheck(
          'model_catalog_warning',
          'degraded',
          catalog.warnings[0] || `Model catalog warnings were reported for ${target.providerName}/${target.instanceId}`,
          {
            warnings: [...catalog.warnings],
          },
        ),
      );
    }

    const configuredModel = target.remoteInstance?.model;
    const shouldValidateConfiguredModel = Boolean(
      configuredModel
      && (
        target.backend === 'agent'
        || target.remoteInstance?.transport === 'ollama'
        || catalog.source === 'dynamic'
      ),
    );
    if (!configuredModel || !shouldValidateConfiguredModel) {
      return;
    }

    const configuredModelWarning = catalog.warnings.find((warning) =>
      warning.includes(configuredModel) && warning.includes('added as configured fallback'),
    );
    if (configuredModelWarning) {
      checks.push(
        createCheck(
          'configured_model_fallback_only',
          'degraded',
          configuredModelWarning,
          {
            model: configuredModel,
            source: catalog.source,
          },
        ),
      );
      return;
    }

    const configuredModelEntry = catalog.models.find((entry) => entry.id === configuredModel);
    checks.push(
      createCheck(
        configuredModelEntry ? 'configured_model_present' : 'configured_model_missing',
        configuredModelEntry ? 'ok' : 'degraded',
        configuredModelEntry
          ? `Configured model '${configuredModel}' is present in the ${catalog.source} catalog`
          : `Configured model '${configuredModel}' is missing from the ${catalog.source} catalog`,
        {
          model: configuredModel,
          source: catalog.source,
          ...(configuredModelEntry?.status ? { status: configuredModelEntry.status } : {}),
        },
      ),
    );
  } catch (error) {
    checks.push(
      createCheck(
        'model_catalog_probe_failed',
        'degraded',
        error instanceof Error ? error.message : String(error),
      ),
    );
  }
}

async function diagnoseCliTarget(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
  probeMode: DiagnosticsProbeMode,
  forceRefresh = false,
): Promise<{
    checks: DiagnosticCheck[];
    config: Record<string, unknown>;
    setup?: ProviderSetupSummary;
    compatibility: CompatibilitySummaryView;
  }> {
  const instance = target.cliInstance;
  if (!instance) {
    const checkedAt = new Date().toISOString();
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
        checkedAt,
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
        attentionCodes: ['cli_instance_missing'],
        probe: {
          mode: probeMode,
          supportsLive: false,
          liveValidated: false,
        },
        cache: {
          hit: false,
          stale: true,
          ttlMs: 0,
          ageMs: 0,
          freshUntil: checkedAt,
        },
      },
    };
  }

  const assessment = await getProviderCompatibilityService(ctx).assessCliTarget(target, {
    force: forceRefresh,
    purpose: 'diagnostics',
    probeMode,
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
  const activeConfig = inspectProviderActiveConfig(target);
  if (activeConfig) {
    config.activeConfig = activeConfig;
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

  return {
    checks,
    config,
    setup: assessment.setup,
    compatibility: toCompatibilitySummaryView(assessment),
  };
}

async function diagnoseAgentTarget(
  ctx: AppContext,
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

  if (probeMode === 'live') {
    await appendModelCatalogDiagnostics(ctx, target, checks, config);
  }

  return { checks, config };
}

async function diagnoseRemoteConfigOnly(
  ctx: AppContext,
  target: ProviderTargetDescriptor,
  probeMode: DiagnosticsProbeMode,
  env: Readonly<NodeJS.ProcessEnv>,
): Promise<{ checks: DiagnosticCheck[]; config: Record<string, unknown>; compatibility?: CompatibilitySummaryView }> {
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
  const endpoint = getRemoteEndpoint(instance);
  const requiresApiKey = instance.transport === 'anthropic'
    || instance.transport === 'openai'
    || instance.transport === 'google'
    || instance.transport === 'gemini';
  const apiKey = buildEnvDescriptor(env, instance.apiKeyEnv, requiresApiKey);
  const config: Record<string, unknown> = {
    transport: instance.transport,
    model: instance.model || null,
    endpoint,
    credentials: {
      apiKeyEnv: apiKey,
      authTokenEnv: buildEnvDescriptor(env, instance.authTokenEnv, false),
    },
  };

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

  if (probeMode === 'live' && endpoint) {
    const liveProbe = await probeRemoteEndpoint(endpoint, instance.transport);
    config.liveProbe = {
      url: liveProbe.url,
      method: 'GET',
      reachable: liveProbe.reachable,
      ...(liveProbe.statusCode !== undefined ? { statusCode: liveProbe.statusCode } : {}),
      latencyMs: liveProbe.latencyMs,
      ...(liveProbe.timedOut ? { timedOut: true } : {}),
    };
    checks.push(
      createCheck(
        liveProbe.reachable ? 'endpoint_reachable' : 'endpoint_probe_failed',
        liveProbe.reachable ? 'ok' : 'unavailable',
        liveProbe.reachable
          ? `Live probe reached ${target.providerName}/${target.instanceId} endpoint`
          : liveProbe.message,
        {
          url: liveProbe.url,
          ...(liveProbe.statusCode !== undefined ? { statusCode: liveProbe.statusCode } : {}),
          latencyMs: liveProbe.latencyMs,
          ...(liveProbe.timedOut ? { timedOut: true } : {}),
        },
      ),
    );
  } else if (instance.transport === 'ollama' || !requiresApiKey || (apiKey.name && apiKey.present)) {
    checks.push(
      createCheck(
        'live_probe_unimplemented',
        'degraded',
        `Transport '${instance.transport || 'unknown'}' is configured, but this contract only exposes light diagnostics for ${target.backend} targets`,
      ),
    );
  }

  if (probeMode === 'live') {
    await appendModelCatalogDiagnostics(ctx, target, checks, config);
  }

  return {
    checks,
    config,
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
    setup?: ProviderSetupSummary;
    compatibility?: CompatibilitySummaryView;
  };
  if (target.backend === 'cli') {
    result = await diagnoseCliTarget(ctx, target, probeMode, forceRefresh);
  } else if (target.backend === 'agent') {
    result = await diagnoseAgentTarget(ctx, target, probeMode, env);
  } else {
    result = await diagnoseRemoteConfigOnly(ctx, target, probeMode, env);
  }

  const attentionCodes = result.checks
    .filter((check) => check.status !== 'ok')
    .map((check) => check.code);

  const availability: ProviderDiagnosticAvailability = {
    status: combineDiagnosticStatus(result.checks),
    checkedAt: new Date().toISOString(),
    probe: probeMode,
    summary: pickAvailabilitySummary(result.checks),
    attentionCodes,
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
    setup: result.setup,
    compatibility: result.compatibility,
    reprobe: {
      forceSupported: target.backend === 'cli',
      liveSupported: target.backend === 'cli'
        ? Boolean(result.compatibility?.probe.supportsLive)
        : target.backend === 'agent'
          || Boolean(target.remoteInstance && getRemoteEndpoint(target.remoteInstance)),
    },
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
  filters: ProviderDiagnosticsFilters = { defaultOnly: false },
): Promise<{
  catalog: ReturnType<typeof listProviderCatalog>;
  providers: ProviderDiagnosticResult[];
}> {
  const fullCatalog = listProviderCatalog(ctx.config);
  const catalog = filterProviderDiagnosticsCatalog(fullCatalog, filters);
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
    summary.summary = options.queryHasFilters
      ? 'No provider targets matched the requested diagnostics filters.'
      : options.defaultTargetsOnly
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
  const peers = getPeerDiscoverySnapshot(ctx);

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
      maintenance: {
        ...(ctx.worktreeMaintenance ? { worktrees: ctx.worktreeMaintenance.snapshot() } : {}),
        ...(ctx.browserMaintenance ? { browser: ctx.browserMaintenance.snapshot() } : {}),
      },
      process: {
        pid: process.pid,
        ppid: process.ppid,
        platform: process.platform,
        nodeVersion: process.version,
      },
      peers: {
        ...peers,
        network: buildPeerNetworkPostureSummary(ctx).network,
      },
    },
    metering,
  });
});

diagnosticsRoutes.get('/diagnostics/peers', (c) => {
  try {
    const ctx = c.get('ctx');
    const includeStale = parseOptionalBooleanQuery(c.req.query('includeStale')) === true;
    const discovery = getPeerDiscoverySnapshot(ctx);
    const peers = ctx.peerRegistry?.list({ includeStale }) || [];

    return c.json({
      service: RUNTIME_SERVICE_NAME,
      version: RUNTIME_VERSION,
      timestamp: new Date().toISOString(),
      readiness: getRuntimeReadinessSnapshot(ctx.startup),
      query: {
        includeStale,
      },
      discovery,
      summary: discovery.registry,
      ...buildPeerGuardrailDiagnostics(ctx),
      network: getPeerNetworkPostureSnapshot(ctx, includeStale),
      peers,
    });
  } catch (error) {
    if (error instanceof DiagnosticsQueryError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

diagnosticsRoutes.get('/diagnostics/providers', async (c) => {
  try {
    const ctx = c.get('ctx');
    const probeMode = c.req.query('probe') === 'live' ? 'live' : 'light';
    const forceRefresh = parseForceRefreshQuery(c.req.query('force'));
    const filters = parseProviderDiagnosticsFilters(c.req.query());
    const env = getRuntimeEnvironment();
    const { catalog, providers } = await collectProviderDiagnostics(
      ctx,
      probeMode,
      env,
      forceRefresh,
      filters,
    );
    const summary = summarizeProviderDiagnostics(catalog, providers, {
      queryHasFilters: hasProviderDiagnosticsFilters(filters),
    });

    return c.json({
      service: RUNTIME_SERVICE_NAME,
      version: RUNTIME_VERSION,
      timestamp: new Date().toISOString(),
      probe: probeMode,
      query: buildProviderDiagnosticsQuery(filters),
      readiness: getRuntimeReadinessSnapshot(ctx.startup),
      summary,
      providers,
    });
  } catch (error) {
    if (error instanceof DiagnosticsQueryError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
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
  const peers = getPeerDiscoverySnapshot(ctx);
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
    peers,
    metering,
  });
});

export { diagnosticsRoutes };

function parseForceRefreshQuery(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'refresh';
}

function parseProviderDiagnosticsFilters(
  query: Record<string, string | undefined>,
): ProviderDiagnosticsFilters {
  const provider = parseOptionalQueryString(query.provider);
  const backend = parseOptionalBackend(query.backend);
  const instance = parseOptionalQueryString(query.instance);

  return {
    ...(provider ? { provider } : {}),
    ...(backend ? { backend } : {}),
    ...(instance ? { instance } : {}),
    defaultOnly: parseOptionalBooleanQuery(query.defaultOnly) === true,
  };
}

function parseOptionalQueryString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalBackend(value: string | undefined): BackendKind | undefined {
  const backend = parseOptionalQueryString(value);
  if (!backend) {
    return undefined;
  }
  if ((DIAGNOSTIC_BACKENDS as readonly string[]).includes(backend)) {
    return backend as BackendKind;
  }
  throw new DiagnosticsQueryError(`Unsupported provider diagnostics backend '${backend}'.`);
}

function parseOptionalBooleanQuery(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === '1' || value === 'true') {
    return true;
  }
  if (value === '0' || value === 'false') {
    return false;
  }
  throw new DiagnosticsQueryError(`Invalid boolean query value '${value}'.`);
}

function hasProviderDiagnosticsFilters(filters: ProviderDiagnosticsFilters): boolean {
  return Boolean(
    filters.provider
    || filters.backend
    || filters.instance
    || filters.defaultOnly,
  );
}

function buildProviderDiagnosticsQuery(filters: ProviderDiagnosticsFilters) {
  const appliedFilters = {
    ...(filters.provider ? { provider: filters.provider } : {}),
    ...(filters.backend ? { backend: filters.backend } : {}),
    ...(filters.instance ? { instance: filters.instance } : {}),
    ...(filters.defaultOnly ? { defaultOnly: true } : {}),
  };

  return {
    hasFilters: Object.keys(appliedFilters).length > 0,
    filters: appliedFilters,
  };
}

function filterProviderDiagnosticsCatalog(
  catalog: ReturnType<typeof listProviderCatalog>,
  filters: ProviderDiagnosticsFilters,
): ReturnType<typeof listProviderCatalog> {
  return Object.entries(catalog).reduce<ReturnType<typeof listProviderCatalog>>(
    (filteredCatalog, [providerName, entry]) => {
      const instances = entry.instances.filter((target) => {
        if (filters.provider && target.providerName !== filters.provider) {
          return false;
        }
        if (filters.backend && target.backend !== filters.backend) {
          return false;
        }
        if (filters.instance && target.instanceId !== filters.instance) {
          return false;
        }
        if (filters.defaultOnly && !target.defaultTarget) {
          return false;
        }
        return true;
      });
      if (instances.length === 0) {
        return filteredCatalog;
      }

      filteredCatalog[providerName] = {
        ...entry,
        instances,
      };
      return filteredCatalog;
    },
    {},
  );
}

function buildPeerGuardrailDiagnostics(
  ctx: AppContext,
): { guardrails?: Record<string, unknown> } {
  const guardrails = {
    ...(ctx.peerExecutionAdmission ? ctx.peerExecutionAdmission.snapshot() : {}),
    ...(ctx.peerExecutionReplay ? { replay: ctx.peerExecutionReplay.snapshot() } : {}),
  };

  return Object.keys(guardrails).length > 0 ? { guardrails } : {};
}

async function probeRemoteEndpoint(
  endpoint: string,
  transport: string | undefined,
): Promise<{
    url: string;
    reachable: boolean;
    statusCode?: number;
    latencyMs: number;
    timedOut: boolean;
    message: string;
  }> {
  const url = resolveRemoteProbeUrl(endpoint, transport);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REMOTE_ENDPOINT_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    return {
      url,
      reachable: true,
      statusCode: response.status,
      latencyMs,
      timedOut: false,
      message: `Live probe reached '${url}' (HTTP ${response.status}).`,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    const latencyMs = Date.now() - startedAt;
    return {
      url,
      reachable: false,
      latencyMs,
      timedOut,
      message: timedOut
        ? `Timed out while probing '${url}'.`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveRemoteProbeUrl(endpoint: string, transport: string | undefined): string {
  const url = new URL(endpoint);
  if (transport === 'ollama') {
    url.pathname = url.pathname.replace(/\/$/, '') + '/api/tags';
  }
  return url.toString();
}
