import type {
  ProviderCapabilities,
  ProviderSpawnOptions,
  ProviderTurnOptions,
  StreamEvent,
  TurnInput,
} from '../../../core/types.js';
import type { CompatibilityProfileSelection } from '../../../core/compatibility/types.js';

export type { CompatibilityProfileSelection } from '../../../core/compatibility/types.js';

export type {
  PermissionMode,
  ProviderCapabilities,
  ProviderMessage,
  ProviderSpawnOptions,
  ProviderTurnOptions,
  StreamEvent,
  TurnInput,
} from '../../../core/types.js';

export const KNOWN_PROVIDERS = [
  'claude',
  'codex',
  'gemini',
  'cursor',
  'copilot',
  'opencode',
  'kilo',
  'goose',
  'pi',
  'auggie',
  'junie',
  'kiro',
] as const;
export type ProviderName = typeof KNOWN_PROVIDERS[number];

/** Raw NDJSON line parsed from CLI stdout */
export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
      thinking?: string;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    } | string>;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  content_block?: {
    type?: string;
    text?: string;
    name?: string;
    id?: string;
    input?: Record<string, unknown>;
    thinking?: string;
    tool_use_id?: string;
    content?: unknown;
    is_error?: boolean;
  };
  content_block_delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    signature?: string;
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
  buildStdinMessage(content: string, turn?: TurnInput): string;
  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null;
  buildAutoResponse?(line: string): string | null;
  getPendingTurnStart?(): string | null;
  streamTurn?(turn: TurnInput, opts: ProviderTurnOptions): AsyncGenerator<StreamEvent>;
  /** Called before spawn for ephemeral providers that need the message in args (e.g. -p flag). */
  prepareEphemeralTurn?(turn: TurnInput): void;
  /** Override the default first-event timeout for ephemeral providers. */
  resolveFirstEventTimeoutMs?(defaultTimeoutMs: number): number;
  beforeTurn?(opts: ProviderSpawnOptions): Promise<void>;
  afterTurn?(opts: ProviderSpawnOptions): Promise<StreamEvent | StreamEvent[] | null>;
}
