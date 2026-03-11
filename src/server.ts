import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { AgentFleetBackend } from './adapters/agentFleetBackend.js';
import { loadConfig } from './core/config.js';
import {
  readRequestBody,
  relayUpstreamResponse,
  sendJson,
  sendMethodNotAllowed,
  sendNotFound,
  sendProxyError,
} from './core/http.js';
import type { RuntimeConfig } from './core/types.js';

export interface RuntimeServer {
  server: Server;
  start(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

const ROUTE_METHODS = new Map<string, string[]>([
  ['/health', ['GET']],
  ['/sessions', ['GET', 'POST']],
  ['/kiro/models', ['GET']],
]);

function matchesSessionRoute(pathname: string): boolean {
  return /^\/sessions\/[^/]+$/u.test(pathname);
}

function matchesMessageRoute(pathname: string): boolean {
  return /^\/sessions\/[^/]+\/messages$/u.test(pathname);
}

function matchesCloseRoute(pathname: string): boolean {
  return /^\/sessions\/[^/]+\/close$/u.test(pathname);
}

function isAuthorized(request: IncomingMessage, config: RuntimeConfig): boolean {
  if (!config.apiKey) {
    return true;
  }
  return request.headers.authorization === `Bearer ${config.apiKey}`;
}

function allowedMethodsFor(pathname: string): string[] | null {
  const direct = ROUTE_METHODS.get(pathname);
  if (direct) {
    return direct;
  }
  if (matchesSessionRoute(pathname)) {
    return ['GET'];
  }
  if (matchesMessageRoute(pathname)) {
    return ['POST'];
  }
  if (matchesCloseRoute(pathname)) {
    return ['POST'];
  }
  return null;
}

function upstreamHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof request.headers.accept === 'string' && request.headers.accept) {
    headers.accept = request.headers.accept;
  }
  if (
    typeof request.headers['content-type'] === 'string'
    && request.headers['content-type']
  ) {
    headers['content-type'] = request.headers['content-type'];
  }
  return headers;
}

async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  backend: AgentFleetBackend,
  path: string,
): Promise<void> {
  const abortController = new AbortController();
  request.on('close', () => abortController.abort());

  try {
    const body = request.method === 'GET' ? undefined : await readRequestBody(request);
    const upstream = await backend.request(path, {
      method: request.method,
      body,
      headers: upstreamHeaders(request),
      signal: abortController.signal,
    });
    await relayUpstreamResponse(response, upstream);
  } catch (error) {
    sendProxyError(response, error);
  }
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: RuntimeConfig,
  backend: AgentFleetBackend,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (!isAuthorized(request, config)) {
    sendJson(response, 401, { error: 'Unauthorized' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    const health = await backend.getHealth();
    sendJson(response, health.status === 'ok' ? 200 : 503, health);
    return;
  }

  const allowedMethods = allowedMethodsFor(url.pathname);
  if (!allowedMethods) {
    sendNotFound(response);
    return;
  }

  if (!allowedMethods.includes(request.method ?? 'GET')) {
    sendMethodNotAllowed(response, allowedMethods);
    return;
  }

  await proxyRequest(request, response, backend, `${url.pathname}${url.search}`);
}

export function createRuntimeServer(
  config: RuntimeConfig = loadConfig(),
  backend: AgentFleetBackend = new AgentFleetBackend(config),
): RuntimeServer {
  const server = createServer((request, response) => {
    void handleRequest(request, response, config, backend).catch((error) => {
      sendProxyError(response, error);
    });
  });

  return {
    server,
    async start() {
      server.listen(config.port, config.host);
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        return { host: config.host, port: config.port };
      }
      return { host: address.address, port: address.port };
    },
    async close() {
      if (!server.listening) {
        return;
      }
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close();
      await once(server, 'close');
    },
  };
}
