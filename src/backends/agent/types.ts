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

export interface AgentAdapterInspectionCredential {
  kind: 'url' | 'base_url' | 'auth_token' | 'password';
  configured: boolean;
}

export interface AgentAdapterProbeCheck {
  code: string;
  status: HealthStatus['status'];
  message: string;
  details?: Record<string, unknown>;
}

export interface AgentAdapterProbeResult {
  health: HealthStatus;
  liveProbe?: Record<string, unknown>;
  checks?: AgentAdapterProbeCheck[];
}

export interface AgentAdapterToolCatalogEntry {
  name: string;
  title?: string;
  groupId?: string;
  source: 'core' | 'plugin' | 'channel' | 'session' | 'unknown';
  pluginId?: string;
  optional?: boolean;
}

export interface AgentAdapterToolCatalogGroup {
  id: string;
  label?: string;
  toolCount: number;
}

export interface AgentAdapterToolCatalog {
  method: 'tools_catalog' | 'tools_effective' | 'providers_get';
  summary: string;
  toolCount: number;
  groupCount: number;
  groups: AgentAdapterToolCatalogGroup[];
  tools: AgentAdapterToolCatalogEntry[];
}

export interface AgentAdapterInspection {
  adapter: string;
  family: 'gateway' | 'bridge' | 'generic';
  summary: string;
  endpoint?: string;
  transport: {
    kind: 'websocket' | 'http';
    protocol: 'openclaw_gateway_v3' | 'agent_sdk_http_v1' | 'generic';
    liveProbe: 'rpc_health' | 'providers_get' | 'none';
    modelDiscovery: 'models_list' | 'providers_get' | 'none';
    toolDiscovery: 'tools_catalog' | 'tools_effective' | 'providers_get' | 'none';
    streaming: 'agent_event_frames' | 'sse' | 'generic';
  };
  request: {
    headerNames: string[];
  };
  auth: {
    mechanisms: Array<'connect_auth' | 'handshake_header' | 'bearer_header'>;
    credentials: AgentAdapterInspectionCredential[];
  };
  continuity: {
    providerManagedSessions: true;
    sessionKey: true;
    providerSessionState: true;
    cancel: boolean;
  };
  capabilities: {
    probe: boolean;
    modelDiscovery: boolean;
    toolCatalog: boolean;
    cancel: boolean;
    runtimeServices: boolean;
    toolCallEvents: boolean;
  };
}

export interface AgentAdapter {
  readonly kind: string;
  invoke(input: AgentInvokeInput): AsyncGenerator<StreamEvent>;
  probe?(instance: RemoteProviderInstanceConfig): Promise<AgentAdapterProbeResult>;
  listModels?(instance: RemoteProviderInstanceConfig): Promise<Array<{ id: string; label: string }>>;
  listTools?(instance: RemoteProviderInstanceConfig): Promise<AgentAdapterToolCatalog>;
  inspect?(instance: RemoteProviderInstanceConfig): AgentAdapterInspection;
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
