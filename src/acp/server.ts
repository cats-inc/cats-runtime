import type { AppContext } from '../http/app.js';
import type { SessionInfo, StreamEvent } from '../core/types.js';
import {
  RUNTIME_READINESS_PATH,
  RUNTIME_SERVICE_NAME,
  RUNTIME_VERSION,
} from '../startup.js';
import { requestRuntimeSessionRoute } from './runtimeHttpBridge.js';
import type {
  AcpJsonRpcError,
  AcpJsonRpcNotification,
  AcpJsonRpcRequest,
  AcpJsonRpcSuccess,
} from './types.js';

export const ACP_PROTOCOL_VERSION = 1;

type AcpFacadeTransport = 'http' | 'stdio';

interface AcpFacadeHandleOptions {
  transport?: AcpFacadeTransport;
  notify?: (message: AcpJsonRpcNotification) => Promise<void> | void;
}

interface RuntimeAcpPromptProjectionState {
  nextSyntheticToolId: number;
  lastToolId: string | null;
  toolIdsByName: Map<string, string>;
  publishedToolIds: Set<string>;
  projectedCurrentModeId: string | null;
  projectedUsageSignature: string | null;
}

interface RuntimeAcpUsageSnapshot {
  used: number;
  size: number;
  costAmount?: number;
  costCurrency?: string;
}

class AcpFacadeError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

function successResponse(
  id: string | number | null,
  result: unknown,
): AcpJsonRpcSuccess {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function errorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): AcpJsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function ensureRequest(value: unknown): AcpJsonRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AcpFacadeError(-32600, 'ACP request must be an object');
  }
  return value as AcpJsonRpcRequest;
}

function ensureMethod(request: AcpJsonRpcRequest): string {
  if (typeof request.method !== 'string' || request.method.trim().length === 0) {
    throw new AcpFacadeError(-32600, 'ACP request method is required');
  }
  return request.method.trim();
}

function ensureRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AcpFacadeError(-32602, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readCatsRuntimeMeta(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const meta = record._meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return undefined;
  }
  const catsRuntime = (meta as Record<string, unknown>).catsRuntime;
  if (!catsRuntime || typeof catsRuntime !== 'object' || Array.isArray(catsRuntime)) {
    return undefined;
  }
  return catsRuntime as Record<string, unknown>;
}

function resolveRequestId(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return null;
}

function resolveTransport(
  options: AcpFacadeHandleOptions | undefined,
): AcpFacadeTransport {
  return options?.transport ?? 'http';
}

function canStreamPromptTurns(options: AcpFacadeHandleOptions | undefined): boolean {
  return resolveTransport(options) === 'stdio' && typeof options?.notify === 'function';
}

function buildSupportedMethods(
  options: AcpFacadeHandleOptions | undefined,
): string[] {
  const methods = [
    'initialize',
    'ping',
    'session/new',
    'session/list',
    'session/load',
    'session/cancel',
  ];
  if (canStreamPromptTurns(options)) {
    methods.push('session/prompt');
  }
  return methods;
}

function buildInitializeResult(
  ctx: AppContext,
  options?: AcpFacadeHandleOptions,
) {
  const transport = resolveTransport(options);
  const bootstrapRequired = ctx.startup?.bootstrapRequired === true;
  const supportedMethods = buildSupportedMethods(options);
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentInfo: {
      name: RUNTIME_SERVICE_NAME,
      version: RUNTIME_VERSION,
    },
    authMethods: [],
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: {
        audio: false,
        embeddedContext: false,
        image: false,
      },
      mcpCapabilities: {
        http: false,
        sse: false,
      },
      sessionCapabilities: {
        list: {},
      },
    },
    _meta: {
      catsRuntime: {
        transport,
        ...(transport === 'http' ? { path: '/acp' } : {}),
        bootstrapRequired,
        readinessPath: RUNTIME_READINESS_PATH,
        sessionLifecycle: canStreamPromptTurns(options)
          ? 'prompt_enabled_over_stdio'
          : 'pending',
        supportedMethods,
      },
    },
  };
}

function ensureRuntimeReadyForAcp(ctx: AppContext): void {
  if (ctx.startup?.bootstrapRequired === true) {
    throw new AcpFacadeError(
      -32001,
      'Runtime bootstrap is still required before ACP session methods can be used.',
      {
        reason: 'runtime_bootstrap_required',
        readinessPath: RUNTIME_READINESS_PATH,
      },
    );
  }
}

function buildSessionInfo(session: SessionInfo) {
  return {
    sessionId: session.id,
    cwd: session.cwd,
    ...(session.summary ? { title: session.summary } : {}),
    ...(session.lastActivity ? { updatedAt: session.lastActivity } : {}),
    _meta: {
      catsRuntime: {
        providerName: session.providerName,
        providerBackend: session.providerBackend || 'cli',
        providerInstanceId: session.providerInstanceId || 'default',
        status: session.status,
        workspaceMode: session.workspaceMode,
      },
    },
  };
}

function handleListSessions(ctx: AppContext, params: unknown) {
  const request = params === undefined ? {} : ensureRecord(params, 'session/list params');
  const cwd = readOptionalString(request, 'cwd');
  const sessions = ctx.registry
    .list()
    .filter((session) => (cwd ? session.cwd === cwd : true))
    .map((session) => buildSessionInfo(session));

  return {
    sessions,
    nextCursor: null,
    _meta: {
      catsRuntime: {
        source: 'runtime_registry',
        returnedCount: sessions.length,
      },
    },
  };
}

function handleLoadSession(ctx: AppContext, params: unknown) {
  const request = ensureRecord(params ?? {}, 'session/load params');
  const sessionId = readOptionalString(request, 'sessionId');
  const cwd = readOptionalString(request, 'cwd');
  const mcpServers = request.mcpServers;

  if (!sessionId) {
    throw new AcpFacadeError(-32602, 'session/load requires params.sessionId');
  }
  if (!cwd) {
    throw new AcpFacadeError(-32602, 'session/load requires params.cwd');
  }
  if (!Array.isArray(mcpServers)) {
    throw new AcpFacadeError(-32602, 'session/load requires params.mcpServers');
  }

  const session = ctx.registry.get(sessionId);
  if (!session) {
    throw new AcpFacadeError(-32602, `Runtime session '${sessionId}' was not found`, {
      reason: 'session_not_found',
    });
  }
  if (session.cwd !== cwd) {
    throw new AcpFacadeError(-32602, `Runtime session '${sessionId}' is not bound to cwd '${cwd}'`, {
      reason: 'cwd_mismatch',
      actualCwd: session.cwd,
    });
  }

  return {
    _meta: {
      catsRuntime: {
        session: buildSessionInfo(session),
        resumedFromRuntimeRegistry: true,
        clientMcpServers: mcpServers.length,
      },
    },
  };
}

async function handleNewSession(ctx: AppContext, params: unknown) {
  ensureRuntimeReadyForAcp(ctx);

  const request = ensureRecord(params ?? {}, 'session/new params');
  const cwd = readOptionalString(request, 'cwd');
  const mcpServers = request.mcpServers;
  if (!cwd) {
    throw new AcpFacadeError(-32602, 'session/new requires params.cwd');
  }
  if (!Array.isArray(mcpServers)) {
    throw new AcpFacadeError(-32602, 'session/new requires params.mcpServers');
  }

  const catsRuntime = readCatsRuntimeMeta(request);
  const response = await requestRuntimeSessionRoute(ctx, '/sessions', {
    method: 'POST',
    body: {
      provider: readOptionalString(catsRuntime ?? {}, 'provider') ?? 'claude',
      instance: readOptionalString(catsRuntime ?? {}, 'instance'),
      model: readOptionalString(catsRuntime ?? {}, 'model'),
      permissionMode: readOptionalString(catsRuntime ?? {}, 'permissionMode'),
      group: readOptionalString(catsRuntime ?? {}, 'group') ?? 'acp-facade',
      cwd,
    },
  });

  const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!response.ok) {
    throw new AcpFacadeError(
      -32603,
      typeof payload?.error === 'string'
        ? payload.error
        : 'Failed to create a runtime-owned ACP session.',
      {
        route: '/sessions',
        httpStatus: response.status,
      },
    );
  }

  const sessionId = typeof payload?.id === 'string' ? payload.id : undefined;
  if (!sessionId) {
    throw new AcpFacadeError(-32603, 'Runtime session create response did not include a session id');
  }

  return {
    sessionId,
    _meta: {
      catsRuntime: {
        source: 'runtime_http_bridge',
        clientMcpServers: mcpServers.length,
        session: payload,
      },
    },
  };
}

function flattenPromptContent(params: Record<string, unknown>): string {
  const prompt = params.prompt;
  if (!Array.isArray(prompt) || prompt.length === 0) {
    throw new AcpFacadeError(-32602, 'session/prompt requires a non-empty params.prompt array');
  }

  const parts: string[] = [];
  for (const block of prompt) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) {
      throw new AcpFacadeError(-32602, 'session/prompt prompt blocks must be objects');
    }

    const record = block as Record<string, unknown>;
    const type = readOptionalString(record, 'type');
    if (type === 'text') {
      const text = readOptionalString(record, 'text');
      if (!text) {
        throw new AcpFacadeError(-32602, 'session/prompt text blocks require text content');
      }
      parts.push(text);
      continue;
    }

    if (type === 'resource') {
      const resource = ensureRecord(record.resource, 'session/prompt resource block');
      const resourceText = readOptionalString(resource, 'text');
      const resourceUri = readOptionalString(resource, 'uri');
      if (resourceText) {
        parts.push(resourceText);
        continue;
      }
      if (resourceUri) {
        parts.push(resourceUri);
        continue;
      }
      throw new AcpFacadeError(-32602, 'session/prompt resource blocks require resource.text or resource.uri');
    }

    if (type === 'resource_link') {
      const uri = readOptionalString(record, 'uri');
      if (!uri) {
        throw new AcpFacadeError(-32602, 'session/prompt resource_link blocks require uri');
      }
      parts.push(uri);
      continue;
    }

    throw new AcpFacadeError(
      -32602,
      `session/prompt block type '${type ?? 'unknown'}' is not yet supported by the cats-runtime ACP facade.`,
      {
        reason: 'unsupported_prompt_content',
        supportedTypes: ['text', 'resource', 'resource_link'],
      },
    );
  }

  return parts.join('\n\n').trim();
}

async function* streamNdjsonMessages(
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

function createPromptProjectionState(): RuntimeAcpPromptProjectionState {
  return {
    nextSyntheticToolId: 1,
    lastToolId: null,
    toolIdsByName: new Map(),
    publishedToolIds: new Set(),
    projectedCurrentModeId: null,
    projectedUsageSignature: null,
  };
}

function ensurePromptTransport(
  options: AcpFacadeHandleOptions | undefined,
): asserts options is Required<Pick<AcpFacadeHandleOptions, 'notify'>> & AcpFacadeHandleOptions {
  if (canStreamPromptTurns(options)) {
    return;
  }

  throw new AcpFacadeError(
    -32601,
    "ACP method 'session/prompt' is not yet enabled by the cats-runtime ACP facade.",
    {
      facade: 'runtime_acp_http',
      phase: 'phase_4',
      reason: 'prompt_turn_requires_bidirectional_transport',
      currentTransport: resolveTransport(options),
      requiredNotifications: ['session/update'],
      supportedMethods: buildSupportedMethods(options),
    },
  );
}

function buildSessionUpdateNotification(
  sessionId: string,
  update: Record<string, unknown>,
): AcpJsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update,
    },
  };
}

function buildTextContent(text: string): Record<string, string> {
  return {
    type: 'text',
    text,
  };
}

function buildPlanEntryStatus(
  status: unknown,
): 'pending' | 'in_progress' | 'completed' {
  if (status === 'started' || status === 'running' || status === 'created') {
    return 'in_progress';
  }
  if (status === 'completed') {
    return 'completed';
  }
  return 'pending';
}

function titleCaseConfigLabel(id: string): string {
  return id
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildToolResultContent(text: string): Array<Record<string, unknown>> {
  return [{
    type: 'content',
    content: buildTextContent(text),
  }];
}

function resolveModeIdFromStreamEvent(
  streamEvent: StreamEvent,
): string | undefined {
  const metadata = parseRecord(streamEvent.metadata);
  const nativeMetadata = parseRecord(metadata?.native);
  const providerState = parseRecord(streamEvent.providerState);
  const agentSession = parseRecord(providerState?.agentSession);
  const adapterState = parseRecord(agentSession?.adapterState);

  return readString(adapterState?.currentModeId)
    || (metadata?.kind === 'session'
      ? readString(metadata.currentModeId) || readString(metadata.modeId)
      : undefined)
    || (metadata?.kind === 'session'
      ? readString(nativeMetadata?.currentModeId) || readString(nativeMetadata?.modeId)
      : undefined);
}

function resolveUsageFromStreamEvent(
  streamEvent: StreamEvent,
): RuntimeAcpUsageSnapshot | undefined {
  const metadata = parseRecord(streamEvent.metadata);
  const nativeMetadata = parseRecord(metadata?.native);
  const providerState = parseRecord(streamEvent.providerState);
  const agentSession = parseRecord(providerState?.agentSession);
  const adapterState = parseRecord(agentSession?.adapterState);
  const providerUsage = parseRecord(adapterState?.contextWindowUsage);
  const usageSource = providerUsage
    || (metadata?.kind === 'session' ? metadata : undefined)
    || (metadata?.kind === 'session' ? nativeMetadata : undefined);

  const used = readNumber(usageSource?.used);
  const size = readNumber(usageSource?.size);
  if (used === undefined || size === undefined) {
    return undefined;
  }

  const cost = parseRecord(usageSource?.cost);
  const costAmount = readNumber(usageSource?.costAmount) ?? readNumber(cost?.amount);
  const costCurrency = readString(usageSource?.costCurrency) || readString(cost?.currency);
  return {
    used,
    size,
    ...(costAmount === undefined ? {} : { costAmount }),
    ...(costCurrency ? { costCurrency } : {}),
  };
}

function buildUsageSignature(usage: RuntimeAcpUsageSnapshot): string {
  return [
    usage.used,
    usage.size,
    usage.costAmount ?? '',
    usage.costCurrency ?? '',
  ].join(':');
}

function buildSessionStateUpdates(
  streamEvent: StreamEvent,
  state: RuntimeAcpPromptProjectionState,
): Array<Record<string, unknown>> {
  const updates: Array<Record<string, unknown>> = [];

  const modeId = resolveModeIdFromStreamEvent(streamEvent);
  if (modeId && modeId !== state.projectedCurrentModeId) {
    state.projectedCurrentModeId = modeId;
    updates.push({
      sessionId: '',
      update: {
        sessionUpdate: 'current_mode_update',
        currentModeUpdate: {
          modeId,
        },
      },
    });
  }

  const usage = resolveUsageFromStreamEvent(streamEvent);
  if (usage) {
    const signature = buildUsageSignature(usage);
    if (signature !== state.projectedUsageSignature) {
      state.projectedUsageSignature = signature;
      updates.push({
        sessionId: '',
        update: {
          sessionUpdate: 'usage_update',
          usageUpdate: {
            used: usage.used,
            size: usage.size,
            ...(usage.costAmount === undefined && !usage.costCurrency
              ? {}
              : {
                  cost: {
                    ...(usage.costAmount === undefined ? {} : { amount: usage.costAmount }),
                    ...(usage.costCurrency ? { currency: usage.costCurrency } : {}),
                  },
                }),
          },
        },
      });
    }
  }

  return updates;
}

function buildPlanUpdateFromProgress(
  streamEvent: StreamEvent,
): Record<string, unknown> | null {
  if (typeof streamEvent.text !== 'string' || streamEvent.text.length === 0) {
    return null;
  }

  const metadata = streamEvent.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const metadataRecord = metadata as Record<string, unknown>;
  if (metadataRecord.kind !== 'plan') {
    return null;
  }

  return {
    sessionUpdate: 'plan',
    entries: [
      {
        content: streamEvent.text,
        status: buildPlanEntryStatus(metadataRecord.status),
        ...(typeof metadataRecord.stepCount === 'number' ? { step: metadataRecord.stepCount } : {}),
      },
    ],
  };
}

function buildConfigOptionUpdateFromProgress(
  streamEvent: StreamEvent,
): Record<string, unknown> | null {
  const metadata = streamEvent.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const metadataRecord = metadata as Record<string, unknown>;
  if (metadataRecord.kind !== 'model_state') {
    return null;
  }

  const native = metadataRecord.native && typeof metadataRecord.native === 'object' && !Array.isArray(metadataRecord.native)
    ? metadataRecord.native as Record<string, unknown>
    : undefined;

  const configId = typeof metadataRecord.configId === 'string' && metadataRecord.configId.trim().length > 0
    ? metadataRecord.configId.trim()
    : 'model';
  const value = typeof metadataRecord.value === 'string' && metadataRecord.value.trim().length > 0
    ? metadataRecord.value.trim()
    : typeof native?.toModel === 'string' && native.toModel.trim().length > 0
      ? native.toModel.trim()
      : undefined;

  if (!value) {
    return null;
  }

  return {
    sessionUpdate: 'config_option_update',
    configOptionUpdate: {
      configOptions: [
        {
          configId,
          name: titleCaseConfigLabel(configId),
          payload: {
            currentValue: value,
          },
        },
      ],
    },
  };
}

function resolveProjectedToolId(
  event: StreamEvent,
  state: RuntimeAcpPromptProjectionState,
): string | undefined {
  if (event.toolId?.trim()) {
    const id = event.toolId.trim();
    state.lastToolId = id;
    if (event.toolName?.trim()) {
      state.toolIdsByName.set(event.toolName.trim(), id);
    }
    return id;
  }

  if (event.toolName?.trim()) {
    const existing = state.toolIdsByName.get(event.toolName.trim());
    if (existing) {
      state.lastToolId = existing;
      return existing;
    }
  }

  if (event.type === 'tool_use') {
    const syntheticId = `runtime-tool-${state.nextSyntheticToolId}`;
    state.nextSyntheticToolId += 1;
    state.lastToolId = syntheticId;
    if (event.toolName?.trim()) {
      state.toolIdsByName.set(event.toolName.trim(), syntheticId);
    }
    return syntheticId;
  }

  return state.lastToolId ?? undefined;
}

function buildToolCallAnnouncement(
  toolId: string | undefined,
  toolName: string | undefined,
  state: RuntimeAcpPromptProjectionState,
  options: {
    rawInput?: Record<string, unknown>;
    text?: string;
  } = {},
): Array<Record<string, unknown>> {
  if (!toolId || state.publishedToolIds.has(toolId)) {
    return [];
  }

  state.publishedToolIds.add(toolId);
  return [{
    sessionId: '',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: toolId,
      title: toolName?.trim() || 'Tool',
      kind: toolName?.trim() || 'other',
      status: 'pending',
      ...(options.rawInput ? { rawInput: options.rawInput } : {}),
      ...(options.text ? { content: buildToolResultContent(options.text) } : {}),
    },
  }];
}

function mapRuntimeEventToAcpUpdates(
  event: unknown,
  state: RuntimeAcpPromptProjectionState,
): Array<Record<string, unknown>> {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return [];
  }

  const eventRecord = event as Record<string, unknown>;
  const eventType = typeof eventRecord.type === 'string' ? eventRecord.type : undefined;
  if (!eventType || eventType === 'content_block' || eventType === 'init' || eventType === 'raw') {
    return [];
  }
  const streamEvent = eventRecord as unknown as StreamEvent;
  const sessionStateUpdates = buildSessionStateUpdates(streamEvent, state);

  if (eventType === 'text' && typeof streamEvent.text === 'string' && streamEvent.text.length > 0) {
    return [
      ...sessionStateUpdates,
      {
        sessionId: '',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: buildTextContent(streamEvent.text),
        },
      },
    ];
  }

  if (eventType === 'result' && typeof streamEvent.text === 'string' && streamEvent.text.length > 0) {
    return [
      ...sessionStateUpdates,
      {
        sessionId: '',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: buildTextContent(streamEvent.text),
        },
      },
    ];
  }

  if (eventType === 'progress') {
    const planUpdate = buildPlanUpdateFromProgress(streamEvent);
    if (planUpdate) {
      return [
        ...sessionStateUpdates,
        {
          sessionId: '',
          update: planUpdate,
        },
      ];
    }

    const configOptionUpdate = buildConfigOptionUpdateFromProgress(streamEvent);
    if (configOptionUpdate) {
      return [
        ...sessionStateUpdates,
        {
          sessionId: '',
          update: configOptionUpdate,
        },
      ];
    }
  }

  if (eventType === 'progress'
    && typeof streamEvent.text === 'string'
    && streamEvent.text.length > 0
    && streamEvent.metadata
    && typeof streamEvent.metadata === 'object'
    && !Array.isArray(streamEvent.metadata)
    && (streamEvent.metadata as Record<string, unknown>).kind === 'reasoning'
  ) {
    return [
      ...sessionStateUpdates,
      {
        sessionId: '',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: buildTextContent(streamEvent.text),
        },
      },
    ];
  }

  if (
    eventType === 'progress'
    && typeof streamEvent.text === 'string'
    && streamEvent.text.length > 0
    && (streamEvent.toolId?.trim() || streamEvent.toolName?.trim())
  ) {
    const toolId = resolveProjectedToolId(streamEvent, state);
    const toolName = streamEvent.toolName?.trim();
    return [
      ...sessionStateUpdates,
      ...buildToolCallAnnouncement(toolId, toolName, state),
      {
        sessionId: '',
        update: {
          sessionUpdate: 'tool_call_update',
          ...(toolId ? { toolCallId: toolId } : {}),
          status: 'in_progress',
          content: buildToolResultContent(streamEvent.text),
        },
      },
    ];
  }

  if (eventType === 'tool_use') {
    const toolUseEvent = streamEvent as Extract<StreamEvent, { type: 'tool_use' }>;
    const toolId = resolveProjectedToolId(toolUseEvent, state);
    return [
      ...sessionStateUpdates,
      ...buildToolCallAnnouncement(toolId, toolUseEvent.toolName, state, {
        ...(toolUseEvent.toolArgs ? { rawInput: toolUseEvent.toolArgs } : {}),
        ...(toolUseEvent.text ? { text: toolUseEvent.text } : {}),
      }),
    ];
  }

  if (eventType === 'tool_result') {
    const toolResultEvent = streamEvent as Extract<StreamEvent, { type: 'tool_result' }>;
    const toolId = resolveProjectedToolId(toolResultEvent, state);
    return [
      ...sessionStateUpdates,
      ...buildToolCallAnnouncement(toolId, toolResultEvent.toolName, state),
      {
        sessionId: '',
        update: {
          sessionUpdate: 'tool_call_update',
          ...(toolId ? { toolCallId: toolId } : {}),
          status: toolResultEvent.isError ? 'failed' : 'completed',
          ...(toolResultEvent.text ? { content: buildToolResultContent(toolResultEvent.text) } : {}),
        },
      },
    ];
  }

  return sessionStateUpdates;
}

function looksLikeCancelledStop(text: string): boolean {
  return /cancelled|canceled|abort|aborted/i.test(text);
}

async function handlePromptSession(
  ctx: AppContext,
  params: unknown,
  options: AcpFacadeHandleOptions | undefined,
) {
  ensureRuntimeReadyForAcp(ctx);
  ensurePromptTransport(options);

  const request = ensureRecord(params ?? {}, 'session/prompt params');
  const sessionId = readOptionalString(request, 'sessionId');
  if (!sessionId) {
    throw new AcpFacadeError(-32602, 'session/prompt requires params.sessionId');
  }

  const message = flattenPromptContent(request);
  if (!message) {
    throw new AcpFacadeError(-32602, 'session/prompt requires at least one non-empty text-equivalent content block');
  }

  const response = await requestRuntimeSessionRoute(ctx, `/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    headers: {
      accept: 'application/x-ndjson',
    },
    body: {
      message,
    },
  });

  if (!response.ok) {
    const failurePayload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    throw new AcpFacadeError(
      -32603,
      typeof failurePayload?.error === 'string'
        ? failurePayload.error
        : `Failed to execute runtime ACP prompt turn for session '${sessionId}'.`,
      {
        route: `/sessions/${sessionId}/messages`,
        httpStatus: response.status,
      },
    );
  }

  if (!response.body) {
    throw new AcpFacadeError(-32603, 'Runtime ACP prompt turn returned no stream body');
  }

  const projectionState = createPromptProjectionState();
  let stopReason: 'end_turn' | 'cancelled' | 'refusal' = 'end_turn';

  for await (const ndjsonEvent of streamNdjsonMessages(response.body)) {
    const projected = mapRuntimeEventToAcpUpdates(ndjsonEvent, projectionState);
    for (const notificationParams of projected) {
      await options.notify(buildSessionUpdateNotification(
        sessionId,
        notificationParams.update as Record<string, unknown>,
      ));
    }

    if (!ndjsonEvent || typeof ndjsonEvent !== 'object' || Array.isArray(ndjsonEvent)) {
      continue;
    }

    const streamEvent = ndjsonEvent as StreamEvent;
    if (streamEvent.type === 'error') {
      stopReason = looksLikeCancelledStop(streamEvent.text) ? 'cancelled' : 'refusal';
    }
  }

  return {
    stopReason,
    _meta: {
      catsRuntime: {
        source: 'runtime_http_bridge',
        transport: 'stdio',
        turnStream: 'application/x-ndjson',
      },
    },
  };
}

async function handleCancelSession(ctx: AppContext, params: unknown) {
  const request = ensureRecord(params ?? {}, 'session/cancel params');
  const sessionId = readOptionalString(request, 'sessionId');
  if (!sessionId) {
    throw new AcpFacadeError(-32602, 'session/cancel requires params.sessionId');
  }

  const response = await requestRuntimeSessionRoute(
    ctx,
    `/sessions/${encodeURIComponent(sessionId)}/cancel`,
    {
      method: 'POST',
    },
  );
  const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!response.ok) {
    throw new AcpFacadeError(
      -32603,
      typeof payload?.error === 'string'
        ? payload.error
        : `Failed to cancel runtime session '${sessionId}'.`,
      {
        route: `/sessions/${sessionId}/cancel`,
        httpStatus: response.status,
      },
    );
  }
}

export async function handleAcpJsonRpc(
  ctx: AppContext,
  rawBody: unknown,
  options?: AcpFacadeHandleOptions,
): Promise<AcpJsonRpcSuccess | AcpJsonRpcError | null> {
  let requestId: string | number | null = null;

  try {
    const request = ensureRequest(rawBody);
    const id = resolveRequestId(request.id);
    requestId = id;
    const method = ensureMethod(request);

    switch (method) {
      case 'ping':
        return successResponse(id, {});
      case 'initialize':
        return successResponse(id, buildInitializeResult(ctx, options));
      case 'session/new':
        return successResponse(id, await handleNewSession(ctx, request.params));
      case 'session/cancel':
        await handleCancelSession(ctx, request.params);
        return id === null ? null : successResponse(id, {});
      case 'session/list':
        return successResponse(id, handleListSessions(ctx, request.params));
      case 'session/load':
        return successResponse(id, handleLoadSession(ctx, request.params));
      case 'session/prompt':
        return successResponse(id, await handlePromptSession(ctx, request.params, options));
      case 'authenticate':
      case 'session/set_mode':
      case 'session/set_config_option':
        ensureRuntimeReadyForAcp(ctx);
        return errorResponse(
          id,
          -32601,
          `ACP method '${method}' is not yet enabled by the cats-runtime ACP facade.`,
          {
            facade: 'runtime_acp_http',
            phase: 'phase_4',
            supportedMethods: buildSupportedMethods(options),
          },
        );
      default:
        return errorResponse(id, -32601, `Unknown ACP method '${method}'`);
    }
  } catch (error) {
    if (error instanceof AcpFacadeError) {
      return errorResponse(requestId, error.code, error.message, error.data);
    }

    return errorResponse(
      requestId,
      -32603,
      error instanceof Error ? error.message : 'Unexpected ACP error',
    );
  }
}
