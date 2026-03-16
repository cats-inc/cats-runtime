export type { CliRuntimeConfig as RuntimeConfig } from '../backends/cli/config.js';

export type SessionStatus =
  | 'initializing'
  | 'ready'
  | 'busy'
  | 'closing'
  | 'closed';

export type SessionOrigin = 'runtime' | 'discovered';
export type SessionActivity = 'interactive' | 'tearing_down' | 'inactive';
export type SessionOwnership = 'persistent_process' | 'logical_session' | 'workspace_latest';
export type SessionResumeStrategy = 'none' | 'provider_session' | 'latest_in_workspace';
export type SessionControlMode = 'full' | 'resume_only' | 'observe_only';
export type ProviderBackend = 'cli' | 'api' | 'local';

export type WorkspaceMode = 'isolated' | 'shared' | 'read_only';

export interface SessionControls {
  canSend: boolean;
  canResume: boolean;
  canClose: boolean;
  canDelete: boolean;
  canRefresh: boolean;
}

export interface SessionInfo {
  id: string;
  providerName: string;
  providerBackend?: ProviderBackend;
  providerInstanceId?: string;
  providerSessionId?: string;
  status: SessionStatus;
  origin: SessionOrigin;
  cwd: string;
  workspaceMode?: WorkspaceMode;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
  model?: string;
  group?: string;
  // Deprecated legacy flag kept only for backward-compat payload tolerance.
  managed?: boolean;
  summary?: string;
  sourcePath?: string;
  providerSourcePath?: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  createdAt: string;
  updatedAt: string;
  lastActivity?: string;
}

export interface SessionView extends SessionInfo {
  workspaceKey: string;
  activity: SessionActivity;
  ownership: SessionOwnership;
  resumeStrategy: SessionResumeStrategy;
  controlMode: SessionControlMode;
  attached: boolean;
  controls: SessionControls;
}

export interface ProviderCapabilities {
  resume: boolean;
  fork: boolean;
  permissions: boolean;
}

export type PermissionMode = 'skip' | 'whitelist' | 'default';

export interface ProviderSpawnOptions {
  cwd: string;
  workspaceMode?: WorkspaceMode;
  model?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  permissionMode?: PermissionMode;
  allowedTools?: string[];
}

export interface ProviderTurnOptions extends ProviderSpawnOptions {
  signal?: AbortSignal;
}

export interface ProviderMessage {
  role: 'user';
  content: string;
}

export interface StreamEvent {
  type: 'init' | 'text' | 'tool_use' | 'tool_result' | 'result' | 'error' | 'raw';
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
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'unavailable';
  checkedAt: string;
  details?: string;
}

export interface ExecutionHandle {
  readonly active: boolean;
  readonly busy: boolean;
  streamMessage(message: string): AsyncGenerator<StreamEvent>;
  kill(): void;
  on(event: 'event' | 'exit' | 'error', listener: (...args: unknown[]) => void): this;
  off(event: 'event' | 'exit' | 'error', listener: (...args: unknown[]) => void): this;
}
