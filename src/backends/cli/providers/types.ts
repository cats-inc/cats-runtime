import type {
  ProviderCapabilities,
  ProviderSpawnOptions,
  ProviderTurnOptions,
  StreamEvent,
} from '../../../core/types.js';

export type {
  PermissionMode,
  ProviderCapabilities,
  ProviderMessage,
  ProviderSpawnOptions,
  ProviderTurnOptions,
  StreamEvent,
} from '../../../core/types.js';

export const KNOWN_PROVIDERS = ['claude', 'codex', 'gemini', 'copilot', 'cursor', 'kiro', 'auggie', 'opencode', 'pi', 'goose', 'junie'] as const;
export type ProviderName = typeof KNOWN_PROVIDERS[number];

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
