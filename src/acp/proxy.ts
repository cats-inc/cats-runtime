import type {
  AcpJsonRpcError,
  AcpJsonRpcNotification,
  AcpJsonRpcSuccess,
} from './types.js';
import type { AcpJsonRpcHandler, AcpJsonRpcResponder } from './stdio.js';

const DEFAULT_RUNTIME_HOST = '127.0.0.1';
const DEFAULT_RUNTIME_PORT = 3110;
const DEFAULT_PROXY_TIMEOUT_MS = 30 * 60 * 1000;
const PROXY_URL_ENV = 'CATS_RUNTIME_ACP_PROXY_URL';
const PROXY_TIMEOUT_ENV = 'CATS_RUNTIME_ACP_PROXY_TIMEOUT_MS';
const API_KEY_ENV = 'CATS_RUNTIME_API_KEY';
const HOST_ENV = 'CATS_RUNTIME_HOST';
const PORT_ENV = 'CATS_RUNTIME_PORT';

export interface AcpProxyTarget {
  url: string;
  authorizationHeader?: string;
}

export interface AcpHttpProxyOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export interface AcpProxyInspection {
  target: {
    url: string | null;
    authorizationConfigured: boolean;
    timeoutMs: number | null;
  };
  probe: {
    status: 'ok' | 'error';
    reason: string;
    message: string;
    httpStatus?: number;
  };
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

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isPromptRequest(message: unknown): boolean {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return false;
  }
  return (message as { method?: unknown }).method === 'session/prompt';
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
      'Set CATS_RUNTIME_ACP_PROXY_URL or provide a positive CATS_RUNTIME_PORT value for ACP proxying.',
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

function isJsonRpcNotification(value: unknown): value is AcpJsonRpcNotification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.jsonrpc === '2.0'
    && typeof record.method === 'string'
    && !('id' in record)
    && !('result' in record)
    && !('error' in record);
}

function createProxyError(
  id: string | number | null,
  message: string,
  reason: string,
  data: Record<string, unknown> = {},
): AcpJsonRpcError {
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

function isProxyTimeoutConfigurationError(message: string): boolean {
  return message.includes(PROXY_TIMEOUT_ENV);
}

function toProxyConfigurationReason(message: string): string {
  return isProxyTimeoutConfigurationError(message)
    ? 'invalid_proxy_timeout'
    : 'invalid_proxy_target';
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

async function* parseNdjsonMessages(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          yield JSON.parse(line) as unknown;
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }

    const trailing = `${buffer}${decoder.decode()}`.trim();
    if (trailing.length > 0) {
      yield JSON.parse(trailing) as unknown;
    }
  } finally {
    reader.releaseLock();
  }
}

async function forwardPromptStream(
  response: Response,
  responder: AcpJsonRpcResponder,
  requestId: string | number | null,
  targetUrl: string,
): Promise<AcpJsonRpcSuccess | AcpJsonRpcError> {
  if (!response.body) {
    return createProxyError(
      requestId,
      `Primary cats-runtime ACP endpoint returned no stream body at ${targetUrl}.`,
      'invalid_upstream_response',
      {
        targetUrl,
        httpStatus: response.status,
      },
    );
  }

  try {
    let finalResponse: AcpJsonRpcSuccess | AcpJsonRpcError | null = null;
    for await (const entry of parseNdjsonMessages(response.body)) {
      if (isJsonRpcNotification(entry)) {
        await responder.notify(entry);
        continue;
      }
      if (isJsonRpcResponse(entry)) {
        finalResponse = entry as AcpJsonRpcSuccess | AcpJsonRpcError;
        continue;
      }
      return createProxyError(
        requestId,
        `Primary cats-runtime ACP endpoint returned a non-JSON-RPC NDJSON entry at ${targetUrl}.`,
        'invalid_upstream_response',
        {
          targetUrl,
          httpStatus: response.status,
        },
      );
    }

    if (finalResponse) {
      return finalResponse;
    }
  } catch (error) {
    return createProxyError(
      requestId,
      `Primary cats-runtime ACP endpoint returned an invalid NDJSON prompt stream at ${targetUrl}.`,
      'invalid_upstream_response',
      {
        targetUrl,
        httpStatus: response.status,
        detail: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return createProxyError(
    requestId,
    `Primary cats-runtime ACP endpoint ended the prompt stream without a terminal JSON-RPC response at ${targetUrl}.`,
    'invalid_upstream_response',
    {
      targetUrl,
      httpStatus: response.status,
    },
  );
}

function projectProxyLifecycleState(value: unknown): unknown {
  return value === 'prompt_enabled_over_http_ndjson'
    ? 'prompt_enabled_over_stdio_proxy'
    : value;
}

function projectProxyResult(
  response: AcpJsonRpcSuccess | AcpJsonRpcError,
  targetUrl: string,
): AcpJsonRpcSuccess | AcpJsonRpcError {
  if (!('result' in response)) {
    return response;
  }

  const result = parseRecord(response.result);
  const meta = parseRecord(result?._meta);
  const catsRuntime = parseRecord(meta?.catsRuntime);
  if (!result || !meta || !catsRuntime) {
    return response;
  }

  return {
    ...response,
    result: {
      ...result,
      _meta: {
        ...meta,
        catsRuntime: {
          ...catsRuntime,
          transport: 'stdio',
          ...(catsRuntime.sessionLifecycle === undefined
            ? {}
            : { sessionLifecycle: projectProxyLifecycleState(catsRuntime.sessionLifecycle) }),
          proxy: {
            mode: 'http_proxy',
            upstreamTransport: 'http',
            targetUrl,
          },
        },
      },
    },
  };
}

export function resolveAcpProxyTarget(
  env: NodeJS.ProcessEnv = process.env,
): AcpProxyTarget {
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
    url: `http://${host}:${port}/acp`,
    authorizationHeader,
  };
}

export function resolveAcpProxyTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const rawTimeout = env[PROXY_TIMEOUT_ENV]?.trim();
  if (!rawTimeout) {
    return DEFAULT_PROXY_TIMEOUT_MS;
  }

  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `Set ${PROXY_TIMEOUT_ENV} to a positive integer number of milliseconds for ACP proxying.`,
    );
  }

  return timeoutMs;
}

export function createHttpAcpProxyHandler(
  options: AcpHttpProxyOptions = {},
): AcpJsonRpcHandler {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return async (message, responder) => {
    const requestId = resolveRequestId(message);
    let target: AcpProxyTarget;
    let timeoutMs: number;

    try {
      target = resolveAcpProxyTarget(env);
      timeoutMs = resolveAcpProxyTimeoutMs(env);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid ACP proxy target';
      return createProxyError(
        requestId,
        message,
        toProxyConfigurationReason(message),
      );
    }

    const headers = new Headers();
    headers.set('content-type', 'application/json');
    const promptProxyRequested = isPromptRequest(message) && Boolean(responder);
    headers.set('accept', promptProxyRequested ? 'application/x-ndjson' : 'application/json');
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
          `Primary cats-runtime ACP endpoint timed out at ${target.url}.`,
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
        `Primary cats-runtime ACP endpoint is unavailable at ${target.url}. Start cats-runtime and retry.`,
        'upstream_unavailable',
        {
          targetUrl: target.url,
          detail: error instanceof Error ? error.message : String(error),
        },
      );
    }

    if (promptProxyRequested && response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/x-ndjson')) {
        const streamed = await forwardPromptStream(
          response,
          responder as AcpJsonRpcResponder,
          requestId,
          target.url,
        );
        return projectProxyResult(streamed, target.url);
      }
    }

    const body = await parseResponseBody(response);
    if (response.status === 204) {
      return null;
    }
    if (isJsonRpcResponse(body)) {
      return projectProxyResult(body as AcpJsonRpcSuccess | AcpJsonRpcError, target.url);
    }
    if (response.status === 401 || response.status === 403) {
      return createProxyError(
        requestId,
        `Primary cats-runtime ACP endpoint rejected the request at ${target.url}.`,
        'upstream_unauthorized',
        {
          targetUrl: target.url,
          httpStatus: response.status,
        },
      );
    }
    if (response.status === 504 || response.status === 408) {
      return createProxyError(
        requestId,
        `Primary cats-runtime ACP endpoint timed out at ${target.url}.`,
        'upstream_timeout',
        {
          targetUrl: target.url,
          httpStatus: response.status,
          timeoutMs,
        },
      );
    }
    return createProxyError(
      requestId,
      `Primary cats-runtime ACP endpoint returned an invalid response at ${target.url}.`,
      'invalid_upstream_response',
      {
        targetUrl: target.url,
        httpStatus: response.status,
      },
    );
  };
}

export async function inspectAcpProxy(
  options: AcpHttpProxyOptions = {},
): Promise<AcpProxyInspection> {
  const env = options.env ?? process.env;
  const authorizationConfigured = Boolean(resolveAuthorizationHeader(env));
  let target: AcpProxyTarget | undefined;
  let timeoutMs: number | undefined;

  try {
    target = resolveAcpProxyTarget(env);
    timeoutMs = resolveAcpProxyTimeoutMs(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid ACP proxy configuration';
    return {
      target: {
        url: target?.url ?? null,
        authorizationConfigured,
        timeoutMs: timeoutMs ?? null,
      },
      probe: {
        status: 'error',
        reason: toProxyConfigurationReason(message),
        message,
      },
    };
  }

  const response = await createHttpAcpProxyHandler(options)({
    jsonrpc: '2.0',
    id: 'proxy-preflight',
    method: 'ping',
  });
  if (response && 'result' in response) {
    return {
      target: {
        url: target.url,
        authorizationConfigured,
        timeoutMs,
      },
      probe: {
        status: 'ok',
        reason: 'reachable',
        message: `Primary cats-runtime ACP endpoint responded to ping at ${target.url}.`,
      },
    };
  }

  const proxyErrorData = response?.error?.data && typeof response.error.data === 'object'
    ? response.error.data as Record<string, unknown>
    : undefined;
  const httpStatus = typeof proxyErrorData?.httpStatus === 'number'
    ? proxyErrorData.httpStatus
    : undefined;

  return {
    target: {
      url: target.url,
      authorizationConfigured,
      timeoutMs,
    },
    probe: {
      status: 'error',
      reason: typeof proxyErrorData?.reason === 'string'
        ? proxyErrorData.reason
        : 'proxy_probe_failed',
      message: response?.error?.message ?? 'Primary cats-runtime ACP endpoint did not return a usable preflight response.',
      ...(typeof httpStatus === 'number' ? { httpStatus } : {}),
    },
  };
}
