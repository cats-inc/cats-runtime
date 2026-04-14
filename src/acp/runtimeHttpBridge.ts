import { createRuntimeApp, type AppContext } from '../http/app.js';

export async function requestRuntimeSessionRoute(
  ctx: AppContext,
  path: string,
  init: {
    method: 'POST' | 'GET' | 'DELETE';
    body?: unknown;
  },
): Promise<Response> {
  const app = createRuntimeApp(ctx);
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
