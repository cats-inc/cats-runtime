import { Hono } from 'hono';
import { handleMcpJsonRpc } from '../../mcp/server.js';
import type { AppContext } from '../app.js';

interface McpRouteEnv {
  Variables: {
    ctx: AppContext;
  };
}

export const mcpRoutes = new Hono<McpRouteEnv>();

mcpRoutes.post('/mcp', async (c) => {
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

  const response = await handleMcpJsonRpc(ctx, rawBody);
  if (response === null) {
    return c.body(null, 204);
  }

  return c.json(response);
});
