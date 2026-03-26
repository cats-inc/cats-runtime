import type { RemoteProviderInstanceConfig } from '../../backends/cli/config.js';

export type RemoteModelDiscoveryAuthMode =
  | 'none'
  | 'bearer'
  | 'x-api-key'
  | 'x-goog-api-key';

export type RemoteModelDiscoveryTarget = 'endpoint' | 'models' | 'model_tags';

export interface RemoteModelDiscoveryRequest {
  url: string;
  displayUrl: string;
  method: 'GET';
  headers: Record<string, string>;
  headerNames: string[];
  target: RemoteModelDiscoveryTarget;
  auth: {
    mode: RemoteModelDiscoveryAuthMode;
    required: boolean;
    applied: boolean;
    credentialEnv?: string;
  };
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
