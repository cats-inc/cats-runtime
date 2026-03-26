import type { RemoteProviderInstanceConfig } from '../../backends/cli/config.js';

export type RemoteModelDiscoveryAuthMode =
  | 'none'
  | 'bearer'
  | 'x-api-key'
  | 'x-goog-api-key';

export type RemoteModelDiscoveryTarget = 'endpoint' | 'models' | 'model_tags';

export interface RemoteModelDiscoveryHttpRequest {
  url: string;
  displayUrl: string;
  method: 'GET';
  headers: Record<string, string>;
}

export interface RemoteModelDiscoveryRequest extends RemoteModelDiscoveryHttpRequest {
  headerNames: string[];
  target: RemoteModelDiscoveryTarget;
  auth: {
    mode: RemoteModelDiscoveryAuthMode;
    required: boolean;
    applied: boolean;
    credentialEnv?: string;
  };
}

export interface RemoteModelDiscoveryFetchOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RemoteModelDiscoveryFetchResult {
  response: Response;
  latencyMs: number;
}

export const DEFAULT_REMOTE_MODEL_DISCOVERY_TIMEOUT_MS = 5_000;

abstract class RemoteModelDiscoveryFetchError extends Error {
  constructor(
    name: string,
    message: string,
    readonly displayUrl: string,
    readonly latencyMs: number,
  ) {
    super(message);
    this.name = name;
  }
}

export class RemoteModelDiscoveryTimeoutError extends RemoteModelDiscoveryFetchError {
  constructor(displayUrl: string, latencyMs: number) {
    super(
      'RemoteModelDiscoveryTimeoutError',
      `Remote discovery request timed out for '${displayUrl}'`,
      displayUrl,
      latencyMs,
    );
  }
}

export class RemoteModelDiscoveryAbortError extends RemoteModelDiscoveryFetchError {
  constructor(displayUrl: string, latencyMs: number) {
    super(
      'RemoteModelDiscoveryAbortError',
      `Remote discovery request was aborted for '${displayUrl}'`,
      displayUrl,
      latencyMs,
    );
  }
}

export function resolveRemoteEndpoint(
  instance: RemoteProviderInstanceConfig,
  env?: Readonly<NodeJS.ProcessEnv>,
): string | null {
  const resolvedUrl = instance.urlEnv && env?.[instance.urlEnv]
    ? env[instance.urlEnv]!
    : instance.url;
  const resolvedBaseUrl = instance.baseUrlEnv && env?.[instance.baseUrlEnv]
    ? env[instance.baseUrlEnv]!
    : instance.baseUrl;
  if (instance.transport === 'openclaw' || instance.transport === 'openclaw_gateway') {
    return resolvedUrl || resolvedBaseUrl || null;
  }
  if (instance.transport === 'agent_sdk' || instance.transport === 'agent_sdk_bridge') {
    return resolvedBaseUrl || 'http://127.0.0.1:8082';
  }
  if (instance.transport === 'anthropic') {
    return resolvedBaseUrl || 'https://api.anthropic.com';
  }
  if (instance.transport === 'openai') {
    return resolvedBaseUrl || 'https://api.openai.com';
  }
  if (instance.transport === 'google' || instance.transport === 'gemini') {
    return resolvedBaseUrl || 'https://generativelanguage.googleapis.com';
  }
  if (instance.transport === 'ollama') {
    return resolvedBaseUrl || 'http://127.0.0.1:11434';
  }
  return resolvedBaseUrl || resolvedUrl || null;
}

export function sanitizeRemoteModelDiscoveryUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    url.searchParams.set(key, '[redacted]');
  }
  return url.toString();
}

function endsWithPathSegments(pathSegments: string[], suffixSegments: string[]): boolean {
  if (suffixSegments.length > pathSegments.length) {
    return false;
  }

  return suffixSegments.every((segment, index) =>
    pathSegments[pathSegments.length - suffixSegments.length + index] === segment,
  );
}

function appendProbePath(
  endpoint: string,
  baseSegments: readonly string[],
  fullSegments: readonly string[],
): string {
  const url = new URL(endpoint);
  const pathSegments = url.pathname.split('/').filter(Boolean);
  let resolvedSegments = [...pathSegments];

  if (!endsWithPathSegments(pathSegments, [...fullSegments])) {
    if (endsWithPathSegments(pathSegments, [...baseSegments])) {
      resolvedSegments = [
        ...pathSegments,
        ...fullSegments.slice(baseSegments.length),
      ];
    } else {
      resolvedSegments = [
        ...pathSegments,
        ...fullSegments,
      ];
    }
  }

  url.pathname = `/${resolvedSegments.join('/')}`;
  return url.toString();
}

function hasAppliedAuthHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((headerName) => {
    const normalized = headerName.toLowerCase();
    return normalized === 'authorization'
      || normalized === 'x-api-key'
      || normalized === 'x-goog-api-key';
  });
}

export function buildRemoteModelDiscoveryRequest(
  instance: RemoteProviderInstanceConfig,
  env: Readonly<NodeJS.ProcessEnv>,
): RemoteModelDiscoveryRequest | null {
  const endpoint = resolveRemoteEndpoint(instance, env);
  if (!endpoint) {
    return null;
  }

  const requiresApiKey = instance.transport === 'anthropic'
    || instance.transport === 'openai'
    || instance.transport === 'google'
    || instance.transport === 'gemini';
  let url = endpoint;
  let target: RemoteModelDiscoveryTarget = 'endpoint';
  let authMode: RemoteModelDiscoveryAuthMode = 'none';
  const headers: Record<string, string> = {};

  if (instance.transport === 'anthropic') {
    url = appendProbePath(endpoint, ['v1'], ['v1', 'models']);
    target = 'models';
    authMode = 'x-api-key';
    if (instance.apiKeyEnv && env[instance.apiKeyEnv]) {
      headers['x-api-key'] = env[instance.apiKeyEnv]!;
    }
    headers['anthropic-version'] = '2023-06-01';
  } else if (instance.transport === 'openai') {
    url = appendProbePath(endpoint, ['v1'], ['v1', 'models']);
    target = 'models';
    authMode = 'bearer';
    if (instance.apiKeyEnv && env[instance.apiKeyEnv]) {
      headers.authorization = `Bearer ${env[instance.apiKeyEnv]!}`;
    }
    if (instance.organizationEnv && env[instance.organizationEnv]) {
      headers['OpenAI-Organization'] = env[instance.organizationEnv]!;
    }
    if (instance.projectEnv && env[instance.projectEnv]) {
      headers['OpenAI-Project'] = env[instance.projectEnv]!;
    }
  } else if (instance.transport === 'google' || instance.transport === 'gemini') {
    url = appendProbePath(endpoint, ['v1beta'], ['v1beta', 'models']);
    target = 'models';
    authMode = 'x-goog-api-key';
    if (instance.apiKeyEnv && env[instance.apiKeyEnv]) {
      headers['x-goog-api-key'] = env[instance.apiKeyEnv]!;
    }
  } else if (instance.transport === 'ollama') {
    url = appendProbePath(endpoint, ['api'], ['api', 'tags']);
    target = 'model_tags';
  }

  const mergedHeaders = {
    ...headers,
    ...instance.headers,
  };

  return {
    url,
    displayUrl: sanitizeRemoteModelDiscoveryUrl(url),
    method: 'GET',
    headers: mergedHeaders,
    headerNames: Object.keys(mergedHeaders).sort(),
    target,
    auth: {
      mode: authMode,
      required: requiresApiKey,
      applied: hasAppliedAuthHeader(mergedHeaders),
      ...(instance.apiKeyEnv ? { credentialEnv: instance.apiKeyEnv } : {}),
    },
  };
}

function defaultFetch(): typeof fetch {
  return fetch;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function fetchRemoteModelDiscovery(
  request: RemoteModelDiscoveryHttpRequest,
  options: RemoteModelDiscoveryFetchOptions = {},
): Promise<RemoteModelDiscoveryFetchResult> {
  const fetchImpl = options.fetch || defaultFetch();
  const timeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_MODEL_DISCOVERY_TIMEOUT_MS;
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  let externallyAborted = false;
  const onAbort = () => {
    externallyAborted = true;
    controller.abort();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      externallyAborted = true;
      controller.abort();
    } else {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }

  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      ...(Object.keys(request.headers).length > 0 ? { headers: request.headers } : {}),
      signal: controller.signal,
    });

    return {
      response,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (timedOut && isAbortError(error)) {
      throw new RemoteModelDiscoveryTimeoutError(request.displayUrl, latencyMs);
    }
    if (externallyAborted && isAbortError(error)) {
      throw new RemoteModelDiscoveryAbortError(request.displayUrl, latencyMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (options.signal) {
      options.signal.removeEventListener('abort', onAbort);
    }
  }
}
