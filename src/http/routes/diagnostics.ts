import { Hono } from 'hono';
import type { BackendKind, RemoteProviderInstanceConfig } from '../../backends/cli/config.js';
import { inspectAgentTarget } from '../../backends/agent/inspection.js';
import { buildApiRuntimeExecutionStrategyCatalog } from '../../backends/api/runtime/strategies/catalog.js';
import { inspectApiTarget } from '../../backends/api/inspection.js';
import {
  getRuntimeListenerConfig,
  getRuntimeResolvedPaths,
} from '../../core/config.js';
import { getPeerDiscoverySnapshot } from '../../core/peers/discoverySnapshot.js';
import {
  listProviderCatalog,
  type ProviderTargetDescriptor,
} from '../../core/providerCatalog.js';
import {
  buildRemoteModelDiscoveryRequest,
  DEFAULT_REMOTE_MODEL_DISCOVERY_TIMEOUT_MS,
  fetchRemoteModelDiscovery,
  RemoteModelDiscoveryAbortError,
  RemoteModelDiscoveryTimeoutError,
  resolveRemoteEndpoint,
  sanitizeRemoteModelDiscoveryUrl,
  type RemoteModelDiscoveryAuthMode,
  type RemoteModelDiscoveryRequest,
  type RemoteModelDiscoveryTarget,
} from '../../core/models/remoteModelDiscovery.js';
import { inspectProviderActiveConfig } from '../../core/providerActiveConfig.js';
import { toCompatibilitySummaryView } from '../../core/compatibility/ProviderCompatibilityService.js';
import type { CompatibilitySummaryView } from '../../core/compatibility/types.js';
import {
  createCompatibilityEvidenceService,
  summarizeCompatibilityEvidenceArtifactForReadModel,
  type CompatibilityEvidenceLatestArtifactReadModel,
} from '../../core/compatibility/compatibilityEvidenceReadModel.js';
import {
  createProviderEvolutionProbeService,
  resolveProviderEvolutionArtifactInstance,
  summarizeProviderEvolutionArtifactForReadModel,
  type ProviderEvolutionLatestArtifactReadModel,
} from '../../core/compatibility/providerEvolutionReadModel.js';
import {
  summarizeProviderEvolutionProbeArtifact,
  type ProviderEvolutionExternalReference,
  type ProviderEvolutionProbeArtifactQuery,
  type ProviderEvolutionReviewClassification,
  type ProviderEvolutionProbeReviewUpdate,
} from '../../core/compatibility/providerEvolutionProbe.js';
import { buildProviderContinuitySummary } from '../../core/providerContinuity.js';
import type { ProviderSetupSummary } from '../../core/provider-install/types.js';
import {
  buildProviderToolingSummary,
  loadProviderRemoteToolCatalog,
} from '../../core/tools/providerTooling.js';
import { buildRuntimeToolCatalogSummary } from '../../core/tools/LocalToolRuntime.js';
import { inspectRuntimeDeliveryContract } from '../../core/runtime/RuntimeDeliveryService.js';
import { inspectRuntimeSkillCatalog } from '../../core/skills/catalog.js';
import type { HealthStatus } from '../../core/types.js';
import type { AppContext } from '../app.js';
import {
  getProviderCompatibilityService,
  getRuntimeBrowserService,
  getRuntimeManagementService,
  getRuntimeMeteringService,
} from '../app.js';
import type { RuntimeProviderTargetMeteringSnapshot } from '../../core/usage/RuntimeMeteringService.js';
import {
  DEFAULT_RUNTIME_AGENT_PROBE_TIMEOUT_MS,
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
import { SetupDiagnosticService } from '../../core/diagnostics/SetupDiagnosticService.js';

type DiagnosticStatus = HealthStatus['status'];
type DiagnosticsProbeMode = 'light' | 'live';
const DIAGNOSTIC_BACKENDS: readonly BackendKind[] = ['cli', 'api', 'local', 'agent'];
const DEFAULT_REMOTE_ENDPOINT_PROBE_TIMEOUT_MS = DEFAULT_REMOTE_MODEL_DISCOVERY_TIMEOUT_MS;

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
  metering: RuntimeProviderTargetMeteringSnapshot;
  compatibilityEvidence?: {
    latestArtifact: CompatibilityEvidenceLatestArtifactReadModel;
  };
  providerEvolution?: {
    latestArtifact: ProviderEvolutionLatestArtifactReadModel;
  };
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

interface RuntimeSetupDiagnosticsSummary {
  bootstrapRequired: boolean;
  latestReport: {
    artifactId: string;
    generatedAt: string;
    status: 'ok' | 'degraded' | 'unavailable';
    issueCounts: {
      info: number;
      warnings: number;
      errors: number;
    };
    headline: string;
    highlights: string[];
  } | null;
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

function getRuntimeWakeupSnapshot(ctx: AppContext) {
  return ctx.wakeup?.buildDiagnosticsSnapshot() ?? {
    summary: {
      status: 'degraded' as const,
      summary: 'Wakeup service is not initialized.',
      totalRequests: 0,
      openRequests: 0,
      scheduled: 0,
      due: 0,
      triggering: 0,
      recurring: 0,
      terminal: 0,
      triggered: 0,
      cancelled: 0,
      failed: 0,
      sessionsWithPending: 0,
      nextScheduledAt: null,
    },
    timer: {
      active: false,
      processing: false,
      tickIntervalMs: 0,
      maxDuePerTick: 0,
    },
    retention: {
      maxTerminalRequests: 0,
      maxTerminalRequestsPerSession: 0,
    },
  };
}

function getRuntimeBrowserDiagnostics(ctx: AppContext) {
  const maintenance = ctx.browserMaintenance?.snapshot();
  const summary = getRuntimeBrowserService(ctx).summarizeSessions({
    olderThanMs: maintenance?.policy.closedSessionTtlMs ?? 0,
  });

  return {
    maintenance,
    summary,
  };
}

function getRuntimeWorktreeDiagnostics(ctx: AppContext) {
  const snapshot = ctx.worktreeMaintenance?.snapshot();
  if (!snapshot) {
    return undefined;
  }

  return {
    snapshot,
    summary: {
      retainedSessions: snapshot.retained.totalSessions,
      attachedSessions: snapshot.retained.attachedSessions,
      cleanupEligibleSessions: snapshot.retained.cleanupEligibleSessions,
      expiredSessions: snapshot.retained.expiredSessions,
      retainedTtlMs: snapshot.policy.retainedTtlMs,
      sweepIntervalMs: snapshot.policy.sweepIntervalMs,
      lastSweepAt: snapshot.lastSweep?.observedAt ?? null,
      orphanedWorktrees: snapshot.lastSweep?.orphanedWorktreeCount ?? 0,
      failedOrphanedWorktrees: snapshot.lastSweep?.failedOrphanedWorktreeCount ?? 0,
      autoCleanedRetainedSessions: snapshot.lastSweep?.autoCleanedRetainedSessionCount ?? 0,
      failedAutoCleanedRetainedSessions: snapshot.lastSweep?.failedAutoCleanedRetainedSessionCount ?? 0,
    },
  };
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

function createCheck(
  code: string,
  status: DiagnosticStatus,
  message: string,
  details?: Record<string, unknown>,
): DiagnosticCheck {
  return { code, status, message, details };
}

function appendAgentProbeChecks(
  checks: DiagnosticCheck[],
  probeChecks: Array<{
    code: string;
    status: DiagnosticStatus;
    message: string;
    details?: Record<string, unknown>;
  }> | undefined,
): void {
  for (const check of probeChecks || []) {
    checks.push(
      createCheck(
        check.code,
        check.status,
        check.message,
        check.details,
      ),
    );
  }
}

function classifyRemoteLiveProbe(
  target: ProviderTargetDescriptor,
  probe: {
    url: string;
    reachable: boolean;
    statusCode?: number;
    latencyMs: number;
    timedOut: boolean;
    message: string;
    target: RemoteModelDiscoveryTarget;
    authenticated: boolean;
    headerNames: string[];
  },
): {
    classification: string;
    check?: DiagnosticCheck;
  } {
  if (!probe.reachable) {
    return {
      classification: probe.timedOut ? 'timeout' : 'network_error',
    };
  }

  const details = {
    url: probe.url,
    target: probe.target,
    authenticated: probe.authenticated,
    headerNames: probe.headerNames,
    ...(probe.statusCode !== undefined ? { statusCode: probe.statusCode } : {}),
    latencyMs: probe.latencyMs,
  };
  const targetLabel = `${target.providerName}/${target.instanceId}`;
  const statusCode = probe.statusCode ?? 0;

  if (statusCode >= 200 && statusCode < 300) {
    return {
      classification: 'http_ok',
    };
  }

  if (statusCode >= 300 && statusCode < 400) {
    return {
      classification: 'redirected',
      check: createCheck(
        'endpoint_redirected',
        'degraded',
        `Live probe for ${targetLabel} was redirected (HTTP ${statusCode})`,
        details,
      ),
    };
  }

  if (statusCode === 401) {
    return {
      classification: 'auth_required',
      check: createCheck(
        'endpoint_auth_required',
        'unavailable',
        `Live probe reached ${targetLabel} but the endpoint rejected the request as unauthenticated (HTTP 401)`,
        details,
      ),
    };
  }

  if (statusCode === 403) {
    return {
      classification: 'auth_rejected',
      check: createCheck(
        'endpoint_auth_rejected',
        'unavailable',
        `Live probe reached ${targetLabel} but the endpoint rejected the request as unauthorized (HTTP 403)`,
        details,
      ),
    };
  }

  if (statusCode === 404) {
    return {
      classification: 'endpoint_not_found',
      check: createCheck(
        'endpoint_not_found',
        'unavailable',
        `Live probe reached ${targetLabel} but the endpoint path returned HTTP 404`,
        details,
      ),
    };
  }

  if (statusCode === 429) {
    return {
      classification: 'rate_limited',
      check: createCheck(
        'endpoint_rate_limited',
        'degraded',
        `Live probe reached ${targetLabel} but the endpoint is rate limited (HTTP 429)`,
        details,
      ),
    };
  }

  if (statusCode >= 500) {
    return {
      classification: 'upstream_error',
      check: createCheck(
        'endpoint_upstream_error',
        'degraded',
        `Live probe reached ${targetLabel} but the upstream returned HTTP ${statusCode}`,
        details,
      ),
    };
  }

  return {
    classification: 'unexpected_status',
    check: createCheck(
      'endpoint_http_warning',
      'degraded',
      `Live probe reached ${targetLabel} with unexpected HTTP ${statusCode}`,
      details,
    ),
  };
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
      ...(catalog.defaultModel
        ? {
            defaultModelStatus: catalog.models.find((entry) => entry.id === catalog.defaultModel)?.status,
          }
        : {}),
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
    continuity: buildProviderContinuitySummary(target, {
      capabilities: ctx.pool.getCapabilities(target.providerName, target.instanceId),
    }),
    tooling: buildProviderToolingSummary(target),
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

  if (probeMode === 'live') {
    await appendModelCatalogDiagnostics(ctx, target, checks, config);
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

  const agentRuntime = ctx.agentBackend
    ? ctx.agentBackend.inspect(target)
    : inspectAgentTarget(instance, { env });
  const config: Record<string, unknown> = {
    transport: instance.transport,
    model: instance.model || null,
    endpoint: resolveRemoteEndpoint(instance, env),
    continuity: buildProviderContinuitySummary(target, {
      capabilities: ctx.agentBackend?.getCapabilities() || {
        resume: true,
        fork: true,
        permissions: false,
      },
      agentRuntime,
    }),
    tooling: buildProviderToolingSummary(target, { agentRuntime }),
    agentRuntime,
    credentials: {
      urlEnv: buildEnvDescriptor(env, instance.urlEnv, false),
      baseUrlEnv: buildEnvDescriptor(env, instance.baseUrlEnv, false),
      authTokenEnv: buildEnvDescriptor(env, instance.authTokenEnv, false),
    },
  };
  const checks: DiagnosticCheck[] = [];
  checks.push(
    createCheck(
      'agent_runtime_contract',
      'ok',
      agentRuntime.summary,
      {
        adapter: agentRuntime.adapter,
        family: agentRuntime.family,
        transport: agentRuntime.transport,
        request: agentRuntime.request,
        auth: agentRuntime.auth,
        continuity: agentRuntime.continuity,
        capabilities: agentRuntime.capabilities,
      },
    ),
  );

  try {
    const shouldProbeLive = probeMode === 'live'
      || agentRuntime.transport.liveProbe === 'rpc_health';
    const probe = ctx.agentBackend
      ? await ctx.agentBackend.probe(
          target,
          shouldProbeLive,
          DEFAULT_RUNTIME_AGENT_PROBE_TIMEOUT_MS,
        )
      : await probeRuntimeAgentInstance(instance, shouldProbeLive);
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

    const probeHealth = probe.result.health;
    if (probe.result.liveProbe) {
      config.liveProbe = {
        adapter: probe.kind,
        ...probe.result.liveProbe,
      };
    }

    checks.push(
      createCheck(
        'probe',
        probeHealth.status,
        probeHealth.details || `Probe completed for ${target.providerName}/${target.instanceId}`,
      ),
    );
    appendAgentProbeChecks(checks, probe.result.checks);
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
    const toolCatalog = await loadProviderRemoteToolCatalog(target, {
      agentRuntime,
      agentBackend: ctx.agentBackend,
    });
    if (toolCatalog) {
      config.toolCatalog = {
        source: toolCatalog.source,
        status: toolCatalog.status,
        method: toolCatalog.method,
        summary: toolCatalog.summary,
        toolCount: toolCatalog.toolCount,
        groupCount: toolCatalog.groupCount,
        groups: toolCatalog.groups.map((group) => ({ ...group })),
        ...(toolCatalog.error ? { error: toolCatalog.error } : {}),
      };
      checks.push(
        createCheck(
          toolCatalog.status === 'ready' ? 'tool_catalog_loaded' : 'tool_catalog_unavailable',
          toolCatalog.status === 'ready' ? 'ok' : 'degraded',
          toolCatalog.summary,
          {
            method: toolCatalog.method,
            toolCount: toolCatalog.toolCount,
            groupCount: toolCatalog.groupCount,
            groups: toolCatalog.groups.map((group) => ({ ...group })),
            ...(toolCatalog.error ? { error: toolCatalog.error } : {}),
          },
        ),
      );
    }
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
  const endpoint = resolveRemoteEndpoint(instance, env);
  const requiresApiKey = instance.transport === 'anthropic'
    || instance.transport === 'openai'
    || instance.transport === 'google'
    || instance.transport === 'gemini';
  const apiKey = buildEnvDescriptor(env, instance.apiKeyEnv, requiresApiKey);
  const apiRuntime = inspectApiTarget(target);
  const config: Record<string, unknown> = {
    transport: instance.transport,
    model: instance.model || null,
    endpoint,
    ...(apiRuntime ? { apiRuntime } : {}),
    continuity: buildProviderContinuitySummary(target, {
      capabilities: ctx.apiBackend?.getCapabilities() || {
        resume: true,
        fork: true,
        permissions: true,
      },
    }),
    tooling: buildProviderToolingSummary(target),
    credentials: {
      apiKeyEnv: apiKey,
      ...(instance.baseUrlEnv
        ? { baseUrlEnv: buildEnvDescriptor(env, instance.baseUrlEnv, false) }
        : {}),
      authTokenEnv: buildEnvDescriptor(env, instance.authTokenEnv, false),
      ...(instance.organizationEnv
        ? { organizationEnv: buildEnvDescriptor(env, instance.organizationEnv, false) }
        : {}),
      ...(instance.projectEnv
        ? { projectEnv: buildEnvDescriptor(env, instance.projectEnv, false) }
        : {}),
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
    const probeRequest = buildRemoteModelDiscoveryRequest(instance, env);
    if (probeRequest) {
      checks.push(
        createCheck(
          probeRequest.auth.applied ? 'live_probe_authenticated' : 'live_probe_unauthenticated',
          probeRequest.auth.required && !probeRequest.auth.applied ? 'degraded' : 'ok',
          probeRequest.auth.applied
            ? `Live probe for ${target.providerName}/${target.instanceId} will use ${probeRequest.auth.mode} auth against ${probeRequest.target}`
            : probeRequest.auth.required
              ? `Live probe for ${target.providerName}/${target.instanceId} is running without required ${probeRequest.auth.mode} credentials`
              : `Live probe for ${target.providerName}/${target.instanceId} does not require provider auth`,
          {
            url: probeRequest.displayUrl,
            target: probeRequest.target,
            headerNames: probeRequest.headerNames,
            authentication: {
              mode: probeRequest.auth.mode,
              required: probeRequest.auth.required,
              applied: probeRequest.auth.applied,
            },
          },
        ),
      );
    }
    const liveProbe = await probeRemoteEndpoint(probeRequest || {
      url: endpoint,
      displayUrl: sanitizeRemoteModelDiscoveryUrl(endpoint),
      method: 'GET',
      headers: {},
      headerNames: [],
      target: 'endpoint',
      auth: {
        mode: 'none',
        required: false,
        applied: false,
      },
    });
    const classifiedLiveProbe = classifyRemoteLiveProbe(target, liveProbe);
    config.liveProbe = {
      url: liveProbe.url,
      method: liveProbe.method,
      target: liveProbe.target,
      headerNames: liveProbe.headerNames,
      authentication: {
        mode: liveProbe.authMode,
        required: liveProbe.authRequired,
        applied: liveProbe.authenticated,
      },
      reachable: liveProbe.reachable,
      ...(liveProbe.statusCode !== undefined ? { statusCode: liveProbe.statusCode } : {}),
      latencyMs: liveProbe.latencyMs,
      classification: classifiedLiveProbe.classification,
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
          target: liveProbe.target,
          authenticated: liveProbe.authenticated,
          headerNames: liveProbe.headerNames,
          ...(liveProbe.statusCode !== undefined ? { statusCode: liveProbe.statusCode } : {}),
          latencyMs: liveProbe.latencyMs,
          ...(liveProbe.timedOut ? { timedOut: true } : {}),
        },
      ),
    );
    if (classifiedLiveProbe.check) {
      checks.push(classifiedLiveProbe.check);
    }
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
  compatibilityEvidenceService?: ReturnType<typeof createCompatibilityEvidenceService>,
  probeService?: ReturnType<typeof createProviderEvolutionProbeService>,
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
  const latestProbeArtifact = probeService
    ? await probeService.readLatestArtifact({
        provider: target.providerName,
        instance: resolveProviderEvolutionArtifactInstance(target),
      })
    : null;
  const latestCompatibilityEvidence = target.backend === 'cli' && compatibilityEvidenceService
    ? await compatibilityEvidenceService.readLatestArtifact({
        provider: target.providerName,
        instance: target.instanceId,
      })
    : null;
  const metering = getRuntimeMeteringService(ctx).buildProviderTargetSnapshot({
    provider: target.providerName,
    instance: target.instanceId,
    backend: target.backend,
  });

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
    metering,
    ...(latestCompatibilityEvidence ? {
      compatibilityEvidence: {
        latestArtifact: summarizeCompatibilityEvidenceArtifactForReadModel(
          latestCompatibilityEvidence,
        ),
      },
    } : {}),
    ...(latestProbeArtifact ? {
      providerEvolution: {
        latestArtifact: summarizeProviderEvolutionArtifactForReadModel(latestProbeArtifact),
      },
    } : {}),
    reprobe: {
      forceSupported: target.backend === 'cli',
      liveSupported: target.backend === 'cli'
        ? Boolean(result.compatibility?.probe.supportsLive)
        : target.backend === 'agent'
          || Boolean(target.remoteInstance && resolveRemoteEndpoint(target.remoteInstance, env)),
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
  const compatibilityEvidenceService = createCompatibilityEvidenceService(ctx.config);
  const probeService = createProviderEvolutionProbeService(ctx.config);
  const providers = await Promise.all(
    Object.values(catalog)
      .flatMap((entry) => entry.instances)
      .map((target) => diagnoseTarget(
        ctx,
        target,
        probeMode,
        env,
        forceRefresh,
        compatibilityEvidenceService,
        probeService,
      )),
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
  const wakeups = getRuntimeWakeupSnapshot(ctx);
  const browser = getRuntimeBrowserDiagnostics(ctx);
  const worktrees = getRuntimeWorktreeDiagnostics(ctx);
  const executionStrategies = ctx.apiBackend?.inspectExecutionStrategies()
    ?? buildApiRuntimeExecutionStrategyCatalog();
  const management = getRuntimeManagementService(ctx).inspectOperations();
  const setup = buildRuntimeSetupDiagnosticsSummary(ctx);
  const skills = inspectRuntimeSkillCatalog();
  const tools = buildRuntimeToolCatalogSummary();
  const delivery = inspectRuntimeDeliveryContract();

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
        ...(worktrees ? { worktrees: worktrees.snapshot } : {}),
        ...(browser.maintenance ? { browser: browser.maintenance } : {}),
      },
      browser: browser.summary,
      executionStrategies,
      management: {
        operations: management.summary,
      },
      delivery,
      tools,
      skills,
      setup,
      wakeups,
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
    const probeMode = parseDiagnosticsProbeMode(c.req.query('probe'));
    const forceRefresh = parseForceRefreshQuery(c.req.query('force'));
    const filters = parseProviderDiagnosticsFilters(c.req.query());
    return c.json(await buildProviderDiagnosticsPayload(
      ctx,
      probeMode,
      getRuntimeEnvironment(),
      forceRefresh,
      filters,
    ));
  } catch (error) {
    if (error instanceof DiagnosticsQueryError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

diagnosticsRoutes.post('/diagnostics/providers/reprobe', async (c) => {
  try {
    const ctx = c.get('ctx');
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const probeMode = parseOptionalProbeModeValue(body.probe) ?? 'light';
    const filters = parseProviderDiagnosticsBodyFilters(body);

    return c.json({
      ...(await buildProviderDiagnosticsPayload(
        ctx,
        probeMode,
        getRuntimeEnvironment(),
        true,
        filters,
      )),
      reprobe: {
        forceRefresh: true,
      },
    });
  } catch (error) {
    if (error instanceof DiagnosticsQueryError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

diagnosticsRoutes.get('/diagnostics/providers/evolution', async (c) => {
  try {
    const ctx = c.get('ctx');
    const query = parseProviderEvolutionArtifactQuery(new URL(c.req.url));
    const probeService = createProviderEvolutionProbeService(ctx.config);
    const artifacts = await probeService.listArtifacts(query);

    return c.json({
      query: {
        ...query,
        ...(query.reviewClassifications
          ? { reviewClassifications: query.reviewClassifications }
          : {}),
      },
      artifacts: artifacts.map((artifact) => ({
        ...summarizeProviderEvolutionArtifactForReadModel(artifact),
        provider: artifact.provider,
        instance: artifact.instance,
        parserId: artifact.parserId,
      })),
    });
  } catch (error) {
    if (error instanceof DiagnosticsQueryError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

diagnosticsRoutes.get('/diagnostics/providers/evolution/:artifactId', async (c) => {
  try {
    const ctx = c.get('ctx');
    const artifactId = c.req.param('artifactId')?.trim();
    if (!artifactId) {
      throw new DiagnosticsQueryError('Missing provider-evolution artifact id.');
    }

    const query = parseProviderEvolutionArtifactQuery(new URL(c.req.url));
    const probeService = createProviderEvolutionProbeService(ctx.config);
    const artifact = await probeService.readArtifactById(artifactId, query);

    if (!artifact) {
      return c.json({
        error: `Provider-evolution artifact '${artifactId}' was not found.`,
        code: 'provider_evolution_artifact_not_found',
      }, 404);
    }

    return c.json({
      relativePath: artifact.relativePath.replace(/\\/g, '/'),
      artifact: artifact.artifact,
    });
  } catch (error) {
    if (error instanceof DiagnosticsQueryError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

diagnosticsRoutes.post('/diagnostics/providers/evolution/:artifactId/review', async (c) => {
  try {
    const ctx = c.get('ctx');
    const artifactId = c.req.param('artifactId')?.trim();
    if (!artifactId) {
      throw new DiagnosticsQueryError('Missing provider-evolution artifact id.');
    }

    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const update = parseProviderEvolutionReviewUpdateBody(body);
    const query = parseProviderEvolutionArtifactIdentityBody(body);
    const probeService = createProviderEvolutionProbeService(ctx.config);
    const artifact = await probeService.updateArtifactReviewById(
      artifactId,
      update,
      query,
    );

    if (!artifact) {
      return c.json({
        error: `Provider-evolution artifact '${artifactId}' was not found.`,
        code: 'provider_evolution_artifact_not_found',
      }, 404);
    }

    return c.json({
      artifact: summarizeProviderEvolutionArtifactForReadModel(
        summarizeProviderEvolutionProbeArtifact(artifact),
      ),
      updated: true,
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
  const wakeups = getRuntimeWakeupSnapshot(ctx);
  const browser = getRuntimeBrowserDiagnostics(ctx);
  const worktrees = getRuntimeWorktreeDiagnostics(ctx);
  const executionStrategies = ctx.apiBackend?.inspectExecutionStrategies()
    ?? buildApiRuntimeExecutionStrategyCatalog();
  const management = getRuntimeManagementService(ctx).inspectOperations();
  const setup = buildRuntimeSetupDiagnosticsSummary(ctx);
  const skills = inspectRuntimeSkillCatalog();
  const tools = buildRuntimeToolCatalogSummary();
  const delivery = inspectRuntimeDeliveryContract();
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
      executionStrategies: executionStrategies.summary,
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
    ...(worktrees ? {
      worktrees: {
        summary: worktrees.summary,
      },
    } : {}),
    browser: {
      summary: {
        totalSessions: browser.summary.sessions.total,
        readySessions: browser.summary.sessions.ready,
        closedSessions: browser.summary.sessions.closed,
        totalPages: browser.summary.pages.total,
        openPages: browser.summary.pages.open,
        closedPages: browser.summary.pages.closed,
        attachedRuntimeSessionCount: browser.summary.attachedRuntimeSessionCount,
        cleanupCandidateSessions: browser.summary.cleanupCandidates.sessionCount,
        cleanupCandidatePages: browser.summary.cleanupCandidates.pageCount,
        cleanupCandidateOlderThanMs: browser.summary.cleanupCandidates.olderThanMs,
      },
    },
    management: {
      summary: management.summary,
    },
    delivery: {
      summary: delivery.summary,
    },
    tools: {
      summary: tools,
    },
    skills: {
      summary: {
        state: skills.state,
        totalSkills: skills.totalSkills,
        summary: skills.summary,
      },
    },
    setup,
    wakeups: wakeups.summary,
    metering,
  });
});

export { diagnosticsRoutes };

async function buildProviderDiagnosticsPayload(
  ctx: AppContext,
  probeMode: DiagnosticsProbeMode,
  env: NodeJS.ProcessEnv,
  forceRefresh: boolean,
  filters: ProviderDiagnosticsFilters = { defaultOnly: false },
) {
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

  return {
    service: RUNTIME_SERVICE_NAME,
    version: RUNTIME_VERSION,
    timestamp: new Date().toISOString(),
    probe: probeMode,
    query: buildProviderDiagnosticsQuery(filters),
    readiness: getRuntimeReadinessSnapshot(ctx.startup),
    summary,
    providers,
  };
}

function parseDiagnosticsProbeMode(value: string | undefined): DiagnosticsProbeMode {
  return value === 'live' ? 'live' : 'light';
}

function parseForceRefreshQuery(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'refresh';
}

function buildRuntimeSetupDiagnosticsSummary(ctx: AppContext): RuntimeSetupDiagnosticsSummary {
  const latestReport = ctx.bootstrapService
    ? new SetupDiagnosticService({
        config: ctx.config,
        startup: ctx.startup,
        bootstrapService: ctx.bootstrapService,
      }).readLatestReport()
    : null;

  return {
    bootstrapRequired: ctx.startup.bootstrapRequired,
    latestReport: latestReport
      ? {
          artifactId: latestReport.report.artifactId,
          generatedAt: latestReport.report.generatedAt,
          status: latestReport.report.summary.status,
          issueCounts: latestReport.report.summary.issueCounts,
          headline: latestReport.report.summary.headline,
          highlights: [...latestReport.report.summary.highlights],
        }
      : null,
  };
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

function parseOptionalStringValue(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new DiagnosticsQueryError(`Invalid ${fieldName} value.`);
  }
  return parseOptionalQueryString(value);
}

function parseOptionalStringArrayValue(
  value: unknown,
  fieldName: string,
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new DiagnosticsQueryError(`Invalid ${fieldName} value.`);
  }

  const values = Array.from(new Set(
    value.map((entry) => parseOptionalStringValue(entry, fieldName)).filter(
      (entry): entry is string => Boolean(entry),
    ),
  ));
  return values.length > 0 ? values : undefined;
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

function parseOptionalBooleanValue(
  value: unknown,
  fieldName: string,
): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return parseOptionalBooleanQuery(value);
  }
  throw new DiagnosticsQueryError(`Invalid ${fieldName} value.`);
}

function parseOptionalProbeModeValue(value: unknown): DiagnosticsProbeMode | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === 'light' || value === 'live') {
    return value;
  }
  throw new DiagnosticsQueryError(`Unsupported provider diagnostics probe '${String(value)}'.`);
}

function parseProviderDiagnosticsBodyFilters(
  body: Record<string, unknown>,
): ProviderDiagnosticsFilters {
  const provider = parseOptionalStringValue(body.provider, 'provider');
  const backend = body.backend === undefined
    ? undefined
    : parseOptionalBackend(parseOptionalStringValue(body.backend, 'backend'));
  const instance = parseOptionalStringValue(body.instance, 'instance');

  return {
    ...(provider ? { provider } : {}),
    ...(backend ? { backend } : {}),
    ...(instance ? { instance } : {}),
    defaultOnly: parseOptionalBooleanValue(body.defaultOnly, 'defaultOnly') === true,
  };
}

function parseProviderEvolutionArtifactIdentityBody(
  body: Record<string, unknown>,
): ProviderEvolutionProbeArtifactQuery {
  const provider = parseOptionalStringValue(body.provider, 'provider');
  const instance = parseOptionalStringValue(body.instance, 'instance');
  const parserId = parseOptionalStringValue(body.parserId, 'parserId');
  const probeProfile = parseOptionalStringValue(body.probeProfile, 'probeProfile');
  const transport = parseOptionalProviderEvolutionTransport(body.transport);
  const runtimeMode = parseOptionalProviderEvolutionRuntimeMode(body.runtimeMode);

  return {
    ...(provider ? { provider } : {}),
    ...(instance ? { instance } : {}),
    ...(parserId ? { parserId } : {}),
    ...(probeProfile ? { probeProfile } : {}),
    ...(transport ? { transport } : {}),
    ...(runtimeMode ? { runtimeMode } : {}),
  };
}

function parseProviderEvolutionArtifactQuery(
  url: URL,
): ProviderEvolutionProbeArtifactQuery {
  return {
    provider: parseOptionalQueryString(url.searchParams.get('provider') ?? undefined),
    instance: parseOptionalQueryString(url.searchParams.get('instance') ?? undefined),
    parserId: parseOptionalQueryString(url.searchParams.get('parserId') ?? undefined),
    probeProfile: parseOptionalQueryString(url.searchParams.get('probeProfile') ?? undefined),
    transport: parseOptionalProviderEvolutionTransport(
      url.searchParams.get('transport') ?? undefined,
    ),
    runtimeMode: parseOptionalProviderEvolutionRuntimeMode(
      url.searchParams.get('runtimeMode') ?? undefined,
    ),
    reviewClassifications: parseProviderEvolutionReviewClassifications(url.searchParams),
    limit: parseOptionalPositiveIntQuery(url.searchParams.get('limit') ?? undefined, 'limit'),
  };
}

function parseProviderEvolutionReviewUpdateBody(
  body: Record<string, unknown>,
): ProviderEvolutionProbeReviewUpdate {
  const classifications = parseOptionalProviderEvolutionClassifications(body.classifications);
  const summary = parseOptionalStringValue(body.summary, 'summary');
  const highlights = parseOptionalStringArrayValue(body.highlights, 'highlights');
  const references = parseOptionalProviderEvolutionReferences(body.references);

  if (!classifications && !summary && !highlights && !references) {
    throw new DiagnosticsQueryError(
      'Provider-evolution review update requires at least one of classifications, summary, highlights, or references.',
    );
  }

  return {
    ...(classifications ? { classifications } : {}),
    ...(summary ? { summary } : {}),
    ...(highlights ? { highlights } : {}),
    ...(references ? { references } : {}),
  };
}

function parseOptionalProviderEvolutionTransport(
  value: unknown,
): ProviderEvolutionProbeArtifactQuery['transport'] {
  const normalized = parseOptionalStringValue(value, 'transport');
  if (!normalized) {
    return undefined;
  }

  switch (normalized.toLowerCase()) {
    case 'cli':
    case 'agent':
    case 'api':
    case 'unknown':
      return normalized.toLowerCase() as ProviderEvolutionProbeArtifactQuery['transport'];
    default:
      throw new DiagnosticsQueryError(`Unsupported provider-evolution transport '${normalized}'.`);
  }
}

function parseOptionalProviderEvolutionRuntimeMode(
  value: unknown,
): ProviderEvolutionProbeArtifactQuery['runtimeMode'] {
  const normalized = parseOptionalStringValue(value, 'runtimeMode');
  if (!normalized) {
    return undefined;
  }

  switch (normalized.toLowerCase()) {
    case 'native':
    case 'wsl':
    case 'docker':
      return normalized.toLowerCase() as ProviderEvolutionProbeArtifactQuery['runtimeMode'];
    default:
      throw new DiagnosticsQueryError(`Unsupported provider-evolution runtimeMode '${normalized}'.`);
  }
}

function parseOptionalProviderEvolutionClassifications(
  value: unknown,
): ProviderEvolutionReviewClassification[] | undefined {
  const rawValues = parseOptionalStringArrayValue(value, 'classifications');
  if (!rawValues) {
    return undefined;
  }

  const classifications = Array.from(new Set(
    rawValues.map((entry) => parseProviderEvolutionReviewClassification(entry)),
  ));
  return classifications.length > 0 ? classifications : undefined;
}

function parseProviderEvolutionReviewClassifications(
  searchParams: URLSearchParams,
): ProviderEvolutionReviewClassification[] | undefined {
  const values = searchParams.getAll('classification')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    return undefined;
  }

  const classifications = Array.from(new Set(
    values.map((value) => parseProviderEvolutionReviewClassification(value)),
  ));
  return classifications.length > 0 ? classifications : undefined;
}

function parseProviderEvolutionReviewClassification(
  value: string,
): ProviderEvolutionReviewClassification {
  switch (value.trim().toLowerCase()) {
    case 'baseline':
    case 'stable':
    case 'upgrade':
    case 'regression':
      return value.trim().toLowerCase() as ProviderEvolutionReviewClassification;
    case 'schema_change':
    case 'schema-change':
      return 'schema_change';
    case 'semantic_drift_suspected':
    case 'semantic-drift-suspected':
      return 'semantic_drift_suspected';
    default:
      throw new DiagnosticsQueryError(
        `Invalid provider-evolution classification '${value}'.`,
      );
  }
}

function parseOptionalPositiveIntQuery(
  value: string | undefined,
  fieldName: string,
): number | undefined {
  const normalized = parseOptionalQueryString(value);
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new DiagnosticsQueryError(`Invalid ${fieldName} value.`);
  }
  return parsed;
}

function parseOptionalProviderEvolutionReferences(
  value: unknown,
): ProviderEvolutionExternalReference[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new DiagnosticsQueryError('Invalid references value.');
  }

  const references = value.map((entry) => parseProviderEvolutionReference(entry));
  return references.length > 0 ? references : undefined;
}

function parseProviderEvolutionReference(value: unknown): ProviderEvolutionExternalReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DiagnosticsQueryError('Invalid provider-evolution reference value.');
  }

  const record = value as Record<string, unknown>;
  const kind = parseProviderEvolutionReferenceKind(record.kind);
  const urlValue = parseOptionalStringValue(record.url, 'reference.url');
  if (!urlValue) {
    throw new DiagnosticsQueryError('Invalid reference.url value.');
  }

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new DiagnosticsQueryError(
      `Invalid provider-evolution reference URL '${urlValue}'.`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DiagnosticsQueryError(
      `Invalid provider-evolution reference URL '${urlValue}'.`,
    );
  }

  return {
    kind,
    url: url.toString(),
  };
}

function parseProviderEvolutionReferenceKind(
  value: unknown,
): ProviderEvolutionExternalReference['kind'] {
  const normalized = parseOptionalStringValue(value, 'reference.kind');
  if (!normalized) {
    throw new DiagnosticsQueryError('Invalid reference.kind value.');
  }

  switch (normalized.trim().toLowerCase()) {
    case 'release_notes':
    case 'release-notes':
      return 'release_notes';
    case 'changelog':
    case 'issue':
    case 'announcement':
    case 'other':
      return normalized.trim().toLowerCase() as ProviderEvolutionExternalReference['kind'];
    default:
      throw new DiagnosticsQueryError(
        `Invalid provider-evolution reference kind '${normalized}'.`,
      );
  }
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
  request: RemoteModelDiscoveryRequest,
): Promise<{
    url: string;
    method: 'GET';
    target: RemoteModelDiscoveryTarget;
    headerNames: string[];
    authenticated: boolean;
    authMode: RemoteModelDiscoveryAuthMode;
    authRequired: boolean;
    reachable: boolean;
    statusCode?: number;
    latencyMs: number;
    timedOut: boolean;
    message: string;
  }> {
  try {
    const { response, latencyMs } = await fetchRemoteModelDiscovery(request, {
      timeoutMs: DEFAULT_REMOTE_ENDPOINT_PROBE_TIMEOUT_MS,
    });
    return {
      url: request.displayUrl,
      method: request.method,
      target: request.target,
      headerNames: request.headerNames,
      authenticated: request.auth.applied,
      authMode: request.auth.mode,
      authRequired: request.auth.required,
      reachable: true,
      statusCode: response.status,
      latencyMs,
      timedOut: false,
      message: `Live probe reached '${request.displayUrl}' (HTTP ${response.status}).`,
    };
  } catch (error) {
    const timedOut = error instanceof RemoteModelDiscoveryTimeoutError;
    const aborted = error instanceof RemoteModelDiscoveryAbortError;
    const latencyMs = error instanceof RemoteModelDiscoveryTimeoutError
      || error instanceof RemoteModelDiscoveryAbortError
      ? error.latencyMs
      : 0;
    return {
      url: request.displayUrl,
      method: request.method,
      target: request.target,
      headerNames: request.headerNames,
      authenticated: request.auth.applied,
      authMode: request.auth.mode,
      authRequired: request.auth.required,
      reachable: false,
      latencyMs,
      timedOut,
      message: timedOut
        ? `Timed out while probing '${request.displayUrl}'.`
        : aborted
          ? `Probe aborted while probing '${request.displayUrl}'.`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}
