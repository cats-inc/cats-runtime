import type { McpJsonRpcError, McpJsonRpcSuccess } from './types.js';
import type { McpJsonRpcHandler } from './stdio.js';

const DEFAULT_RUNTIME_HOST = '127.0.0.1';
const DEFAULT_RUNTIME_PORT = 3110;
const DEFAULT_PROXY_TIMEOUT_MS = 30 * 60 * 1000;
const PROXY_URL_ENV = 'CATS_RUNTIME_MCP_PROXY_URL';
const PROXY_TIMEOUT_ENV = 'CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS';
const API_KEY_ENV = 'CATS_RUNTIME_API_KEY';
const HOST_ENV = 'CATS_RUNTIME_HOST';
const PORT_ENV = 'CATS_RUNTIME_PORT';

export interface McpProxyTarget {
  url: string;
  authorizationHeader?: string;
}

export interface McpHttpProxyOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

interface JsonRpcResponseRecord {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    data?: unknown;
  };
}

function normalizeHost(rawHost: string | undefined): string {
  const trimmed = rawHost?.trim();
  if (!trimmed) {
    return DEFAULT_RUNTIME_HOST;
  }
  if (trimmed === '0.0.0.0' || trimmed === '::' || trimmed === '[::]') {
    return DEFAULT_RUNTIME_HOST;
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed;
  }
  return trimmed.includes(':') ? `[${trimmed}]` : trimmed;
}

function parsePort(rawPort: string | undefined): number {
  if (!rawPort?.trim()) {
    return DEFAULT_RUNTIME_PORT;
  }

  const port = Number.parseInt(rawPort.trim(), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      'Set CATS_RUNTIME_MCP_PROXY_URL or provide a positive CATS_RUNTIME_PORT value for MCP proxying.',
    );
  }

  return port;
}

function resolveAuthorizationHeader(env: NodeJS.ProcessEnv): string | undefined {
  const apiKey = env[API_KEY_ENV]?.trim();
  if (!apiKey) {
    return undefined;
  }
  return `Bearer ${apiKey}`;
}

export function resolveMcpProxyTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const rawTimeout = env[PROXY_TIMEOUT_ENV]?.trim();
  if (!rawTimeout) {
    return DEFAULT_PROXY_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Set ${PROXY_TIMEOUT_ENV} to a positive integer number of milliseconds for MCP proxying.`,
    );
  }

  return timeoutMs;
}

function resolveExplicitProxyUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${PROXY_URL_ENV} value '${rawUrl}'`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${PROXY_URL_ENV} must use http or https`);
  }

  return parsed.toString();
}

function resolveRequestId(message: unknown): string | number | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return null;
  }

  const id = (message as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== '2.0') {
    return false;
  }

  return 'result' in record || 'error' in record;
}

function createProxyError(
  id: string | number | null,
  message: string,
  reason: string,
  data: Record<string, unknown> = {},
): McpJsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32603,
      message,
      data: {
        reason,
        ...data,
      },
    },
  };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function resolveMcpProxyTarget(
  env: NodeJS.ProcessEnv = process.env,
): McpProxyTarget {
  const explicitProxyUrl = env[PROXY_URL_ENV]?.trim();
  const authorizationHeader = resolveAuthorizationHeader(env);
  if (explicitProxyUrl) {
    return {
      url: resolveExplicitProxyUrl(explicitProxyUrl),
      authorizationHeader,
    };
  }

  const host = normalizeHost(env[HOST_ENV]);
  const port = parsePort(env[PORT_ENV]);
  return {
    url: `http://${host}:${port}/mcp`,
    authorizationHeader,
  };
}

export function createHttpMcpProxyHandler(
  options: McpHttpProxyOptions = {},
): McpJsonRpcHandler {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return async (message) => {
    const requestId = resolveRequestId(message);
    let target: McpProxyTarget;
    let timeoutMs: number;

    try {
      target = resolveMcpProxyTarget(env);
      timeoutMs = resolveMcpProxyTimeoutMs(env);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid MCP proxy target';
      const reason = typeof message === 'string' && message.includes(PROXY_TIMEOUT_ENV)
        ? 'invalid_proxy_timeout'
        : 'invalid_proxy_target';
      return createProxyError(
        requestId,
        message,
        reason,
      );
    }

    const headers = new Headers();
    headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');
    if (target.authorizationHeader) {
      headers.set('authorization', target.authorizationHeader);
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(target.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: timeoutSignal,
      });
    } catch (error) {
      if (timeoutSignal.aborted) {
        return createProxyError(
          requestId,
          `Primary cats-runtime MCP endpoint timed out after ${timeoutMs}ms at ${target.url}.`,
          'upstream_timeout',
          {
            targetUrl: target.url,
            timeoutMs,
            detail: error instanceof Error ? error.message : String(error),
          },
        );
      }
      return createProxyError(
        requestId,
        `Primary cats-runtime MCP endpoint is unavailable at ${target.url}. Start cats-runtime and retry.`,
        'upstream_unavailable',
        {
          targetUrl: target.url,
          detail: error instanceof Error ? error.message : String(error),
        },
      );
    }

    if (response.status === 204) {
      return null;
    }

    const body = await parseResponseBody(response);
    if (isJsonRpcResponse(body)) {
      return body as McpJsonRpcSuccess | McpJsonRpcError;
    }

    if (response.status === 408 || response.status === 504) {
      return createProxyError(
        requestId,
        `Primary cats-runtime MCP endpoint timed out after ${timeoutMs}ms at ${target.url}.`,
        'upstream_timeout',
        {
          targetUrl: target.url,
          timeoutMs,
          httpStatus: response.status,
          upstreamBody: body,
        },
      );
    }

    if (response.status === 401 || response.status === 403) {
      return createProxyError(
        requestId,
        `Primary cats-runtime MCP endpoint rejected authentication at ${target.url}.`,
        'upstream_unauthorized',
        {
          targetUrl: target.url,
          httpStatus: response.status,
          upstreamBody: body,
        },
      );
    }

    return createProxyError(
      requestId,
      `Primary cats-runtime MCP endpoint returned an invalid response at ${target.url}.`,
      'invalid_upstream_response',
      {
        targetUrl: target.url,
        httpStatus: response.status,
        upstreamBody: body,
      },
    );
  };
}
