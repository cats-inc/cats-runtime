import type { AppContext } from '../http/app.js';
import {
  RUNTIME_READINESS_PATH,
  RUNTIME_SERVICE_NAME,
  RUNTIME_VERSION,
} from '../startup.js';
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
      loadSession: false,
      promptCapabilities: {
        audio: false,
        embeddedContext: false,
        image: false,
      },
      mcpCapabilities: {
        http: false,
        sse: false,
      },
      sessionCapabilities: {},
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
      case 'authenticate':
      case 'session/new':
      case 'session/load':
      case 'session/prompt':
      case 'session/cancel':
      case 'session/list':
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
