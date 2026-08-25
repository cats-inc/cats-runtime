import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  ProviderLaunchFailureInput,
  ProviderSpawnOptions,
  RuntimeProviderRefusal,
  StreamEvent,
  TurnInput,
} from './types.js';
import type {
  ErrorStreamEvent,
  RawStreamEvent,
  ResultStreamEvent,
  TextStreamEvent,
  ToolResultStreamEvent,
  ToolUseStreamEvent,
} from '../../../core/types.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';
import {
  observeIgnored,
  observeNormalized,
  observeRawPassthrough,
  observeUnknown,
} from '../../../core/compatibility/providerEvolution.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

export const GROK_STREAMING_JSON_PROFILE_ID = 'grok-cli-streaming-json-1.0.0';

export const GROK_STREAMING_JSON_BASE_ARGS = [
  '--output-format', 'streaming-json',
  '--max-turns', '100',
  '--disable-web-search',
  '--no-memory',
  '--no-subagents',
  '--verbatim',
] as const;

const GROK_TOOL_NAMES = [
  'ask_user_question',
  'enter_plan_mode',
  'exit_plan_mode',
  'get_command_or_subagent_output',
  'grep',
  'image_edit',
  'image_gen',
  'image_to_video',
  'kill_command_or_subagent',
  'list_dir',
  'monitor',
  'read_file',
  'reference_to_video',
  'run_terminal_command',
  'scheduler_create',
  'scheduler_delete',
  'scheduler_list',
  'search_replace',
  'search_tool',
  'spawn_subagent',
  'todo_write',
  'use_tool',
  'workflow',
  'write',
] as const;

const GROK_TOOL_NAME_SET = new Set<string>(GROK_TOOL_NAMES);
const GROK_TOOL_ALIASES: Record<string, string> = {
  bash: 'run_terminal_command',
  edit: 'search_replace',
  glob: 'list_dir',
  read: 'read_file',
  shell: 'run_terminal_command',
  terminal: 'run_terminal_command',
  write_file: 'write',
};

interface GrokNativeUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  total_tokens?: unknown;
}

interface GrokNativeStreamEvent {
  type?: unknown;
  data?: unknown;
  message?: unknown;
  sessionId?: unknown;
  requestId?: unknown;
  stopReason?: unknown;
  total_cost_usd?: unknown;
  usage?: GrokNativeUsage;
  toolCallId?: unknown;
  toolName?: unknown;
  title?: unknown;
  kind?: unknown;
  status?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: unknown;
}

interface PendingGrokTool {
  name: string;
  kind?: string;
}

export class GrokProvider implements Provider {
  name = 'grok';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: true, permissions: true };

  private pendingPrompt: string | null = null;
  private readonly pendingTools = new Map<string, PendingGrokTool>();

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
    this.pendingTools.clear();
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const prompt = this.pendingPrompt;
    if (!prompt) {
      throw new Error('Grok CLI requires prepareEphemeralTurn before building spawn arguments.');
    }
    this.pendingPrompt = null;

    const args = [
      '-p',
      prompt,
      ...(this.compatibilityProfile?.spawnBaseArgs ?? GROK_STREAMING_JSON_BASE_ARGS),
      '--cwd',
      opts.cwd,
    ];

    const model = normalizeGrokModelId(opts.model);
    if (model) {
      args.push('--model', model);
    }
    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }
    if (opts.forkSession) {
      if (!opts.resumeSessionId) {
        throw new Error('Grok CLI fork requires a resume session id.');
      }
      args.push('--fork-session');
    }

    appendGrokPermissionArgs(args, opts);
    return args;
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  classifyLaunchFailure(input: ProviderLaunchFailureInput): RuntimeProviderRefusal | null {
    const evidenceSummary = [input.line, ...input.stderrLines]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' | ');
    const normalized = evidenceSummary.toLowerCase();

    if (
      normalized.includes('not signed in')
      || normalized.includes('grok login --device-code')
      || normalized.includes('set the xai_api_key')
    ) {
      return {
        category: 'auth_required',
        message: 'Grok CLI is not signed in. Run grok login --device-code or configure XAI_API_KEY.',
        statusCode: 401,
        retryable: false,
        source: input.source,
        evidenceSummary,
      };
    }

    if (normalized.includes('unknown model id') || normalized.includes("couldn't set model")) {
      return {
        category: 'provider_rejected',
        message: 'Grok CLI rejected the requested model. Run grok models and select an available id.',
        statusCode: 400,
        retryable: false,
        source: input.source,
        evidenceSummary,
      };
    }

    if (normalized.includes('requirements unsatisfied') || normalized.includes('session initialization failed')) {
      return {
        category: 'provider_rejected',
        message: 'Grok CLI rejected the selected tool configuration.',
        statusCode: 400,
        retryable: false,
        source: input.source,
        evidenceSummary,
      };
    }

    return null;
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const text = line.trim();
    if (!text) return null;

    let event: GrokNativeStreamEvent;
    try {
      event = JSON.parse(text) as GrokNativeStreamEvent;
    } catch {
      return observeRawPassthrough(this.evolutionObserver, {
        rawEventType: 'non_json_line',
        reason: 'stdout_passthrough',
        rawSample: text,
      }, {
        type: 'raw',
        text,
      } satisfies RawStreamEvent);
    }

    if (event.type === 'available_commands' || event.type === 'usage') {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: String(event.type),
        reason: 'stream_metadata',
        rawSample: event,
      }, null);
    }

    if (event.type === 'thought' && typeof event.data === 'string' && event.data) {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'thought',
        rawSample: event,
      }, createRuntimeProgressEvent({
        text: event.data,
        provider: 'grok',
        backend: 'cli',
        kind: 'reasoning',
        status: 'running',
        source: 'provider',
        native: { sourceEvent: 'thought' },
      }));
    }

    if (event.type === 'text' && typeof event.data === 'string' && event.data) {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'text',
        rawSample: event,
      }, {
        type: 'text',
        text: event.data,
        raw: event,
      } satisfies TextStreamEvent);
    }

    if (event.type === 'tool_call') {
      return this.parseToolCall(event);
    }

    if (event.type === 'tool_call_update') {
      return this.parseToolCallUpdate(event);
    }

    if (event.type === 'error') {
      const message = typeof event.message === 'string' && event.message.trim()
        ? event.message
        : 'Grok CLI request failed.';
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'error',
        rawSample: event,
      }, {
        type: 'error',
        text: message,
        raw: event,
      } satisfies ErrorStreamEvent);
    }

    if (event.type === 'end') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'end',
        rawSample: event,
      }, {
        type: 'result',
        ...(typeof event.sessionId === 'string' ? { sessionId: event.sessionId } : {}),
        ...(event.usage ? { usage: normalizeGrokUsage(event.usage, event.total_cost_usd) } : {}),
        raw: event,
      } satisfies ResultStreamEvent);
    }

    return observeUnknown(this.evolutionObserver, {
      rawEventType: typeof event.type === 'string' ? event.type : 'unknown_json',
      rawSample: event,
    }, {
      type: 'raw',
      raw: event,
    } satisfies RawStreamEvent);
  }

  private parseToolCall(event: GrokNativeStreamEvent): StreamEvent | StreamEvent[] {
    const toolId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
    const toolName = typeof event.toolName === 'string'
      ? event.toolName
      : typeof event.title === 'string'
        ? event.title
        : 'unknown';
    const kind = typeof event.kind === 'string' ? event.kind : undefined;
    if (toolId) {
      this.pendingTools.set(toolId, { name: toolName, kind });
    }
    const toolArgs = asRecord(event.rawInput);

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'tool_call',
      rawSample: event,
    }, [
      createRuntimeProgressEvent({
        text: `Running Grok tool: ${toolName}`,
        provider: 'grok',
        backend: 'cli',
        kind: kind === 'execute' ? 'command' : 'tool',
        status: 'running',
        source: 'provider',
        native: {
          sourceEvent: 'tool_call',
          toolName,
          ...(toolId ? { toolId } : {}),
        },
      }),
      {
        type: 'tool_use',
        toolName,
        ...(toolId ? { toolId } : {}),
        ...(toolArgs ? { toolArgs } : {}),
        raw: event,
      } satisfies ToolUseStreamEvent,
    ]);
  }

  private parseToolCallUpdate(event: GrokNativeStreamEvent): StreamEvent[] | null {
    const toolId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
    const pending = toolId ? this.pendingTools.get(toolId) : undefined;
    const status = typeof event.status === 'string' ? event.status : undefined;
    if (status !== 'completed' && status !== 'failed') {
      return null;
    }

    const toolName = pending?.name ?? 'unknown';
    if (toolId) {
      this.pendingTools.delete(toolId);
    }
    const isError = status === 'failed';
    const resultText = extractGrokToolResultText(event);

    return observeNormalized(this.evolutionObserver, {
      rawEventType: `tool_call_update:${status}`,
      rawSample: event,
    }, [
      createRuntimeProgressEvent({
        text: isError
          ? `Grok tool failed: ${toolName}`
          : `Grok tool completed: ${toolName}`,
        provider: 'grok',
        backend: 'cli',
        kind: pending?.kind === 'execute' ? 'command' : 'tool',
        status: isError ? 'failed' : 'completed',
        source: 'provider',
        native: {
          sourceEvent: 'tool_call_update',
          toolName,
          ...(toolId ? { toolId } : {}),
        },
      }),
      {
        type: 'tool_result',
        toolName,
        ...(toolId ? { toolId } : {}),
        ...(resultText ? { text: resultText } : {}),
        ...(isError ? { isError: true } : {}),
        raw: event,
      } satisfies ToolResultStreamEvent,
    ]);
  }
}

function appendGrokPermissionArgs(args: string[], opts: ProviderSpawnOptions): void {
  if (opts.permissionMode === 'skip') {
    args.push('--permission-mode', 'auto', '--always-approve');
    return;
  }

  if (opts.permissionMode !== 'whitelist') {
    // Grok 1.0.0 still executed edits in both plan and dontAsk modes. Keep
    // runtime "default" fail-safe by exposing only the live-probed read tool.
    args.push('--permission-mode', 'dontAsk', '--tools', 'read_file');
    return;
  }

  const allowedTools = normalizeGrokAllowedTools(opts.allowedTools ?? []);
  if (allowedTools.length === 0) {
    throw new Error(
      'Grok CLI 1.0.0 cannot enforce an empty tool allowlist safely; '
      + 'plan, deny, and disallowed-tools modes still executed tools in live probes.',
    );
  }
  if (allowedTools.includes('search_replace') && !allowedTools.includes('read_file')) {
    throw new Error('Grok search_replace requires read_file in the same tool allowlist.');
  }

  args.push('--permission-mode', 'dontAsk', '--tools', allowedTools.join(','));
}

function normalizeGrokAllowedTools(tools: string[]): string[] {
  const normalized = new Set<string>();
  for (const tool of tools) {
    const candidate = tool.trim().toLowerCase().replace(/[ -]+/g, '_');
    if (!candidate) continue;
    const resolved = GROK_TOOL_ALIASES[candidate] ?? candidate;
    if (!GROK_TOOL_NAME_SET.has(resolved)) {
      throw new Error(`Unsupported Grok tool allowlist entry: ${tool}`);
    }
    normalized.add(resolved);
  }
  return [...normalized];
}

function normalizeGrokModelId(model?: string): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === 'grok-default') {
    return undefined;
  }
  return trimmed;
}

function normalizeGrokUsage(usage: GrokNativeUsage, totalCostUsd: unknown) {
  const promptInputTokens = finiteNumber(usage.input_tokens);
  const cacheReadInputTokens = finiteNumber(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = finiteNumber(usage.cache_creation_input_tokens);
  const outputTokens = finiteNumber(usage.output_tokens);
  const computedTotal = promptInputTokens
    + cacheReadInputTokens
    + cacheCreationInputTokens
    + outputTokens;

  return {
    inputTokens: promptInputTokens + cacheReadInputTokens + cacheCreationInputTokens,
    outputTokens,
    promptInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens: numberOrUndefined(usage.total_tokens) ?? computedTotal,
    ...(typeof totalCostUsd === 'number' && Number.isFinite(totalCostUsd)
      ? { estimatedCost: totalCostUsd, currency: 'USD' }
      : {}),
  };
}

function extractGrokToolResultText(event: GrokNativeStreamEvent): string | undefined {
  const contentText = extractText(event.content);
  if (contentText) {
    return contentText;
  }

  const rawOutput = asRecord(event.rawOutput);
  if (!rawOutput) {
    return undefined;
  }

  return findFirstString(rawOutput, [
    'tool_output_for_prompt',
    'raw_output',
    'FileNotFound',
    'content',
  ]);
}

function extractText(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;

    if (record.type === 'diff' && typeof record.path === 'string') {
      parts.push(`Updated ${record.path}`);
      continue;
    }

    const nested = asRecord(record.content);
    if (nested?.type === 'text' && typeof nested.text === 'string' && nested.text) {
      parts.push(nested.text);
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

function findFirstString(value: unknown, preferredKeys: string[]): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return typeof value === 'string' && value ? value : undefined;
  }

  for (const key of preferredKeys) {
    if (typeof record[key] === 'string' && record[key]) {
      return record[key] as string;
    }
  }
  for (const nested of Object.values(record)) {
    const matched = findFirstString(nested, preferredKeys);
    if (matched) return matched;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number {
  return numberOrUndefined(value) ?? 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
