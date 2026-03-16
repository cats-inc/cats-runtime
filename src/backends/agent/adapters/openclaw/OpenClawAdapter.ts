import { randomUUID } from 'node:crypto';
import type {
  AgentRuntimeService,
  SessionArtifact,
  SessionProviderState,
  StreamEvent,
} from '../../../../core/types.js';
import type { RemoteProviderInstanceConfig } from '../../../cli/config.js';
import type { AgentAdapter, AgentBackendOptions, AgentInvokeInput } from '../../types.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_CLIENT_ID = 'cats-runtime';
const DEFAULT_CLIENT_MODE = 'backend';
const DEFAULT_CLIENT_VERSION = '0.1.0';
const DEFAULT_ROLE = 'operator';
const DEFAULT_SCOPES = ['operator.admin'];
const PROTOCOL_VERSION = 1;

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

function parseRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
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

function prependInstructions(message: string, instructions?: string): string {
  if (!instructions) {
    return message;
  }

  return `${instructions.trim()}\n\n${message}`;
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

function parseServices(value: unknown): AgentRuntimeService[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const services = value.flatMap((entry, index) => {
      const record = parseRecord(entry);
      if (!record) {
        return [];
      }
      return [{
        id: readString(record.id) || `service-${index + 1}`,
        name: readString(record.name) || readString(record.label) || `service-${index + 1}`,
        url: readString(record.url),
        status: readString(record.status),
        metadata: parseRecord(record.metadata) || undefined,
      } satisfies AgentRuntimeService];
    });

  return services.length > 0 ? services : undefined;
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

  async connect(connectParams: Record<string, unknown>, signal: AbortSignal): Promise<void> {
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

    await this.request('connect', {
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
        const authToken = input.instance.authTokenEnv
          ? (this.options.env || process.env)[input.instance.authTokenEnv]
          : undefined;
        const password = input.instance.passwordEnv
          ? (this.options.env || process.env)[input.instance.passwordEnv]
          : undefined;

        await client.connect({
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: {
            id: input.instance.clientId || DEFAULT_CLIENT_ID,
            version: input.instance.clientVersion || DEFAULT_CLIENT_VERSION,
            platform: process.platform,
            mode: input.instance.clientMode || DEFAULT_CLIENT_MODE,
          },
          role: input.instance.role || DEFAULT_ROLE,
          scopes: input.instance.scopes || DEFAULT_SCOPES,
          auth: authToken || password
            ? {
                ...(authToken ? { token: authToken } : {}),
                ...(password ? { password } : {}),
              }
            : undefined,
        }, input.signal);

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

  async probe(instance: RemoteProviderInstanceConfig): Promise<{ status: 'ok' | 'degraded' | 'unavailable'; checkedAt: string; details?: string }> {
    try {
      const url = requireUrl(instance, this.options.env || process.env);
      return {
        // MVP probe only validates resolvable config; it does not dial the websocket.
        status: 'degraded',
        checkedAt: new Date().toISOString(),
        details: `Config validated only; live gateway probe not attempted (${url})`,
      };
    } catch (error) {
      return {
        status: 'unavailable',
        checkedAt: new Date().toISOString(),
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
