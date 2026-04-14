import { createRuntimeApp, type AppContext } from '../http/app.js';

export async function requestRuntimeSessionRoute(
  ctx: AppContext,
  path: string,
  init: {
    method: 'POST' | 'GET' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<Response> {
  const app = createRuntimeApp(ctx);
  const headers = init.body === undefined
    ? init.headers
    : {
        'content-type': 'application/json',
        ...init.headers,
      };
  return app.request(path, {
    method: init.method,
    ...(headers ? { headers } : {}),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}
