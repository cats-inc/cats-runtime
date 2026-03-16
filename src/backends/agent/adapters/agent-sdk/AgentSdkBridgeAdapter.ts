import type {
  AgentRuntimeService,
  HealthStatus,
  SessionProviderState,
  StreamEvent,
} from '../../../../core/types.js';
import { parseSseEvents, readErrorBody } from '../../../../core/streamParsers.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import type { AgentAdapter, AgentBackendOptions, AgentInvokeInput } from '../../types.js';

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

function prependInstructions(message: string, instructions?: string): string {
  if (!instructions) {
    return message;
  }

  return `${instructions.trim()}\n\n${message}`;
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

function parseServices(value: unknown): AgentRuntimeService[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const services = value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const record = entry as Record<string, unknown>;
    return [{
      id: typeof record.id === 'string' ? record.id : `service-${index + 1}`,
      name: typeof record.name === 'string'
        ? record.name
        : typeof record.label === 'string'
          ? record.label
          : `service-${index + 1}`,
      url: typeof record.url === 'string' ? record.url : undefined,
      status: typeof record.status === 'string' ? record.status : undefined,
      metadata: record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : undefined,
    }];
  });

  return services.length > 0 ? services : undefined;
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

  async *invoke(input: AgentInvokeInput): AsyncGenerator<StreamEvent> {
    const env = this.options.env || process.env;
    const baseUrl = resolveBaseUrl(input.instance, env).replace(/\/$/, '');
    const bridgeProvider = mapBridgeProvider(input.providerName);
    const headers = buildHeaders(input.instance, env);

    let bridgeSessionId = input.providerSessionId;
    if (!bridgeSessionId) {
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
      bridgeSessionId = payload.id;
    }

    yield {
      type: 'init',
      providerSessionId: bridgeSessionId,
      providerState: buildProviderState(input, bridgeSessionId, 'active'),
    };

    const messageResponse = await this.fetchImpl(
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

    if (!messageResponse.ok) {
      throw new Error(
        `Agent SDK bridge message failed: ${await readErrorBody(messageResponse)}`,
      );
    }

    let usage: StreamEvent['usage'];
    let services: AgentRuntimeService[] | undefined;
    let upstreamProviderSessionId: string | undefined;

    for await (const event of parseSseEvents(messageResponse.body)) {
      if (event.data === '[DONE]') {
        break;
      }

      const payload = JSON.parse(event.data) as Record<string, unknown>;
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

  async probe(instance: RemoteProviderInstanceConfig): Promise<HealthStatus> {
    const env = this.options.env || process.env;
    const baseUrl = resolveBaseUrl(instance, env).replace(/\/$/, '');

    try {
      const response = await this.fetchImpl(`${baseUrl}/api/v1/providers`, {
        headers: buildHeaders(instance, env),
      });
      if (!response.ok) {
        return {
          status: 'unavailable',
          checkedAt: new Date().toISOString(),
          details: await readErrorBody(response),
        };
      }

      const payload = await response.json() as Record<string, unknown>;
      const providers = Array.isArray(payload.providers) ? payload.providers : [];
      const expected = mapBridgeProvider(instance.providerName);
      const supported = providers.some((entry) =>
        entry && typeof entry === 'object' && (entry as Record<string, unknown>).name === expected,
      );

      return {
        status: supported ? 'ok' : 'degraded',
        checkedAt: new Date().toISOString(),
        details: supported
          ? `${expected} available via Agent SDK bridge`
          : `${expected} not listed by Agent SDK bridge`,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        checkedAt: new Date().toISOString(),
        details: error instanceof Error ? error.message : String(error),
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
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const expected = mapBridgeProvider(instance.providerName);
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
}
