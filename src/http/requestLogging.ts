import { createMiddleware } from 'hono/factory';

/** Access logs never include URL queries, credentials, headers or request bodies. */
export function requestLogging(write: (line: string) => void = (line) => console.log(line)) {
  return createMiddleware(async (c, next) => {
    const request = `${c.req.method} ${c.req.path}`;
    const started = Date.now();
    write(`<-- ${request}`);
    await next();
    write(`--> ${request} ${c.res.status} ${Date.now() - started}ms`);
  });
}
