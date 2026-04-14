import type {
  HealthStatus,
  PermissionMode,
  ProviderCapabilities,
  RuntimeToolPolicyInspection,
  SessionInvocationContext,
  SessionProviderState,
  SessionWorkspaceState,
  StreamEvent,
  TurnInput,
  WorkspaceMode,
} from '../../core/types.js';
import type { ProviderEvolutionEvidenceObserver } from '../../core/compatibility/providerEvolution.js';
import type { RemoteProviderInstanceConfig } from '../cli/config.js';

export interface AgentAcpHostContext {
  sessionId: string;
  providerName: string;
  providerInstanceId?: string;
  cwd: string;
  workspace: SessionWorkspaceState;
  workspaceMode?: WorkspaceMode;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  toolProfile?: string;
  outputDir?: string;
  context?: SessionInvocationContext;
}

export interface AgentAcpHostDescription {
  summary: string;
  workspace: Pick<SessionWorkspaceState, 'kind' | 'access' | 'runtimeCwd' | 'sourceCwd'> & {
    worktreePath?: string;
  };
  toolPolicy: RuntimeToolPolicyInspection;
  capabilities: {
    permissionPolicy: boolean;
    filesystem: boolean;
    terminal: boolean;
    toolExecution: boolean;
    clientMcpServers: boolean;
  };
}

export interface AgentAcpHostToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentAcpHostToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentAcpHostToolResult {
  callId: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface AgentAcpHostMcpHeader {
  name: string;
  value: string;
}

export type AgentAcpHostMcpServer =
  | {
      type: 'stdio';
      name: string;
      command: string;
      args: string[];
      env: AgentAcpHostMcpHeader[];
    }
  | {
      type: 'http' | 'sse';
      name: string;
      url: string;
      headers: AgentAcpHostMcpHeader[];
    };

export interface AgentAcpHostBridge {
  describe(context: AgentAcpHostContext): AgentAcpHostDescription;
  listTools(context: AgentAcpHostContext): AgentAcpHostToolDefinition[];
  listMcpServers?(context: AgentAcpHostContext): AgentAcpHostMcpServer[];
  executeTool(
    context: AgentAcpHostContext,
    call: AgentAcpHostToolCall,
  ): Promise<AgentAcpHostToolResult>;
}

export interface AgentAcpHostBinding {
  bridge: AgentAcpHostBridge;
  context: AgentAcpHostContext;
}

export interface AgentInvokeInput {
  sessionId: string;
  providerName: string;
  instance: RemoteProviderInstanceConfig;
  model?: string;
  turn: TurnInput;
  sessionKey: string;
  providerSessionId?: string;
  sessionState?: SessionProviderState;
  evolutionObserver?: ProviderEvolutionEvidenceObserver;
  acpHost?: AgentAcpHostBinding;
  signal: AbortSignal;
}

export interface AgentAdapterInspectionCredential {
  kind: 'url' | 'base_url' | 'auth_token' | 'password';
  configured: boolean;
}

export interface AgentAdapterInspectionLaunch {
  kind: 'stdio';
  command?: string;
  args?: string[];
  cwd?: string;
  startupTimeoutMs?: number;
}

export interface AgentCliCommandRunnerOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface AgentCliCommandRunnerResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export type AgentCliCommandRunner = (
  command: string,
  args: string[],
  options?: AgentCliCommandRunnerOptions,
) => Promise<AgentCliCommandRunnerResult>;

export interface AgentSpawnedProcess {
  stdin?: NodeJS.WritableStream | null;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  exitCode?: number | null;
  killed?: boolean;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: 'error', listener: (error: Error) => void): this;
  on(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
}

export type AgentProcessSpawner = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
  },
) => AgentSpawnedProcess;

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

export interface AgentAdapterToolCatalogRequest {
  scope?: 'catalog' | 'effective';
  sessionKey?: string;
}

export interface AgentAdapterInspection {
  adapter: string;
  family: 'gateway' | 'bridge' | 'protocol' | 'generic';
  summary: string;
  endpoint?: string;
  launch?: AgentAdapterInspectionLaunch;
  transport: {
    kind: 'websocket' | 'http' | 'stdio';
    protocol: 'openclaw_gateway_v3' | 'agent_sdk_http_v1' | 'acp_v1' | 'generic';
    liveProbe: 'rpc_health' | 'providers_get' | 'command_help' | 'none';
    modelDiscovery: 'models_list' | 'providers_get' | 'session_bootstrap' | 'none';
    toolDiscovery: 'tools_catalog' | 'tools_effective' | 'providers_get' | 'session_bootstrap' | 'none';
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
    effectiveToolCatalog: boolean;
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
  listTools?(
    instance: RemoteProviderInstanceConfig,
    request?: AgentAdapterToolCatalogRequest,
  ): Promise<AgentAdapterToolCatalog>;
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
  acpHostBridge?: AgentAcpHostBridge;
  cliCommandRunner?: AgentCliCommandRunner;
  acpProcessSpawner?: AgentProcessSpawner;
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
