import { Hono } from 'hono';
import { listConfiguredProviders, listProviderCatalog } from '../../core/providerCatalog.js';
import type { AppContext } from '../app.js';

export const providerRoutes = new Hono();

providerRoutes.get('/providers/config', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;
  const providerCatalog = listProviderCatalog(ctx.config);

  const providers = Object.fromEntries(
    listConfiguredProviders(ctx.config).flatMap((providerName) => {
      const provider = providerCatalog[providerName];
      if (!provider) {
        return [];
      }

      const instances = provider.instances.map((instance) => ({
        id: instance.instanceId,
        target: `${instance.backend}/${instance.instanceId}`,
        backend: instance.backend,
        command: instance.cliInstance?.commandConfig.path,
        runner: instance.cliInstance?.commandConfig.runner,
        runtime: instance.cliInstance?.commandConfig.runtime,
        transport: instance.remoteInstance?.transport,
        model: instance.remoteInstance?.model,
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
