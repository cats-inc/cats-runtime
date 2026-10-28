import type {
  ProviderCapabilities,
  ProviderSpawnOptions,
  ProviderTurnOptions,
  RuntimeProviderRefusal,
  StreamEvent,
  TurnInput,
} from '../../../core/types.js';
import type { CompatibilityProfileSelection } from '../../../core/compatibility/types.js';
import type { InteractionAnswer, InteractionPrompt } from '../../../core/interactions/types.js';

export type { CompatibilityProfileSelection } from '../../../core/compatibility/types.js';

export type {
  PermissionMode,
  ProviderCapabilities,
  ProviderMessage,
  ProviderSpawnOptions,
  ProviderTurnOptions,
  RuntimeProviderRefusal,
  StreamEvent,
  TurnInput,
} from '../../../core/types.js';

export const KNOWN_PROVIDERS = [
  'claude',
  'codex',
  'antigravity',
  'cursor',
  'copilot',
  'opencode',
  'kilo',
  'goose',
  'pi',
  'auggie',
  'junie',
  'kiro',
  'grok',
  'cline',
  'devin',
  'muse',
] as const;
export type ProviderName = typeof KNOWN_PROVIDERS[number];

/** One unified rate-limit window inside a Claude Code `rate_limit_event`. */
export interface ClaudeRateLimitWindow {
  utilization?: number;
  resetsAt?: number;
}

/**
 * `rate_limit_info` payload of a Claude Code `rate_limit_event` frame. Claude Code derives it
 * from the unified rate-limit response headers of subscription-backed (OAuth) sessions, so it
 * is an account-level signal the CLI already holds. The runtime never reads credentials for it.
 */
export interface ClaudeRateLimitInfo {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  overageStatus?: string;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
  unifiedWindows?: Record<string, ClaudeRateLimitWindow>;
}

/** Raw NDJSON line parsed from CLI stdout */
export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  /** Present on `system:init` frames: configured MCP servers and their status. */
  mcp_servers?: unknown[];
  /** Present on `rate_limit_event` frames. */
  rate_limit_info?: ClaudeRateLimitInfo;
  /** Present on `result` frames. */
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  modelUsage?: Record<string, Record<string, unknown>>;
  /** Set on messages from a subagent's conversation rather than the main one. */
  parent_tool_use_id?: string | null;
  message?: {
    role?: string;
    /** The model that produced an `assistant` message, as the API reported it. */
    model?: string;
    content?: Array<{
      type?: string;
      text?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
      /** Present on direct native Claude tool calls in the captured protocol. */
      caller?: { type?: string };
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
  /** Internal host path mapping; absent for remote/unverified execution environments. */
  configureExecution?(context: ProviderExecutionContext): void;
  /** Place configured arguments where the native subcommand actually consumes them. */
  composeLaunchArgs?(configuredArgs: readonly string[], spawnArgs: readonly string[]): string[];
  buildStdinMessage(content: string, turn?: TurnInput): string;
  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null;
  classifyLaunchFailure?(input: ProviderLaunchFailureInput): RuntimeProviderRefusal | null;
  buildAutoResponse?(line: string): string | null;
  /** Host-owned asynchronous replies, scoped to one live child and active turn. */
  buildServerResponse?(line: string, context: ProviderServerRequestContext): Promise<string | null>;
  getPendingTurnStart?(): string | null;
  /** Initializes a session for inspection without creating a model turn. */
  buildInitialization?(): string | null;
  isSessionInitializing?(): boolean;
  getPendingControlMessages?(): string | null;
  /** How control replies match the control requests Runtime writes; JSON-RPC `id` when absent. */
  controlCorrelation?: ProviderControlCorrelation;
  readSessionCapabilities?(request: (line: string, timeoutMs?: number) => Promise<Record<string, unknown>>,
    refresh: boolean): Promise<import('../../../core/interactions/capabilities.js').ProviderSessionCapabilities>;
  streamTurn?(turn: TurnInput, opts: ProviderTurnOptions): AsyncGenerator<StreamEvent>;
  /** Called before spawn for ephemeral providers that need the message in args (e.g. -p flag). */
  prepareEphemeralTurn?(turn: TurnInput): void;
  /** Override the default first-event timeout for ephemeral providers. */
  resolveFirstEventTimeoutMs?(defaultTimeoutMs: number): number;
  beforeTurn?(opts: ProviderSpawnOptions): Promise<void>;
  afterTurn?(opts: ProviderSpawnOptions): Promise<StreamEvent | StreamEvent[] | null>;
}

export interface ProviderControlCorrelation {
  /** Identifier of a control request Runtime is about to write, or undefined when invalid. */
  requestId(frame: Record<string, unknown>): string | number | undefined;
  /** The reply's identifier and payload, or undefined when the frame is not a control reply. */
  reply(frame: Record<string, unknown>): {
    id: string | number;
    result?: Record<string, unknown>;
    failed: boolean;
  } | undefined;
}

export interface ProviderExecutionContext {
  localWorkspaceCwd?: string;
}

export interface ProviderServerRequestContext {
  signal: AbortSignal;
  interactions?: {
    request(input: {
      prompt: InteractionPrompt;
      deadlineMs?: number;
      response(answer: InteractionAnswer): string;
      fallback(reason: string): string;
    }): string;
    resolve(interactionId: string): void;
    unavailable?(kind: InteractionPrompt['kind'], reason: string): void;
  };
}

export interface ProviderLaunchFailureInput {
  source: 'stderr' | 'timeout' | 'exit';
  line?: string;
  stderrLines: string[];
  exitCode?: number | null;
}
