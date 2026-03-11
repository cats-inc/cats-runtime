import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }

  return Buffer.concat(chunks);
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    ...headers,
  });
  response.end(body);
}

export function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, { error: 'Route not found' });
}

export function sendMethodNotAllowed(
  response: ServerResponse,
  allowedMethods: string[],
): void {
  sendJson(
    response,
    405,
    { error: `Method not allowed. Allowed: ${allowedMethods.join(', ')}` },
    { allow: allowedMethods.join(', ') },
  );
}

export function sendProxyError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  sendJson(response, 502, { error: `Failed to reach agent-fleet: ${message}` });
}

export async function relayUpstreamResponse(
  response: ServerResponse,
  upstream: Response,
): Promise<void> {
  const headers: Record<string, string> = {};
  for (const name of ['content-type', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value) {
      headers[name] = value;
    }
  }

  response.writeHead(upstream.status, headers);

  if (!upstream.body) {
    response.end();
    return;
  }

  const stream = Readable.fromWeb(upstream.body as globalThis.ReadableStream<Uint8Array>);
  await pipeline(stream, response);
}
