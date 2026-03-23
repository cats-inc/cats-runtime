import { RUNTIME_VERSION } from '../startup.js';
import type { AppContext } from '../http/app.js';
import {
  callMcpTool,
  listMcpTools,
  McpToolError,
} from './tools.js';
import type {
  McpJsonRpcError,
  McpJsonRpcRequest,
  McpJsonRpcSuccess,
} from './types.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';

function successResponse(
  id: string | number | null,
  result: unknown,
): McpJsonRpcSuccess {
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
): McpJsonRpcError {
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

function ensureRequest(value: unknown): McpJsonRpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpToolError(-32600, 'MCP request must be an object');
  }
  return value as McpJsonRpcRequest;
}

function ensureRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpToolError(-32602, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function ensureMethod(request: McpJsonRpcRequest): string {
  if (typeof request.method !== 'string' || request.method.trim().length === 0) {
    throw new McpToolError(-32600, 'MCP request method is required');
  }
  return request.method;
}

function resolveRequestId(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return null;
}

function toolResultPayload(summary: string, structuredContent: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: summary,
      },
    ],
    structuredContent,
  };
}

export async function handleMcpJsonRpc(
  ctx: AppContext,
  rawBody: unknown,
): Promise<McpJsonRpcSuccess | McpJsonRpcError | null> {
  let requestId: string | number | null = null;

  try {
    const request = ensureRequest(rawBody);
    const id = resolveRequestId(request.id);
    requestId = id;
    const method = ensureMethod(request);

    switch (method) {
      case 'notifications/initialized':
        return id === null ? null : successResponse(id, {});
      case 'initialize':
        return successResponse(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: {
            name: 'cats-runtime-mcp',
            version: RUNTIME_VERSION,
          },
          capabilities: {
            tools: {},
          },
        });
      case 'tools/list':
        return successResponse(id, {
          tools: listMcpTools(),
        });
      case 'tools/call': {
        const params = ensureRecord(request.params ?? {}, 'tools/call params');
        const name = typeof params.name === 'string' ? params.name.trim() : '';
        if (!name) {
          throw new McpToolError(-32602, 'tools/call requires params.name');
        }
        const toolResult = await callMcpTool(ctx, name, params.arguments);
        return successResponse(id, toolResultPayload(
          toolResult.summary,
          toolResult.structuredContent,
        ));
      }
      default:
        return errorResponse(id, -32601, `Unknown MCP method '${method}'`);
    }
  } catch (error) {
    if (error instanceof McpToolError) {
      return errorResponse(requestId, error.code, error.message, error.data);
    }

    return errorResponse(
      requestId,
      -32603,
      error instanceof Error ? error.message : 'Unexpected MCP error',
    );
  }
}
