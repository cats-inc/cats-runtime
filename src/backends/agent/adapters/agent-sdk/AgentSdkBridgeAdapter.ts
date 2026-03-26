import type {
  AgentRuntimeService,
  SessionProviderState,
  StreamEvent,
} from '../../../../core/types.js';
import { parseSseEvents, readErrorBody } from '../../../../core/streamParsers.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import type {
  AgentAdapter,
  AgentAdapterInspection,
  AgentBackendOptions,
  AgentAdapterProbeCheck,
  AgentInvokeInput,
  AgentAdapterProbeResult,
} from '../../types.js';
import { parseServices, prependInstructions } from '../../utils.js';

const DEFAULT_AGENT_SDK_BASE_URL = 'http://127.0.0.1:8082';

function defaultFetch(): typeof fetch {
  return fetch;
}

function resolveBaseUrl(instance: RemoteProviderInstanceConfig, env: NodeJS.ProcessEnv): string {
  const fromEnv = instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined;
  return fromEnv || instance.baseUrl || DEFAULT_AGENT_SDK_BASE_URL;
}

function resolveAuthToken(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (!instance.authTokenEnv) {
    return undefined;
  }
  return env[instance.authTokenEnv];
}

function mapBridgeProvider(providerName: string): string {
  switch (providerName) {
    case 'codex':
      return 'openai';
    default:
      return providerName;
  }
}

function buildHeaders(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...instance.headers,
  };

  const token = resolveAuthToken(instance, env);
  if (token && !headers.authorization) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}

function buildInspection(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): AgentAdapterInspection {
  const headers = buildHeaders(instance, env);
  const headerNames = Object.keys(headers)
    .filter((name) => name !== 'content-type' && name !== 'accept')
    .sort();

  return {
    adapter: 'agent_sdk_bridge',
    family: 'bridge',
    summary: 'Agent SDK bridge uses runtime-owned HTTP session creation plus SSE message streaming against a provider-managed remote session.',
    endpoint: resolveBaseUrl(instance, env),
    transport: {
      kind: 'http',
      protocol: 'agent_sdk_http_v1',
      liveProbe: 'providers_get',
      modelDiscovery: 'providers_get',
      streaming: 'sse',
    },
    request: {
      headerNames,
    },
    auth: {
      mechanisms: headerNames.includes('authorization') ? ['bearer_header'] : [],
      credentials: [
        {
          kind: 'base_url',
          configured: Boolean(resolveBaseUrl(instance, env)),
        },
        {
          kind: 'auth_token',
          configured: Boolean(resolveAuthToken(instance, env) || headers.authorization),
        },
      ],
    },
    continuity: {
      providerManagedSessions: true,
      sessionKey: true,
      providerSessionState: true,
      cancel: true,
    },
    capabilities: {
      probe: true,
      modelDiscovery: true,
      cancel: true,
      runtimeServices: true,
      toolCallEvents: true,
    },
  };
}

function parseBridgeProviderCapabilities(
  value: unknown,
): { streaming: boolean; mcp: boolean; vision: boolean } {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    streaming: record.streaming === true,
    mcp: record.mcp === true,
    vision: record.vision === true,
  };
}

function parseBridgeProviderRegistry(
  payload: Record<string, unknown>,
  expectedProvider: string,
  configuredModel: string | undefined,
): {
    providerCount: number;
    providerListed: boolean;
    modelCount: number;
    defaultModel?: string;
    configuredModel?: string;
    configuredModelListed?: boolean;
    capabilities: {
      streaming: boolean;
      mcp: boolean;
      vision: boolean;
    };
  } {
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const provider = providers.find((entry) =>
    entry && typeof entry === 'object' && (entry as Record<string, unknown>).name === expectedProvider,
  ) as Record<string, unknown> | undefined;
  const models = Array.isArray(provider?.models)
    ? provider.models.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
  const defaultModel = typeof provider?.default_model === 'string' && provider.default_model.length > 0
    ? provider.default_model
    : undefined;
  const providerListed = Boolean(provider);
  const configuredModelListed = configuredModel
    ? models.includes(configuredModel)
    : undefined;

  return {
    providerCount: providers.length,
    providerListed,
    modelCount: models.length,
    ...(defaultModel ? { defaultModel } : {}),
    ...(configuredModel ? { configuredModel } : {}),
    ...(configuredModelListed !== undefined ? { configuredModelListed } : {}),
    capabilities: parseBridgeProviderCapabilities(provider?.capabilities),
  };
}

function buildProviderState(
  input: AgentInvokeInput,
  bridgeSessionId: string,
  status: string,
  services?: AgentRuntimeService[],
  extra?: Record<string, unknown>,
): SessionProviderState {
  return {
    ...(input.sessionState || {}),
    agentSession: {
      providerSessionId: bridgeSessionId,
      sessionKey: input.sessionKey,
      status,
      services,
      adapterState: {
        bridgeProvider: mapBridgeProvider(input.providerName),
        bridgeSessionId,
        ...(extra || {}),
      },
    },
  };
}

export class AgentSdkBridgeAdapter implements AgentAdapter {
  readonly kind = 'agent_sdk_bridge';

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: AgentBackendOptions = {}) {
    this.fetchImpl = options.fetch || defaultFetch();
  }

  private async createBridgeSession(
    input: AgentInvokeInput,
    bridgeProvider: string,
    baseUrl: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const createResponse = await this.fetchImpl(`${baseUrl}/api/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: bridgeProvider,
        model: input.model || input.instance.model,
        cwd: input.turn.context?.workspace?.cwd,
      }),
      signal: input.signal,
    });

    if (!createResponse.ok) {
      throw new Error(
        `Agent SDK bridge session create failed: ${await readErrorBody(createResponse)}`,
      );
    }

    const payload = await createResponse.json() as Record<string, unknown>;
    if (typeof payload.id !== 'string' || payload.id.length === 0) {
      throw new Error('Agent SDK bridge session create returned no session id');
    }

    return payload.id;
  }

  private async startMessageStream(
    input: AgentInvokeInput,
    baseUrl: string,
    headers: Record<string, string>,
    bridgeSessionId: string,
  ): Promise<Response> {
    return this.fetchImpl(
      `${baseUrl}/api/v1/sessions/${encodeURIComponent(bridgeSessionId)}/messages/stream`,
      {
        method: 'POST',
        headers: {
          ...headers,
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          message: prependInstructions(input.turn.message, input.turn.instructions),
        }),
        signal: input.signal,
      },
    );
  }

  async *invoke(input: AgentInvokeInput): AsyncGenerator<StreamEvent> {
    const env = this.options.env || process.env;
    const baseUrl = resolveBaseUrl(input.instance, env).replace(/\/$/, '');
    const bridgeProvider = mapBridgeProvider(input.providerName);
    const headers = buildHeaders(input.instance, env);

    let bridgeSessionId = input.providerSessionId;
    if (!bridgeSessionId) {
      bridgeSessionId = await this.createBridgeSession(input, bridgeProvider, baseUrl, headers);
    }

    let messageResponse = await this.startMessageStream(input, baseUrl, headers, bridgeSessionId);
    if (messageResponse.status === 404 && input.providerSessionId) {
      bridgeSessionId = await this.createBridgeSession(input, bridgeProvider, baseUrl, headers);
      messageResponse = await this.startMessageStream(input, baseUrl, headers, bridgeSessionId);
    }

    if (!messageResponse.ok) {
      throw new Error(
        `Agent SDK bridge message failed: ${await readErrorBody(messageResponse)}`,
      );
    }

    yield {
      type: 'init',
      providerSessionId: bridgeSessionId,
      providerState: buildProviderState(input, bridgeSessionId, 'active'),
    };

    let usage: StreamEvent['usage'];
    let services: AgentRuntimeService[] | undefined;
    let upstreamProviderSessionId: string | undefined;

    for await (const event of parseSseEvents(messageResponse.body)) {
      if (event.data === '[DONE]') {
        break;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = typeof payload.type === 'string' ? payload.type : undefined;

      if (type === 'session_created') {
        upstreamProviderSessionId = typeof payload.providerSessionId === 'string'
          ? payload.providerSessionId
          : upstreamProviderSessionId;
        continue;
      }

      if (type === 'content' && typeof payload.content === 'string') {
        yield {
          type: 'text',
          providerSessionId: bridgeSessionId,
          text: payload.content,
        };
        continue;
      }

      if (type === 'tool_use') {
        yield {
          type: 'tool_use',
          providerSessionId: bridgeSessionId,
          toolName: typeof payload.toolName === 'string' ? payload.toolName : 'tool',
          toolArgs: payload.toolInput && typeof payload.toolInput === 'object'
            ? payload.toolInput as Record<string, unknown>
            : {},
        };
        continue;
      }

      if (type === 'token_usage' && payload.usage && typeof payload.usage === 'object') {
        const rawUsage = payload.usage as Record<string, unknown>;
        usage = {
          inputTokens: typeof rawUsage.prompt_tokens === 'number' ? rawUsage.prompt_tokens : 0,
          outputTokens: typeof rawUsage.completion_tokens === 'number'
            ? rawUsage.completion_tokens
            : 0,
        };
        continue;
      }

      if (type === 'service_update') {
        services = parseServices(payload.services) || services;
        continue;
      }

      if (type === 'error') {
        yield {
          type: 'error',
          providerSessionId: bridgeSessionId,
          text: typeof payload.error === 'string' ? payload.error : 'Agent SDK bridge error',
          providerState: buildProviderState(input, bridgeSessionId, 'error', services, {
            upstreamProviderSessionId,
          }),
        };
        return;
      }
    }

    yield {
      type: 'result',
      providerSessionId: bridgeSessionId,
      usage,
      services,
      providerState: buildProviderState(input, bridgeSessionId, 'idle', services, {
        upstreamProviderSessionId,
      }),
      metadata: {
        provider: bridgeProvider,
      },
    };
  }

  async probe(instance: RemoteProviderInstanceConfig): Promise<AgentAdapterProbeResult> {
    const env = this.options.env || process.env;
    const baseUrl = resolveBaseUrl(instance, env).replace(/\/$/, '');
    const checkedAt = new Date().toISOString();
    const endpoint = `${baseUrl}/api/v1/providers`;
    const expected = mapBridgeProvider(instance.providerName);
    const configuredModel = instance.model?.trim() || undefined;

    try {
      const response = await this.fetchImpl(endpoint, {
        headers: buildHeaders(instance, env),
      });
      if (!response.ok) {
        return {
          health: {
            status: 'unavailable',
            checkedAt,
            details: await readErrorBody(response),
          },
          liveProbe: {
            endpoint,
            targetProvider: expected,
            ...(configuredModel ? { configuredModel } : {}),
            statusCode: response.status,
          },
        };
      }

      const payload = await response.json() as Record<string, unknown>;
      const registry = parseBridgeProviderRegistry(payload, expected, configuredModel);
      const providerLabel = `${expected} via Agent SDK bridge`;
      const checks: AgentAdapterProbeCheck[] = [
        {
          code: 'bridge_provider_listed',
          status: registry.providerListed ? ('ok' as const) : ('degraded' as const),
          message: registry.providerListed
            ? `${providerLabel} is listed by the bridge provider registry`
            : `${providerLabel} is not listed by the bridge provider registry`,
          details: {
            endpoint,
            targetProvider: expected,
            providerCount: registry.providerCount,
            modelCount: registry.modelCount,
            ...(registry.defaultModel ? { defaultModel: registry.defaultModel } : {}),
            capabilities: registry.capabilities,
          },
        },
        ...(configuredModel
          ? [{
              code: 'bridge_configured_model_visible',
              status: registry.configuredModelListed === true ? ('ok' as const) : ('degraded' as const),
              message: registry.configuredModelListed === true
                ? `Configured model '${configuredModel}' is visible through the bridge provider registry`
                : `Configured model '${configuredModel}' is not visible through the bridge provider registry`,
              details: {
                endpoint,
                targetProvider: expected,
                configuredModel,
                configuredModelListed: registry.configuredModelListed === true,
                modelCount: registry.modelCount,
                ...(registry.defaultModel ? { defaultModel: registry.defaultModel } : {}),
              },
            }]
          : []),
      ];

      return {
        health: {
          status: registry.providerListed ? 'ok' : 'degraded',
          checkedAt,
          details: registry.providerListed
            ? `${expected} available via Agent SDK bridge`
            : `${expected} not listed by Agent SDK bridge`,
        },
        liveProbe: {
          endpoint,
          targetProvider: expected,
          providerCount: registry.providerCount,
          providerListed: registry.providerListed,
          modelCount: registry.modelCount,
          ...(registry.defaultModel ? { defaultModel: registry.defaultModel } : {}),
          ...(configuredModel ? { configuredModel } : {}),
          ...(registry.configuredModelListed !== undefined
            ? { configuredModelListed: registry.configuredModelListed }
            : {}),
          capabilities: registry.capabilities,
        },
        checks,
      };
    } catch (error) {
      return {
        health: {
          status: 'unavailable',
          checkedAt,
          details: error instanceof Error ? error.message : String(error),
        },
        liveProbe: {
          endpoint,
          targetProvider: expected,
          ...(configuredModel ? { configuredModel } : {}),
        },
      };
    }
  }

  async listModels(instance: RemoteProviderInstanceConfig): Promise<Array<{ id: string; label: string }>> {
    const env = this.options.env || process.env;
    const baseUrl = resolveBaseUrl(instance, env).replace(/\/$/, '');
    const response = await this.fetchImpl(`${baseUrl}/api/v1/providers`, {
      headers: buildHeaders(instance, env),
    });

    if (!response.ok) {
      throw new Error(`Agent SDK bridge model list failed: ${await readErrorBody(response)}`);
    }

    const payload = await response.json() as Record<string, unknown>;
    const expected = mapBridgeProvider(instance.providerName);
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const provider = providers.find((entry) =>
      entry && typeof entry === 'object' && (entry as Record<string, unknown>).name === expected,
    ) as Record<string, unknown> | undefined;
    const models = Array.isArray(provider?.models) ? provider.models : [];
    return models
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .map((entry) => ({ id: entry, label: entry }));
  }

  async cancel(
    _sessionId: string,
    instance: RemoteProviderInstanceConfig,
    state?: SessionProviderState,
  ): Promise<void> {
    const env = this.options.env || process.env;
    const baseUrl = resolveBaseUrl(instance, env).replace(/\/$/, '');
    const bridgeSessionId = state?.agentSession?.providerSessionId;
    if (!bridgeSessionId) {
      return;
    }

    await this.fetchImpl(`${baseUrl}/api/v1/sessions/${encodeURIComponent(bridgeSessionId)}/abort`, {
      method: 'POST',
      headers: buildHeaders(instance, env),
    });
  }

  inspect(instance: RemoteProviderInstanceConfig): AgentAdapterInspection {
    return buildInspection(instance, this.options.env || process.env);
  }
}
