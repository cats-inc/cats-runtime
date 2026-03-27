import { Hono } from 'hono';
import {
  isProviderTargetResolutionError,
  listConfiguredProviders,
  listProviderCatalog,
  resolveProviderTarget,
} from '../../core/providerCatalog.js';
import { inspectProviderActiveConfig } from '../../core/providerActiveConfig.js';
import type { ProviderName } from '../../backends/cli/providers/types.js';
import { inspectAgentTarget } from '../../backends/agent/inspection.js';
import { buildProviderInstallCatalogView } from '../../core/provider-install/knowledge.js';
import {
  createCompatibilityEvidenceService,
  summarizeCompatibilityEvidenceArtifactForReadModel,
} from '../../core/compatibility/compatibilityEvidenceReadModel.js';
import {
  createProviderEvolutionProbeService,
  resolveProviderEvolutionArtifactInstance,
  summarizeProviderEvolutionArtifactForReadModel,
} from '../../core/compatibility/providerEvolutionReadModel.js';
import { buildProviderContinuitySummary } from '../../core/providerContinuity.js';
import {
  buildProviderToolingSummary,
  loadProviderRemoteToolCatalog,
} from '../../core/tools/providerTooling.js';
import type { AppContext } from '../app.js';
import {
  getProviderCompatibilityService,
  getRuntimeMeteringService,
} from '../app.js';
import { getRouteErrorStatus } from '../routeErrors.js';

export const providerRoutes = new Hono();

class ProviderCatalogQueryError extends Error {}

function parseModelCatalogRefreshQuery(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'refresh' || normalized === 'force') {
    return true;
  }
  if (normalized === '0' || normalized === 'false') {
    return false;
  }

  throw new ProviderCatalogQueryError(
    `Invalid refresh query value '${value}'. Use true/false or 1/0.`,
  );
}

providerRoutes.get('/providers/config', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const providerCatalog = listProviderCatalog(ctx.config);
  const compatibility = getProviderCompatibilityService(ctx);
  const compatibilityEvidence = createCompatibilityEvidenceService(ctx.config);
  const executionStrategies = ctx.apiBackend?.inspectExecutionStrategies();
  const probeService = createProviderEvolutionProbeService(ctx.config);

  const providerEntries = await Promise.all(
    listConfiguredProviders(ctx.config).map(async (providerName) => {
      const provider = providerCatalog[providerName];
      if (!provider) {
        return null;
      }

      const instances = await Promise.all(provider.instances.map(async (instance) => {
        const agentRuntime = instance.backend === 'agent' && instance.remoteInstance
          ? ctx.agentBackend
            ? ctx.agentBackend.inspect(instance)
            : inspectAgentTarget(instance.remoteInstance, { env: process.env })
          : undefined;
        const continuity = buildProviderContinuitySummary(instance, {
          capabilities: instance.backend === 'cli'
            ? ctx.pool.getCapabilities(instance.providerName, instance.instanceId)
            : instance.backend === 'agent'
              ? (ctx.agentBackend?.getCapabilities() || {
                  resume: true,
                  fork: true,
                  permissions: false,
                })
              : (ctx.apiBackend?.getCapabilities() || {
                  resume: true,
                  fork: true,
                  permissions: true,
                }),
          ...(agentRuntime ? { agentRuntime } : {}),
        });
        const latestProbeArtifact = await probeService.readLatestArtifact({
          provider: instance.providerName,
          instance: resolveProviderEvolutionArtifactInstance(instance),
        });
        const latestCompatibilityEvidence = instance.backend === 'cli'
          ? await compatibilityEvidence.readLatestArtifact({
              provider: instance.providerName,
              instance: instance.instanceId,
            })
          : null;
        const metering = getRuntimeMeteringService(ctx).buildProviderTargetSnapshot({
          provider: instance.providerName,
          instance: instance.instanceId,
          backend: instance.backend,
        });

        return {
          ...(instance.backend === 'cli' && instance.cliInstance
            ? (() => {
              const activeConfig = inspectProviderActiveConfig(instance);
              return activeConfig ? { activeConfig } : {};
            })()
            : {}),
          id: instance.instanceId,
          target: `${instance.backend}/${instance.instanceId}`,
          backend: instance.backend,
          command: instance.cliInstance?.commandConfig.path,
          runner: instance.cliInstance?.commandConfig.runner,
          runtime: instance.cliInstance?.commandConfig.runtime,
          transport: instance.remoteInstance?.transport,
          model: instance.remoteInstance?.model,
          ...(agentRuntime ? { agentRuntime } : {}),
          continuity,
          metering: metering.summary,
          tooling: buildProviderToolingSummary(instance, { agentRuntime }),
          install: instance.backend === 'cli' && instance.cliInstance
            ? buildProviderInstallCatalogView(
              instance.providerName as ProviderName,
              instance.cliInstance.commandConfig.runtime,
            )
            : null,
          compatibility: instance.backend === 'cli'
            ? compatibility.getCachedSummary(
              instance.providerName as ProviderName,
              instance.instanceId,
            ) || null
            : null,
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
        };
      }));

      if (instances.length === 0) {
        return null;
      }

      return [
        providerName,
        {
          defaultInstance: provider.defaultTarget?.instance || instances[0]?.id || 'default',
          defaultBackend: provider.defaultTarget?.backend,
          instances,
        },
      ] as const;
    }),
  );
  const providers = Object.fromEntries(
    providerEntries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );

  return c.json({
    providers,
    ...(executionStrategies ? { executionStrategies } : {}),
  });
});

providerRoutes.get('/providers/models', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;

  try {
    const forceRefresh = parseModelCatalogRefreshQuery(c.req.query('refresh'));
    const providers = await Promise.all(
      listConfiguredProviders(ctx.config).map(async (providerName) => [
        providerName,
        await ctx.providerModelCatalog.getCatalog(providerName, undefined, {
          forceRefresh,
        }),
      ] as const),
    );

    return c.json({
      providers: Object.fromEntries(providers),
    });
  } catch (err) {
    if (err instanceof ProviderCatalogQueryError) {
      return c.json({ error: err.message }, 400);
    }

    return c.json(
      {
        error: `Failed to inspect configured provider models: ${err}`,
      },
      getRouteErrorStatus(err),
    );
  }
});

providerRoutes.get('/providers/:provider/models', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const providerName = c.req.param('provider');
  const instance = c.req.query('instance') || undefined;

  try {
    const forceRefresh = parseModelCatalogRefreshQuery(c.req.query('refresh'));
    const catalog = await ctx.providerModelCatalog.getCatalog(providerName, instance, {
      forceRefresh,
    });
    return c.json(catalog);
  } catch (err) {
    const payload: Record<string, unknown> = {
      error: `Failed to inspect provider models: ${err}`,
    };
    if (err instanceof ProviderCatalogQueryError) {
      return c.json({ error: err.message }, 400);
    }
    if (isProviderTargetResolutionError(err)) {
      payload.code = err.code;
    }

    return c.json(
      payload,
      getRouteErrorStatus(err),
    );
  }
});

providerRoutes.get('/providers/:provider/tools', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const providerName = c.req.param('provider');
  const instance = c.req.query('instance') || undefined;

  try {
    const target = resolveProviderTarget(ctx.config, providerName, instance);
    const agentRuntime = target.backend === 'agent' && target.remoteInstance
      ? ctx.agentBackend
        ? ctx.agentBackend.inspect(target)
        : inspectAgentTarget(target.remoteInstance, { env: process.env })
      : undefined;
    const remoteCatalog = await loadProviderRemoteToolCatalog(target, {
      agentRuntime,
      agentBackend: ctx.agentBackend,
    });
    return c.json({
      provider: target.providerName,
      backend: target.backend,
      instance: target.instanceId,
      target: `${target.backend}/${target.instanceId}`,
      ...(agentRuntime ? { agentRuntime } : {}),
      continuity: buildProviderContinuitySummary(target, {
        capabilities: target.backend === 'cli'
          ? ctx.pool.getCapabilities(target.providerName, target.instanceId)
          : target.backend === 'agent'
            ? (ctx.agentBackend?.getCapabilities() || {
                resume: true,
                fork: true,
                permissions: false,
              })
            : (ctx.apiBackend?.getCapabilities() || {
                resume: true,
                fork: true,
                permissions: true,
              }),
        ...(agentRuntime ? { agentRuntime } : {}),
      }),
      ...buildProviderToolingSummary(target, { agentRuntime, remoteCatalog }),
    });
  } catch (err) {
    const payload: Record<string, unknown> = {
      error: `Failed to inspect provider tools: ${err}`,
    };
    if (isProviderTargetResolutionError(err)) {
      payload.code = err.code;
    }

    return c.json(
      payload,
      getRouteErrorStatus(err),
    );
  }
});

providerRoutes.get('/providers/:provider/models/advanced', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const providerName = c.req.param('provider');
  const instance = c.req.query('instance') || undefined;

  try {
    const forceRefresh = parseModelCatalogRefreshQuery(c.req.query('refresh'));
    const catalog = await ctx.providerModelCatalog.getAdvancedCatalog(providerName, instance, {
      forceRefresh,
    });
    return c.json(catalog);
  } catch (err) {
    const payload: Record<string, unknown> = {
      error: `Failed to inspect advanced provider models: ${err}`,
    };
    if (err instanceof ProviderCatalogQueryError) {
      return c.json({ error: err.message }, 400);
    }
    if (isProviderTargetResolutionError(err)) {
      payload.code = err.code;
    }

    return c.json(
      payload,
      getRouteErrorStatus(err),
    );
  }
});
