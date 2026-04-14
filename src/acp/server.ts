import type { AppContext } from '../http/app.js';
import type { SessionInfo } from '../core/types.js';
import {
  RUNTIME_READINESS_PATH,
  RUNTIME_SERVICE_NAME,
  RUNTIME_VERSION,
} from '../startup.js';
import { requestRuntimeSessionRoute } from './runtimeHttpBridge.js';
import type {
  AcpJsonRpcError,
  AcpJsonRpcRequest,
  AcpJsonRpcSuccess,
} from './types.js';

export const ACP_PROTOCOL_VERSION = 1;

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

function buildInitializeResult(ctx: AppContext) {
  const bootstrapRequired = ctx.startup?.bootstrapRequired === true;
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
        transport: 'http',
        path: '/acp',
        bootstrapRequired,
        readinessPath: RUNTIME_READINESS_PATH,
        sessionLifecycle: 'pending',
        supportedMethods: [
          'initialize',
          'ping',
          'session/new',
          'session/list',
          'session/load',
          'session/cancel',
        ],
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
        return successResponse(id, buildInitializeResult(ctx));
      case 'session/new':
        return successResponse(id, await handleNewSession(ctx, request.params));
      case 'session/cancel':
        await handleCancelSession(ctx, request.params);
        return id === null ? null : successResponse(id, {});
      case 'session/list':
        return successResponse(id, handleListSessions(ctx, request.params));
      case 'session/load':
        return successResponse(id, handleLoadSession(ctx, request.params));
      case 'authenticate':
      case 'session/prompt':
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
            supportedMethods: [
              'initialize',
              'ping',
              'session/new',
              'session/list',
              'session/load',
              'session/cancel',
            ],
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
