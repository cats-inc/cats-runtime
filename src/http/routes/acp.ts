import { Hono } from 'hono';
import { handleAcpJsonRpc } from '../../acp/server.js';
import type { AppContext } from '../app.js';

interface AcpRouteEnv {
  Variables: {
    ctx: AppContext;
  };
}

export const acpRoutes = new Hono<AcpRouteEnv>();

acpRoutes.post('/acp', async (c) => {
  const ctx = c.get('ctx');
  const rawBody = await c.req.json<unknown>().catch(() => undefined);
  if (rawBody === undefined) {
    return c.json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Invalid JSON body',
      },
    }, 400);
  }

  const response = await handleAcpJsonRpc(ctx, rawBody, {
    transport: 'http',
  });
  if (response === null) {
    return c.body(null, 204);
  }

  return c.json(response);
});
