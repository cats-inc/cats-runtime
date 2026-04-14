import { Hono } from 'hono';
import type { AppContext } from '../http/app.js';
import { sessionRoutes } from '../http/routes/sessions.js';

interface RuntimeHttpBridgeEnv {
  Variables: {
    ctx: AppContext;
  };
}

function createRuntimeHttpBridge(ctx: AppContext) {
  const app = new Hono<RuntimeHttpBridgeEnv>();
  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    await next();
  });
  app.route('/', sessionRoutes);
  return app;
}

export async function requestRuntimeSessionRoute(
  ctx: AppContext,
  path: string,
  init: {
    method: 'POST' | 'GET' | 'DELETE';
    body?: unknown;
  },
): Promise<Response> {
  const app = createRuntimeHttpBridge(ctx);
  return app.request(path, {
    method: init.method,
    ...(init.body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(init.body),
        }),
  });
}
