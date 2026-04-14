import { Hono } from 'hono';
import { handleAcpJsonRpc } from '../../acp/server.js';
import type { AppContext } from '../app.js';
import type {
  AcpJsonRpcError,
  AcpJsonRpcNotification,
  AcpJsonRpcSuccess,
} from '../../acp/types.js';

interface AcpRouteEnv {
  Variables: {
    ctx: AppContext;
  };
}

export const acpRoutes = new Hono<AcpRouteEnv>();

function isPromptRequest(value: unknown): value is {
  jsonrpc?: string;
  id?: string | number | null;
  method: 'session/prompt';
  params?: unknown;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return (value as { method?: unknown }).method === 'session/prompt';
}

function resolveResponseId(value: unknown): string | number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function serializeUnexpectedAcpError(
  rawBody: unknown,
  error: unknown,
): AcpJsonRpcError {
  return {
    jsonrpc: '2.0',
    id: resolveResponseId(rawBody),
    error: {
      code: -32603,
      message: error instanceof Error ? error.message : 'Unexpected ACP HTTP streaming error',
    },
  };
}

async function streamPromptResponse(
  ctx: AppContext,
  rawBody: unknown,
): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const writeMessage = (
        message: AcpJsonRpcNotification | AcpJsonRpcSuccess | AcpJsonRpcError,
      ) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
      };

      try {
        const response = await handleAcpJsonRpc(ctx, rawBody, {
          transport: 'http',
          httpPromptCarrier: 'ndjson',
          notify(message) {
            writeMessage(message);
          },
        });
        if (response !== null) {
          writeMessage(response);
        }
      } catch (error) {
        writeMessage(serializeUnexpectedAcpError(rawBody, error));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-cache',
      'transfer-encoding': 'chunked',
    },
  });
}

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

  const accept = c.req.header('accept') || '';
  const wantsNdjson = accept.includes('application/x-ndjson');
  if (wantsNdjson && isPromptRequest(rawBody)) {
    return streamPromptResponse(ctx, rawBody);
  }

  const response = await handleAcpJsonRpc(ctx, rawBody, {
    transport: 'http',
    httpPromptCarrier: 'ndjson',
  });
  if (response === null) {
    return c.body(null, 204);
  }

  return c.json(response);
});
