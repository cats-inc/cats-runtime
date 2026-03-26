import { randomUUID } from 'node:crypto';
import type {
  AgentRuntimeService,
  SessionArtifact,
  SessionProviderState,
  StreamEvent,
} from '../../../../core/types.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import type {
  AgentAdapter,
  AgentAdapterInspection,
  AgentBackendOptions,
  AgentInvokeInput,
  AgentAdapterProbeResult,
} from '../../types.js';
import { parseRecord, parseServices, prependInstructions, readString } from '../../utils.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_CLIENT_ID = 'cats-runtime';
const DEFAULT_CLIENT_MODE = 'backend';
const DEFAULT_CLIENT_VERSION = '0.1.0';
const DEFAULT_ROLE = 'operator';
const DEFAULT_SCOPES = ['operator.admin'];
const PROTOCOL_VERSION = 3;

interface GatewayRequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

interface GatewayResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: unknown;
}

interface GatewayEventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
}

interface GatewayModelCatalogEntry {
  id: string;
  label: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

type QueueItem = StreamEvent | Error | null;

class AsyncQueue {
  private readonly items: QueueItem[] = [];
  private resolver?: () => void;

  push(item: QueueItem): void {
    this.items.push(item);
    this.resolver?.();
    this.resolver = undefined;
  }

  async shift(): Promise<QueueItem> {
    while (this.items.length === 0) {
      await new Promise<void>((resolve) => {
        this.resolver = resolve;
      });
    }

    return this.items.shift()!;
  }
}

function requireUrl(instance: RemoteProviderInstanceConfig, env: NodeJS.ProcessEnv): string {
  const resolved = (instance.urlEnv ? env[instance.urlEnv] : undefined)
    || instance.url
    || (instance.baseUrlEnv ? env[instance.baseUrlEnv] : undefined)
    || instance.baseUrl;
  if (!resolved) {
    throw new Error(`OpenClaw instance '${instance.providerName}/${instance.id}' is missing url`);
  }
  if (!/^wss?:\/\//i.test(resolved)) {
    throw new Error(`OpenClaw url must start with ws:// or wss://, got '${resolved}'`);
  }
  return resolved;
}

function resolveHeaders(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): Record<string, string> | undefined {
  const headers: Record<string, string> = {
    ...(instance.headers || {}),
  };
  const authToken = instance.authTokenEnv ? env[instance.authTokenEnv] : undefined;
  if (authToken && !headers.authorization && !headers['x-openclaw-token']) {
    headers.authorization = `Bearer ${authToken}`;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function buildInspection(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): AgentAdapterInspection {
  const endpoint = (() => {
    try {
      return requireUrl(instance, env);
    } catch {
      return undefined;
    }
  })();
  const headers = resolveHeaders(instance, env);
  const auth = resolveAuth(instance, env);

  return {
    adapter: 'openclaw',
    family: 'gateway',
    summary: `OpenClaw gateway exposes provider-managed session continuity over websocket RPC, with runtime-visible health and model-catalog probes.`,
    endpoint,
    transport: {
      kind: 'websocket',
      protocol: 'openclaw_gateway_v3',
      liveProbe: 'rpc_health',
      modelDiscovery: 'models_list',
      streaming: 'agent_event_frames',
    },
    request: {
      headerNames: Object.keys(headers || {}).sort(),
    },
    auth: {
      mechanisms: [
        ...(auth ? ['connect_auth' as const] : []),
        ...(headers && Object.keys(headers).length > 0 ? ['handshake_header' as const] : []),
      ],
      credentials: [
        {
          kind: 'url',
          configured: Boolean(endpoint),
        },
        {
          kind: 'auth_token',
          configured: Boolean(
            (instance.authTokenEnv && env[instance.authTokenEnv])
            || headers?.authorization
            || headers?.['x-openclaw-token'],
          ),
        },
        {
          kind: 'password',
          configured: Boolean(instance.passwordEnv && env[instance.passwordEnv]),
        },
      ],
    },
    continuity: {
      providerManagedSessions: true,
      sessionKey: true,
      providerSessionState: true,
      cancel: false,
    },
    capabilities: {
      probe: true,
      modelDiscovery: true,
      cancel: false,
      runtimeServices: true,
      toolCallEvents: false,
    },
  };
}

function resolveAuth(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): { token?: string; password?: string } | undefined {
  const authToken = instance.authTokenEnv ? env[instance.authTokenEnv] : undefined;
  const password = instance.passwordEnv ? env[instance.passwordEnv] : undefined;
  if (!authToken && !password) {
    return undefined;
  }

  return {
    ...(authToken ? { token: authToken } : {}),
    ...(password ? { password } : {}),
  };
}

function buildConnectParams(
  instance: RemoteProviderInstanceConfig,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  return {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: {
      id: instance.clientId || DEFAULT_CLIENT_ID,
      version: instance.clientVersion || DEFAULT_CLIENT_VERSION,
      platform: process.platform,
      mode: instance.clientMode || DEFAULT_CLIENT_MODE,
    },
    role: instance.role || DEFAULT_ROLE,
    scopes: instance.scopes || DEFAULT_SCOPES,
    auth: resolveAuth(instance, env),
  };
}

function mergePayloadTemplate(
  template: Record<string, unknown> | undefined,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(template || {}),
    ...payload,
  };
}

function parseArtifacts(value: unknown): SessionArtifact[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const artifacts = value.flatMap((entry, index) => {
      const record = parseRecord(entry);
      if (!record) {
        return [];
      }

      const path = readString(record.path);
      const uri = readString(record.uri);
      const id = readString(record.id) || path || uri || `artifact-${index + 1}`;
      return [{
        id,
        kind: readString(record.kind),
        label: readString(record.label) || readString(record.name),
        path,
        uri,
        mediaType: readString(record.mediaType) || readString(record.mimeType),
        createdAt: readString(record.createdAt),
        sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : undefined,
        metadata: parseRecord(record.metadata) || undefined,
      } satisfies SessionArtifact];
    });

  return artifacts.length > 0 ? artifacts : undefined;
}

function buildProviderState(
  input: AgentInvokeInput,
  runId: string,
  status: string,
  summary: string | undefined,
  services: AgentRuntimeService[] | undefined,
  raw: Record<string, unknown> | null,
): SessionProviderState {
  return {
    ...(input.sessionState || {}),
    agentSession: {
      providerSessionId: input.sessionKey,
      sessionKey: input.sessionKey,
      runId,
      status,
      summary,
      services,
      adapterState: raw || undefined,
    },
  };
}

function summarizeHealthPayload(payload: unknown, url: string): string {
  const record = parseRecord(payload);
  if (!record) {
    return `Gateway health RPC succeeded for ${url}`;
  }

  const agents = Array.isArray(record.agents) ? record.agents.length : 0;
  const sessions = parseRecord(record.sessions);
  const sessionCount = typeof sessions?.count === 'number' ? sessions.count : undefined;
  const channelOrder = Array.isArray(record.channelOrder) ? record.channelOrder.length : 0;
  const durationMs = typeof record.durationMs === 'number' ? record.durationMs : undefined;
  const detailParts = [
    `Gateway health RPC succeeded for ${url}`,
    ...(channelOrder > 0 ? [`${channelOrder} channel(s)`] : []),
    ...(agents > 0 ? [`${agents} agent(s)`] : []),
    ...(sessionCount !== undefined ? [`${sessionCount} session(s)`] : []),
    ...(durationMs !== undefined ? [`${durationMs}ms snapshot`] : []),
  ];

  return detailParts.join(' | ');
}

function buildGatewayHealthProbeSnapshot(
  payload: unknown,
  url: string,
): {
    endpoint: string;
    agentCount: number;
    channelCount: number;
    linkedChannels: string[];
    sessionCount?: number;
    defaultAgentId?: string;
    latencyMs?: number;
  } {
  const record = parseRecord(payload);
  const agents = Array.isArray(record?.agents)
    ? record.agents.filter((entry) => parseRecord(entry))
    : [];
  const channels = parseRecord(record?.channels);
  const channelNames = Array.isArray(record?.channelOrder)
    ? record.channelOrder.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : Object.keys(channels || {});
  const linkedChannels = channelNames.filter((name) => {
    const channel = parseRecord(channels?.[name]);
    return channel?.linked === true;
  });
  const sessions = parseRecord(record?.sessions);
  const sessionCount = typeof sessions?.count === 'number' ? sessions.count : undefined;
  const defaultAgentId = readString(record?.defaultAgentId) || undefined;
  const latencyMs = typeof record?.durationMs === 'number' ? record.durationMs : undefined;

  return {
    endpoint: url,
    agentCount: agents.length,
    channelCount: channelNames.length,
    linkedChannels,
    ...(sessionCount !== undefined ? { sessionCount } : {}),
    ...(defaultAgentId ? { defaultAgentId } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
  };
}

function canonicalGatewayModelRef(provider: string, modelId: string): string {
  return modelId.toLowerCase().startsWith(`${provider.toLowerCase()}/`)
    ? modelId
    : `${provider}/${modelId}`;
}

function buildGatewayModelLabel(
  provider: string,
  modelId: string,
  name?: string,
): string {
  const canonicalRef = canonicalGatewayModelRef(provider, modelId);
  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName === modelId || trimmedName === canonicalRef) {
    return canonicalRef;
  }

  return `${trimmedName} (${provider})`;
}

function parseGatewayModelCatalog(payload: unknown): GatewayModelCatalogEntry[] {
  const record = parseRecord(payload);
  const rawEntries = Array.isArray(record?.models) ? record.models : [];
  const deduped = new Map<string, GatewayModelCatalogEntry>();

  for (const entry of rawEntries) {
    const entryRecord = parseRecord(entry);
    const modelId = readString(entryRecord?.id)?.trim();
    const provider = readString(entryRecord?.provider)?.trim();
    if (!modelId || !provider) {
      continue;
    }

    const canonicalId = canonicalGatewayModelRef(provider, modelId);
    deduped.set(canonicalId, {
      id: canonicalId,
      label: buildGatewayModelLabel(provider, modelId, readString(entryRecord?.name)),
    });
  }

  return [...deduped.values()];
}

class GatewayWsClient {
  private readonly pending = new Map<string, PendingRequest>();
  private challengeResolve!: (nonce: string) => void;
  private challengeReject!: (error: Error) => void;
  private readonly challengePromise = new Promise<string>((resolve, reject) => {
    this.challengeResolve = resolve;
    this.challengeReject = reject;
  });
  private socket?: WebSocket;

  constructor(
    private readonly factory: NonNullable<AgentBackendOptions['webSocketFactory']>,
    private readonly url: string,
    private readonly headers: Record<string, string> | undefined,
    private readonly onEvent: (frame: GatewayEventFrame) => void,
  ) {}

  async connect(connectParams: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    this.socket = this.factory(this.url, { headers: this.headers });
    const socket = this.socket;

    const onOpen = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener('open', handleOpen);
        socket.removeEventListener('error', handleError);
        socket.removeEventListener('close', handleClose);
      };
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('OpenClaw websocket error before open'));
      };
      const handleClose = (event: Event) => {
        const closeEvent = event as Event & { code?: number };
        cleanup();
        reject(new Error(`OpenClaw websocket closed before open (${closeEvent.code || 1006})`));
      };

      socket.addEventListener('open', handleOpen, { once: true });
      socket.addEventListener('error', handleError, { once: true });
      socket.addEventListener('close', handleClose, { once: true });
    });

    socket.addEventListener('message', (event) => {
      this.handleMessage(String(event.data));
    });
    socket.addEventListener('close', (event) => {
      const error = new Error(`OpenClaw websocket closed (${event.code})`);
      this.failPending(error);
      this.challengeReject(error);
    });
    socket.addEventListener('error', () => {
      this.failPending(new Error('OpenClaw websocket error'));
    });

    signal.addEventListener('abort', () => {
      this.close(4000, 'aborted');
    }, { once: true });

    await withTimeout(onOpen, DEFAULT_CONNECT_TIMEOUT_MS, 'OpenClaw websocket open timeout');
    const nonce = await withTimeout(
      this.challengePromise,
      DEFAULT_CONNECT_TIMEOUT_MS,
      'OpenClaw connect challenge timeout',
    );

    return this.request('connect', {
      ...connectParams,
      nonce,
    }, DEFAULT_CONNECT_TIMEOUT_MS);
  }

  async request<T>(
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('OpenClaw websocket is not connected');
    }

    const id = randomUUID();
    const payload: GatewayRequestFrame = {
      type: 'req',
      id,
      method,
      params,
    };

    const responsePromise = new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`OpenClaw request timeout (${method})`));
          }, timeoutMs)
        : undefined;

      this.pending.set(id, {
        resolve,
        reject,
        timer,
      });
    });

    this.socket.send(JSON.stringify(payload));
    return responsePromise;
  }

  close(code = 1000, reason = 'done'): void {
    this.socket?.close(code, reason);
    this.socket = undefined;
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const eventFrame = parseRecord(parsed);
    if (!eventFrame) {
      return;
    }

    if (eventFrame.type === 'event' && typeof eventFrame.event === 'string') {
      const frame = eventFrame as unknown as GatewayEventFrame;
      if (frame.event === 'connect.challenge') {
        const payload = parseRecord(frame.payload);
        const nonce = readString(payload?.nonce);
        if (nonce) {
          this.challengeResolve(nonce);
          return;
        }
      }
      this.onEvent(frame);
      return;
    }

    if (eventFrame.type !== 'res' || typeof eventFrame.id !== 'string') {
      return;
    }

    const frame = eventFrame as unknown as GatewayResponseFrame;
    const pending = this.pending.get(frame.id);
    if (!pending) {
      return;
    }

    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    this.pending.delete(frame.id);

    if (frame.ok) {
      pending.resolve(frame.payload ?? null);
      return;
    }

    const errorRecord = parseRecord(frame.error);
    pending.reject(new Error(
      readString(errorRecord?.message)
      || readString(errorRecord?.code)
      || 'OpenClaw request failed',
    ));
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export class OpenClawAdapter implements AgentAdapter {
  readonly kind = 'openclaw';

  constructor(private readonly options: AgentBackendOptions = {}) {}

  async *invoke(input: AgentInvokeInput): AsyncGenerator<StreamEvent> {
    const factory = this.options.webSocketFactory
      || ((url: string | URL, init?: WebSocketInit) => new WebSocket(url, init));
    const url = requireUrl(input.instance, this.options.env || process.env);
    const headers = resolveHeaders(input.instance, this.options.env || process.env);
    const queue = new AsyncQueue();
    let initialized = false;
    const preInitEvents: StreamEvent[] = [];
    const env = this.options.env || process.env;
    const client = new GatewayWsClient(factory, url, headers, (frame) => {
      const emit = (event: StreamEvent) => {
        if (!initialized) {
          preInitEvents.push(event);
          return;
        }
        queue.push(event);
      };

      if (frame.event !== 'agent') {
        return;
      }

      const payload = parseRecord(frame.payload);
      if (!payload) {
        return;
      }

      const stream = readString(payload.stream) || 'unknown';
      const data = parseRecord(payload.data);
      if (!data) {
        return;
      }

      if (stream === 'assistant') {
        const text = readString(data.delta) || readString(data.text);
        if (text) {
          emit({ type: 'text', text, raw: frame });
        }
        return;
      }

      if (stream === 'error') {
        emit({
          type: 'error',
          text: readString(data.error) || readString(data.message) || 'OpenClaw agent error',
          raw: frame,
        });
        return;
      }

      if (stream === 'artifact') {
        const artifacts = parseArtifacts(data.artifacts || data.items || [data]);
        if (artifacts) {
          emit({
            type: 'raw',
            artifacts,
            raw: frame,
          });
        }
      }
    });

    const run = (async () => {
      try {
        await client.connect(buildConnectParams(input.instance, env), input.signal);

        const agentParams = mergePayloadTemplate(input.instance.payloadTemplate, {
          message: prependInstructions(input.turn.message, input.turn.instructions),
          sessionKey: input.sessionKey,
          idempotencyKey: input.sessionId,
          model: input.model,
          context: input.turn.context,
          outputDir: input.turn.outputDir,
        });
        const accepted = await client.request<Record<string, unknown>>(
          'agent',
          agentParams,
          input.instance.timeoutMs || DEFAULT_CONNECT_TIMEOUT_MS,
        );
        const acceptedRecord = parseRecord(accepted);
        const runId = readString(acceptedRecord?.runId) || input.sessionId;
        const providerSessionId = readString(acceptedRecord?.sessionKey) || input.sessionKey;

        queue.push({
          type: 'init',
          sessionId: runId,
          providerSessionId,
          providerState: buildProviderState(
            input,
            runId,
            readString(acceptedRecord?.status) || 'accepted',
            readString(acceptedRecord?.summary),
            parseServices(acceptedRecord?.services),
            acceptedRecord,
          ),
          raw: acceptedRecord,
        });
        initialized = true;
        for (const event of preInitEvents.splice(0)) {
          queue.push(event);
        }

        const acceptedStatus = readString(acceptedRecord?.status)?.toLowerCase();
        if (acceptedStatus === 'error') {
          queue.push({
            type: 'error',
            providerSessionId,
            text: readString(acceptedRecord?.summary) || 'OpenClaw agent request failed',
            raw: acceptedRecord,
          });
          queue.push(null);
          return;
        }

        let finalPayload = acceptedRecord;
        if (acceptedStatus !== 'ok') {
          finalPayload = parseRecord(await client.request<Record<string, unknown>>(
            'agent.wait',
            {
              runId,
              timeoutMs: input.instance.waitTimeoutMs || DEFAULT_WAIT_TIMEOUT_MS,
            },
            (input.instance.waitTimeoutMs || DEFAULT_WAIT_TIMEOUT_MS) + DEFAULT_CONNECT_TIMEOUT_MS,
          ));
        }

        const summary = readString(finalPayload?.summary)
          || readString(finalPayload?.message)
          || readString(finalPayload?.resultSummary);
        const artifacts = parseArtifacts(
          finalPayload?.artifacts
          || parseRecord(finalPayload?.result)?.artifacts,
        );
        const services = parseServices(
          finalPayload?.services
          || parseRecord(finalPayload?.result)?.services
          || finalPayload?.runtimeServices,
        );

        queue.push({
          type: 'result',
          sessionId: runId,
          providerSessionId,
          summary,
          artifacts,
          services,
          providerState: buildProviderState(
            input,
            runId,
            readString(finalPayload?.status) || 'ok',
            summary,
            services,
            finalPayload,
          ),
          raw: finalPayload,
        });
        queue.push(null);
      } catch (error) {
        queue.push(error instanceof Error ? error : new Error(String(error)));
        queue.push(null);
      } finally {
        client.close();
      }
    })();

    try {
      while (true) {
        const item = await queue.shift();
        if (item === null) {
          break;
        }
        if (item instanceof Error) {
          throw item;
        }
        yield item;
      }
      await run;
    } finally {
      client.close();
    }
  }

  async probe(instance: RemoteProviderInstanceConfig): Promise<AgentAdapterProbeResult> {
    const env = this.options.env || process.env;
    const factory = this.options.webSocketFactory
      || ((url: string | URL, init?: WebSocketInit) => new WebSocket(url, init));
    const checkedAt = new Date().toISOString();
    try {
      const url = requireUrl(instance, env);
      const headers = resolveHeaders(instance, env);
      const client = new GatewayWsClient(factory, url, headers, () => {});
      const controller = new AbortController();
      try {
        await client.connect(buildConnectParams(instance, env), controller.signal);
        const health = await client.request('health', { probe: true }, DEFAULT_CONNECT_TIMEOUT_MS);
        const liveProbe = buildGatewayHealthProbeSnapshot(health, url);
        return {
          health: {
            status: 'ok',
            checkedAt,
            details: summarizeHealthPayload(health, url),
          },
          liveProbe,
          checks: [
            {
              code: 'gateway_agents_visible',
              status: liveProbe.agentCount > 0 ? 'ok' : 'degraded',
              message: liveProbe.agentCount > 0
                ? `Gateway advertised ${liveProbe.agentCount} agent(s) in the health snapshot`
                : 'Gateway health snapshot did not advertise any agents',
              details: {
                endpoint: url,
                agentCount: liveProbe.agentCount,
                channelCount: liveProbe.channelCount,
                linkedChannels: liveProbe.linkedChannels,
                ...(liveProbe.defaultAgentId ? { defaultAgentId: liveProbe.defaultAgentId } : {}),
                ...(liveProbe.sessionCount !== undefined ? { sessionCount: liveProbe.sessionCount } : {}),
                ...(liveProbe.latencyMs !== undefined ? { latencyMs: liveProbe.latencyMs } : {}),
              },
            },
          ],
        };
      } finally {
        controller.abort();
        client.close();
      }
    } catch (error) {
      return {
        health: {
          status: 'unavailable',
          checkedAt,
          details: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async listModels(
    instance: RemoteProviderInstanceConfig,
  ): Promise<Array<{ id: string; label: string }>> {
    const env = this.options.env || process.env;
    const factory = this.options.webSocketFactory
      || ((url: string | URL, init?: WebSocketInit) => new WebSocket(url, init));
    const url = requireUrl(instance, env);
    const headers = resolveHeaders(instance, env);
    const client = new GatewayWsClient(factory, url, headers, () => {});
    const controller = new AbortController();

    try {
      await client.connect(buildConnectParams(instance, env), controller.signal);
      const payload = await client.request(
        'models.list',
        {},
        DEFAULT_CONNECT_TIMEOUT_MS,
      );
      return parseGatewayModelCatalog(payload);
    } finally {
      controller.abort();
      client.close();
    }
  }

  inspect(instance: RemoteProviderInstanceConfig): AgentAdapterInspection {
    return buildInspection(instance, this.options.env || process.env);
  }
}
