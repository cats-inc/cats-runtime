import type { AppContext } from '../http/app.js';

export interface McpJsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface McpJsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

export interface McpJsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  summary: string;
  structuredContent: unknown;
}

export interface McpToolHandler {
  definition: McpToolDefinition;
  execute(ctx: AppContext, args: Record<string, unknown>): Promise<McpToolCallResult>;
}
