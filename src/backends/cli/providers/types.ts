import type { WorkspaceMode } from '../pool/types.js';

export const KNOWN_PROVIDERS = ['claude', 'codex', 'gemini', 'copilot', 'cursor', 'kiro', 'auggie', 'opencode'] as const;
export type ProviderName = typeof KNOWN_PROVIDERS[number];

export interface ProviderCapabilities {
  resume: boolean;
  fork: boolean;
  permissions: boolean;
}

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

export type PermissionMode = 'skip' | 'whitelist' | 'default';

export interface ProviderMessage {
  role: 'user';
  content: string;
}

/** Raw NDJSON line parsed from CLI stdout */
export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string } | string>;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  content_block_delta?: {
    type?: string;
    text?: string;
  };
  tool_use?: {
    name?: string;
    id?: string;
  };
}

/** Normalized event emitted to consumers */
export interface StreamEvent {
  type: 'init' | 'text' | 'tool_use' | 'result' | 'error' | 'raw';
  sessionId?: string;
  text?: string;
  toolName?: string;
  toolId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  raw?: ClaudeStreamEvent;
}

export interface Provider {
  name: string;
  capabilities: ProviderCapabilities;
  ephemeral?: boolean;
  buildSpawnArgs(opts: ProviderSpawnOptions): string[];
  buildStdinMessage(content: string): string;
  parseStreamLine(line: string): StreamEvent | null;
  buildAutoResponse?(line: string): string | null;
  getPendingTurnStart?(): string | null;
  streamTurn?(content: string, opts: ProviderTurnOptions): AsyncGenerator<StreamEvent>;
  /** Called before spawn for ephemeral providers that need the message in args (e.g. -p flag). */
  prepareEphemeralTurn?(content: string): void;
  beforeTurn?(opts: ProviderSpawnOptions): Promise<void>;
  afterTurn?(opts: ProviderSpawnOptions): Promise<StreamEvent | StreamEvent[] | null>;
}
