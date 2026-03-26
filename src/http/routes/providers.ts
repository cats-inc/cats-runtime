import { Hono } from 'hono';
import {
  isProviderTargetResolutionError,
  listConfiguredProviders,
  listProviderCatalog,
  resolveProviderTarget,
} from '../../core/providerCatalog.js';
import { inspectProviderActiveConfig } from '../../core/providerActiveConfig.js';
import type { ProviderName } from '../../backends/cli/providers/types.js';
import { buildProviderInstallCatalogView } from '../../core/provider-install/knowledge.js';
import { buildProviderToolingSummary } from '../../core/tools/providerTooling.js';
import type { AppContext } from '../app.js';
import { getProviderCompatibilityService } from '../app.js';
import { getRouteErrorStatus } from '../routeErrors.js';

export const providerRoutes = new Hono();

providerRoutes.get('/providers/config', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const providerCatalog = listProviderCatalog(ctx.config);
  const compatibility = getProviderCompatibilityService(ctx);

  const providers = Object.fromEntries(
    listConfiguredProviders(ctx.config).flatMap((providerName) => {
      const provider = providerCatalog[providerName];
      if (!provider) {
        return [];
      }

      const instances = provider.instances.map((instance) => ({
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
        tooling: buildProviderToolingSummary(instance),
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
      }));

      if (instances.length === 0) {
        return [];
      }

      return [[
        providerName,
        {
          defaultInstance: provider.defaultTarget?.instance || instances[0]?.id || 'default',
          defaultBackend: provider.defaultTarget?.backend,
          instances,
        },
      ]];
    }),
  );

  return c.json({ providers });
});

providerRoutes.get('/providers/:provider/models', async (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const providerName = c.req.param('provider');
  const instance = c.req.query('instance') || undefined;

  try {
    const catalog = await ctx.providerModelCatalog.getCatalog(providerName, instance);
    return c.json(catalog);
  } catch (err) {
    const payload: Record<string, unknown> = {
      error: `Failed to inspect provider models: ${err}`,
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

providerRoutes.get('/providers/:provider/tools', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const providerName = c.req.param('provider');
  const instance = c.req.query('instance') || undefined;

  try {
    const target = resolveProviderTarget(ctx.config, providerName, instance);
    return c.json({
      provider: target.providerName,
      backend: target.backend,
      instance: target.instanceId,
      target: `${target.backend}/${target.instanceId}`,
      ...buildProviderToolingSummary(target),
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
    const catalog = await ctx.providerModelCatalog.getAdvancedCatalog(providerName, instance);
    return c.json(catalog);
  } catch (err) {
    const payload: Record<string, unknown> = {
      error: `Failed to inspect advanced provider models: ${err}`,
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
