import type {
  HealthStatus,
  ProviderCapabilities,
  SessionProviderState,
} from '../../core/types.js';
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '../../core/tools/LocalToolRuntime.js';
import type { RemoteProviderInstanceConfig } from '../cli/config.js';

export interface ApiTextPart {
  type: 'text';
  text: string;
}

export interface ApiToolCallPart {
  type: 'tool_call';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  raw?: unknown;
}

export interface ApiToolResultPart {
  type: 'tool_result';
  toolCallId: string;
  name: string;
  output: string;
  isError?: boolean;
}

export type ApiConversationPart =
  | ApiTextPart
  | ApiToolCallPart
  | ApiToolResultPart;

export interface ApiConversationMessage {
  role: 'user' | 'assistant' | 'system';
  parts: ApiConversationPart[];
}

export interface ApiCompletionInput {
  sessionId: string;
  providerName: string;
  instance: RemoteProviderInstanceConfig;
  model: string;
  messages: ApiConversationMessage[];
  tools: ToolDefinition[];
  previousResponseId?: string;
  sessionState?: SessionProviderState;
  turnStep?: number;
  signal?: AbortSignal;
}

export interface ApiProgressEvent {
  kind: 'provider_cache' | 'model_state';
  status: 'created' | 'reused' | 'fallback' | 'hinted';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ApiCompletionResponse {
  responseId?: string;
  assistant: ApiConversationMessage;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  sessionState?: SessionProviderState;
  progress?: ApiProgressEvent[];
  raw?: unknown;
}

export interface ApiTransportClient {
  completeTurn(input: ApiCompletionInput): Promise<ApiCompletionResponse>;
  probe?(instance: RemoteProviderInstanceConfig): Promise<HealthStatus>;
}

export interface ApiBackendOptions {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

export interface ApiBackendStatus {
  active: number;
  busy: number;
  idle: number;
  providers: Record<string, number>;
}

export interface ApiToolLoopInput {
  sessionId: string;
  providerName: string;
  instance: RemoteProviderInstanceConfig;
  model: string;
  messages: ApiConversationMessage[];
  toolContext: ToolExecutionContext;
}

export interface ApiToolLoopResult {
  responseId?: string;
  events: Array<{
    type: 'init' | 'text' | 'tool_use' | 'tool_result' | 'result';
    sessionId?: string;
    text?: string;
    toolName?: string;
    toolId?: string;
    isError?: boolean;
    usage?: {
      inputTokens: number;
      outputTokens: number;
    };
    raw?: unknown;
  }>;
  messages: ApiConversationMessage[];
  toolResults: ToolResult[];
}

export const API_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  resume: true,
  fork: true,
  permissions: true,
};
