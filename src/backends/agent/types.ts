import type {
  HealthStatus,
  ProviderCapabilities,
  SessionProviderState,
  StreamEvent,
  TurnInput,
} from '../../core/types.js';
import type { RemoteProviderInstanceConfig } from '../cli/config.js';

export interface AgentInvokeInput {
  sessionId: string;
  providerName: string;
  instance: RemoteProviderInstanceConfig;
  model?: string;
  turn: TurnInput;
  sessionKey: string;
  providerSessionId?: string;
  sessionState?: SessionProviderState;
  signal: AbortSignal;
}

export interface AgentAdapter {
  readonly kind: string;
  invoke(input: AgentInvokeInput): AsyncGenerator<StreamEvent>;
  probe?(instance: RemoteProviderInstanceConfig): Promise<HealthStatus>;
  listModels?(instance: RemoteProviderInstanceConfig): Promise<Array<{ id: string; label: string }>>;
  cancel?(
    sessionId: string,
    instance: RemoteProviderInstanceConfig,
    state?: SessionProviderState,
  ): Promise<void>;
}

export interface AgentBackendOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  webSocketFactory?: (url: string | URL, init?: WebSocketInit) => WebSocket;
}

export interface AgentBackendStatus {
  active: number;
  busy: number;
  idle: number;
  providers: Record<string, number>;
}

export const AGENT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  resume: true,
  fork: true,
  permissions: false,
};
