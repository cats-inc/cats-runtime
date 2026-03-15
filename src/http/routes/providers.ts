import { Hono } from 'hono';
import {
  getProviderDefaultInstanceId,
  listProviderInstances,
} from '../../backends/cli/config.js';
import { KNOWN_PROVIDERS } from '../../backends/cli/providers/types.js';
import type { AppContext } from '../app.js';

export const providerRoutes = new Hono();

providerRoutes.get('/providers/config', (c) => {
  const ctx = c.get('ctx' as never) as AppContext;

  const providers = Object.fromEntries(
    KNOWN_PROVIDERS.flatMap((providerName) => {
      const instances = listProviderInstances(ctx.config, providerName).map((instance) => ({
        id: instance.id,
        command: instance.commandConfig.path,
        runner: instance.commandConfig.runner,
        runtime: instance.commandConfig.runtime,
      }));

      if (instances.length === 0) {
        return [];
      }

      return [[
        providerName,
        {
          defaultInstance: getProviderDefaultInstanceId(ctx.config, providerName),
          instances,
        },
      ]];
    }),
  );

  return c.json({ providers });
});
