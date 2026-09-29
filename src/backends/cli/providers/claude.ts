import type {
  ClaudeRateLimitInfo,
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  ClaudeStreamEvent,
  TurnInput,
} from './types.js';
import type {
  InitStreamEvent,
  ProgressStreamEvent,
  RawStreamEvent,
  ReportedModel,
  ResultStreamEvent,
  RuntimeProgressStatus,
  TextStreamEvent,
  ToolResultStreamEvent,
  ToolUseStreamEvent,
} from '../../../core/types.js';
import type { SessionMcpServerLaunch } from '../../../core/sessionMcpServers.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';
import {
  observeNormalized,
  observeRawPassthrough,
} from '../../../core/compatibility/providerEvolution.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

export class ClaudeProvider implements Provider {
  name = 'claude';
  capabilities: ProviderCapabilities = {
    resume: true,
    fork: true,
    permissions: true,
    sessionMcpServers: true,
  };

  /**
   * Latest account rate-limit snapshot observed on this worker. Claude Code emits a
   * `rate_limit_event` around every API call, so the turn's `result` can carry the freshest
   * snapshot as `metadata.runtimeUsage.quota` without any extra request or credential access.
   */
  private _lastRateLimit: ClaudeQuotaSnapshot | null = null;
  private requestedModel: string | null = null;
  /** Models of this turn's main-conversation replies, reported with its result. */
  private turnModels: string[] = [];

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = this.compatibilityProfile?.spawnBaseArgs
      ? [...this.compatibilityProfile.spawnBaseArgs]
      : [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
      ];

    if (opts.model) {
      args.push('--model', opts.model);
    }
    this.requestedModel = opts.model?.trim() || null;
    if (typeof opts.modelControls?.['claude.reasoning_effort'] === 'string') {
      args.push('--effort', opts.modelControls['claude.reasoning_effort']);
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    if (opts.forkSession) {
      args.push('--fork-session');
    }

    const mcpServers = opts.mcpServers ?? [];
    if (mcpServers.length > 0) {
      args.push('--mcp-config', buildClaudeSessionMcpConfig(mcpServers));
    }
    // `-p` denies tools that are not pre-approved, so session MCP servers must be
    // allowed explicitly unless every permission check is already skipped.
    const mcpAllowedTools = mcpServers.map((server) => `mcp__${server.name}`);

    switch (opts.permissionMode) {
      case 'skip':
        args.push('--dangerously-skip-permissions');
        break;
      case 'whitelist': {
        const allowedTools = [...(opts.allowedTools ?? []), ...mcpAllowedTools];
        if (allowedTools.length) {
          args.push('--allowedTools', allowedTools.join(','));
        }
        break;
      }
      default:
        if (mcpAllowedTools.length) {
          args.push('--allowedTools', mcpAllowedTools.join(','));
        }
    }

    return args;
  }

  buildStdinMessage(content: string, turn?: TurnInput): string {
    const msg = {
      type: 'user',
      message: {
        role: 'user',
        content: compileRuntimeTurnPrompt(content, turn),
      },
    };
    return JSON.stringify(msg) + '\n';
  }

  /**
   * Claude Code resolves an alias such as `opus` to a full model ID and names it
   * on every API reply. Subagent replies (`parent_tool_use_id`) may use other
   * models by design, and `<synthetic>` marks locally generated messages.
   */
  private noteServedModel(event: ClaudeStreamEvent): void {
    const model = event.type === 'assistant' && !event.parent_tool_use_id
      ? event.message?.model?.trim()
      : undefined;
    if (model && !model.startsWith('<') && !this.turnModels.includes(model)) {
      this.turnModels.push(model);
    }
  }

  private takeReportedModels(): { reportedModels?: ReportedModel[] } {
    const models = this.turnModels;
    this.turnModels = [];
    if (models.length === 0) return {};
    const requested = this.requestedModel;
    return {
      reportedModels: models.map((model) => ({
        model,
        ...(requested ? { matchesRequest: claudeServedRequestedModel(requested, model) } : {}),
      })),
    };
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let event: ClaudeStreamEvent;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // Non-JSON line (startup messages, etc.)
      return observeRawPassthrough(this.evolutionObserver, {
        reason: 'non_json_line',
        rawSample: trimmed,
      }, {
        type: 'raw',
        text: trimmed,
      } satisfies RawStreamEvent);
    }

    this.noteServedModel(event);

    // system/init — session ID
    if (event.type === 'system' && event.subtype === 'init') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'system:init',
        rawSample: event,
      }, {
        type: 'init',
        sessionId: event.session_id,
        ...(Array.isArray(event.mcp_servers)
          ? { mcpServers: normalizeClaudeMcpServerStatuses(event.mcp_servers) }
          : {}),
        raw: event,
      } satisfies InitStreamEvent);
    }

    // assistant message — accumulate text content
    if (event.type === 'assistant' && event.message?.content) {
      const contentEvents = extractClaudeAssistantEvents(event.message.content);
      if (contentEvents.length > 0) {
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'assistant',
          rawSample: event,
        }, contentEvents.length === 1 ? contentEvents[0]! : contentEvents);
      }
    }

    if (event.type === 'assistant' && event.tool_use) {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'assistant:tool_use',
        rawSample: event,
      }, createClaudeToolUseEvents({
        name: event.tool_use.name,
        id: event.tool_use.id,
        sourceEvent: 'assistant',
      }));
    }

    if (event.type === 'content_block_start' && event.content_block) {
      const blockEvents = extractClaudeContentBlockEvents(event.content_block, 'content_block_start');
      if (blockEvents.length > 0) {
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'content_block_start',
          rawSample: event,
        }, blockEvents.length === 1 ? blockEvents[0]! : blockEvents);
      }
    }

    // content_block_delta — streaming text chunks
    if (event.type === 'content_block_delta' && event.content_block_delta) {
      const deltaEvents = extractClaudeContentBlockDeltaEvents(event.content_block_delta, event);
      if (deltaEvents.length > 0) {
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'content_block_delta',
          rawSample: event,
        }, deltaEvents.length === 1 ? deltaEvents[0]! : deltaEvents);
      }
    }

    // rate_limit_event — account-level rate-limit snapshot the CLI already holds
    if (event.type === 'rate_limit_event') {
      const snapshot = normalizeClaudeRateLimit(event.rate_limit_info);
      if (!snapshot) {
        return observeRawPassthrough(this.evolutionObserver, {
          rawEventType: 'rate_limit_event',
          reason: 'rate_limit_event_without_info',
          rawSample: event,
        }, {
          type: 'raw',
          raw: event,
        } satisfies RawStreamEvent);
      }

      this._lastRateLimit = snapshot;
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'rate_limit_event',
        rawSample: event,
      }, createClaudeQuotaProgressEvent(snapshot, event.rate_limit_info));
    }

    // result — done, with token usage, list-price cost, and the latest quota snapshot
    if (event.type === 'result') {
      const estimatedCost = finiteNumber(event.total_cost_usd);
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'result',
        rawSample: event,
      }, {
        type: 'result',
        sessionId: event.session_id,
        usage: event.usage ? {
          inputTokens: (event.usage.input_tokens ?? 0)
            + (event.usage.cache_read_input_tokens ?? 0)
            + (event.usage.cache_creation_input_tokens ?? 0),
          outputTokens: event.usage.output_tokens ?? 0,
          promptInputTokens: event.usage.input_tokens ?? 0,
          cacheReadInputTokens: event.usage.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: event.usage.cache_creation_input_tokens ?? 0,
          ...(estimatedCost === undefined ? {} : { estimatedCost, currency: 'USD' }),
        } : undefined,
        metadata: buildClaudeResultMetadata(event, this._lastRateLimit),
        ...this.takeReportedModels(),
        raw: event,
      } satisfies ResultStreamEvent);
    }

    // Pass through anything else as raw
    return observeRawPassthrough(this.evolutionObserver, {
      rawEventType: event.subtype ? `${event.type}:${event.subtype}` : event.type,
      reason: 'unhandled_claude_event',
      rawSample: event,
    }, {
      type: 'raw',
      raw: event,
    } satisfies RawStreamEvent);
  }
}

function extractClaudeAssistantEvents(
  content: NonNullable<ClaudeStreamEvent['message']>['content'],
): StreamEvent[] {
  const events: StreamEvent[] = [];
  const textParts: string[] = [];

  for (const block of content ?? []) {
    if (typeof block === 'string') {
      textParts.push(block);
      continue;
    }

    if (block.type === 'tool_use' || block.type === 'server_tool_use') {
      events.push(...createClaudeToolUseEvents({
        name: block.name,
        id: block.id,
        input: block.input,
        sourceEvent: 'assistant',
      }));
      continue;
    }

    if (block.type === 'tool_result' || block.type === 'server_tool_result') {
      events.push(...createClaudeToolResultEvents({
        toolId: block.tool_use_id,
        text: stringifyClaudeContent(block.content),
        isError: block.is_error === true,
        sourceEvent: 'assistant',
      }));
      continue;
    }

    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      events.push(createClaudeReasoningEvent(
        typeof block.thinking === 'string' ? block.thinking : block.text,
        'updated',
        'assistant',
      ));
      continue;
    }

    if (typeof block.text === 'string' && block.text) {
      textParts.push(block.text);
    }
  }

  const text = textParts.join('');
  if (text) {
    events.unshift({
      type: 'text',
      text,
    } satisfies TextStreamEvent);
  }

  return events;
}

function createClaudeToolUseEvents(tool: {
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  sourceEvent: string;
}): Array<ProgressStreamEvent | ToolUseStreamEvent> {
  const toolName = tool.name ?? 'unknown';
  return [
    createRuntimeProgressEvent({
      text: `Running tool: ${toolName}`,
      provider: 'claude',
      backend: 'cli',
      kind: 'tool',
      status: 'running',
      source: 'provider',
      native: {
        sourceEvent: tool.sourceEvent,
        toolName,
      },
    }),
    {
      type: 'tool_use',
      toolName,
      toolId: tool.id,
      toolArgs: tool.input,
    } satisfies ToolUseStreamEvent,
  ];
}

function createClaudeToolResultEvents(tool: {
  toolName?: string;
  toolId?: string;
  text?: string;
  isError?: boolean;
  sourceEvent: string;
}): Array<ProgressStreamEvent | ToolResultStreamEvent> {
  if (!tool.toolName && !tool.toolId && !tool.text) {
    return [];
  }

  return [
    createRuntimeProgressEvent({
      text: tool.toolName
        ? `Claude completed tool: ${tool.toolName}`
        : 'Claude completed a tool call.',
      provider: 'claude',
      backend: 'cli',
      kind: 'tool',
      status: tool.isError ? 'failed' : 'updated',
      source: 'provider',
      native: {
        sourceEvent: tool.sourceEvent,
        ...(tool.toolName ? { toolName: tool.toolName } : {}),
        ...(tool.toolId ? { toolId: tool.toolId } : {}),
      },
    }),
    {
      type: 'tool_result',
      ...(tool.toolName ? { toolName: tool.toolName } : {}),
      ...(tool.toolId ? { toolId: tool.toolId } : {}),
      ...(tool.text ? { text: tool.text } : {}),
      ...(tool.isError === true ? { isError: true } : {}),
    } satisfies ToolResultStreamEvent,
  ];
}

function createClaudeReasoningEvent(
  text: string | undefined,
  status: 'running' | 'updated',
  sourceEvent: string,
): ProgressStreamEvent {
  return createRuntimeProgressEvent({
    text: typeof text === 'string' && text.trim() ? text : 'Claude updated reasoning.',
    provider: 'claude',
    backend: 'cli',
    kind: 'reasoning',
    status,
    source: 'provider',
    native: {
      sourceEvent,
    },
  });
}

function extractClaudeContentBlockEvents(
  block: NonNullable<ClaudeStreamEvent['content_block']>,
  sourceEvent: string,
): StreamEvent[] {
  if (block.type === 'tool_use' || block.type === 'server_tool_use') {
    return createClaudeToolUseEvents({
      name: block.name,
      id: block.id,
      input: block.input,
      sourceEvent,
    });
  }

  if (block.type === 'tool_result' || block.type === 'server_tool_result') {
    return createClaudeToolResultEvents({
      toolName: block.name,
      toolId: block.tool_use_id,
      text: stringifyClaudeContent(block.content),
      isError: block.is_error === true,
      sourceEvent,
    });
  }

  if (block.type === 'thinking' || block.type === 'redacted_thinking') {
    return [createClaudeReasoningEvent(block.thinking ?? block.text, 'updated', sourceEvent)];
  }

  if (typeof block.text === 'string' && block.text) {
    return [{ type: 'text', text: block.text } satisfies TextStreamEvent];
  }

  return [];
}

function extractClaudeContentBlockDeltaEvents(
  delta: NonNullable<ClaudeStreamEvent['content_block_delta']>,
  raw: ClaudeStreamEvent,
): StreamEvent[] {
  if (delta.type === 'text_delta' && delta.text) {
    return [{
      type: 'text',
      text: delta.text,
      raw,
    } satisfies TextStreamEvent];
  }

  if (delta.type === 'thinking_delta') {
    return [createClaudeReasoningEvent(delta.thinking ?? delta.text, 'running', 'content_block_delta')];
  }

  return [];
}

function stringifyClaudeContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value || undefined;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface ClaudeQuotaSnapshot {
  quota: Record<string, string | number | boolean>;
  status: Extract<RuntimeProgressStatus, 'updated' | 'warned' | 'blocked'>;
  text: string;
}

/**
 * Flatten a Claude Code `rate_limit_info` payload into the runtime quota contract: primitive
 * key/value pairs, ISO timestamps, and one `<window>.utilization` / `<window>.resetsAt` pair
 * per unified window. Observed on Claude Code 2.1.267; see
 * docs/research/2026-09-10-claude-codex-rate-limit-signal-probe.md.
 */
function normalizeClaudeRateLimit(
  info: ClaudeRateLimitInfo | undefined,
): ClaudeQuotaSnapshot | null {
  if (!info || typeof info !== 'object') {
    return null;
  }

  const quota: Record<string, string | number | boolean> = {
    source: 'claude.rate_limit_event',
    observedAt: new Date().toISOString(),
  };
  if (typeof info.status === 'string' && info.status) {
    quota.status = info.status;
  }
  if (typeof info.rateLimitType === 'string' && info.rateLimitType) {
    quota.rateLimitType = info.rateLimitType;
  }
  const resetsAt = unixSecondsToIso(info.resetsAt);
  if (resetsAt) {
    quota.resetsAt = resetsAt;
  }
  if (typeof info.isUsingOverage === 'boolean') {
    quota.isUsingOverage = info.isUsingOverage;
  }
  if (typeof info.overageStatus === 'string' && info.overageStatus) {
    quota.overageStatus = info.overageStatus;
  }
  if (typeof info.overageDisabledReason === 'string' && info.overageDisabledReason) {
    quota.overageDisabledReason = info.overageDisabledReason;
  }

  const windows: string[] = [];
  const unifiedWindows = info.unifiedWindows && typeof info.unifiedWindows === 'object'
    ? info.unifiedWindows
    : {};
  for (const [name, window] of Object.entries(unifiedWindows)) {
    if (!window || typeof window !== 'object') {
      continue;
    }
    const utilization = finiteNumber(window.utilization);
    const windowResetsAt = unixSecondsToIso(window.resetsAt);
    if (utilization !== undefined) {
      quota[`${name}.utilization`] = utilization;
    }
    if (windowResetsAt) {
      quota[`${name}.resetsAt`] = windowResetsAt;
    }
    if (utilization !== undefined) {
      const resetLabel = windowResetsAt ? ` (resets ${windowResetsAt})` : '';
      windows.push(`${name} ${formatPercent(utilization)} used${resetLabel}`);
    }
  }

  const status = info.status === 'rejected'
    ? 'blocked'
    : info.status === 'allowed_warning'
      ? 'warned'
      : 'updated';
  const statusLabel = typeof info.status === 'string' && info.status ? info.status : 'observed';
  const headline = `Claude rate limit ${statusLabel}`;
  const text = windows.length > 0
    ? `${headline}: ${windows.join(', ')}.`
    : `${headline}.`;

  return { quota, status, text };
}

function createClaudeQuotaProgressEvent(
  snapshot: ClaudeQuotaSnapshot,
  info: ClaudeRateLimitInfo | undefined,
): ProgressStreamEvent {
  return createRuntimeProgressEvent({
    text: snapshot.text,
    provider: 'claude',
    backend: 'cli',
    kind: 'quota',
    status: snapshot.status,
    source: 'provider',
    native: {
      sourceEvent: 'rate_limit_event',
      ...(info ? { rateLimitInfo: info } : {}),
    },
    details: {
      quota: snapshot.quota,
    },
  });
}

function buildClaudeResultMetadata(
  event: ClaudeStreamEvent,
  rateLimit: ClaudeQuotaSnapshot | null,
): Record<string, unknown> {
  const durationMs = finiteNumber(event.duration_ms);
  const durationApiMs = finiteNumber(event.duration_api_ms);
  const numTurns = finiteNumber(event.num_turns);
  const modelUsage = event.modelUsage && typeof event.modelUsage === 'object'
    ? event.modelUsage
    : undefined;

  return {
    ...(rateLimit ? { runtimeUsage: { quota: rateLimit.quota } } : {}),
    native: {
      sourceEvent: 'result',
      ...(event.subtype ? { subtype: event.subtype } : {}),
      ...(typeof event.is_error === 'boolean' ? { isError: event.is_error } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(durationApiMs === undefined ? {} : { durationApiMs }),
      ...(numTurns === undefined ? {} : { numTurns }),
      ...(modelUsage ? { modelUsage } : {}),
    },
  };
}

/**
 * Whether a reply's model is the one requested with `--model`: the same ID, the
 * same ID with a release date (`claude-haiku-4-5-20251001`), or, for an alias
 * such as `opus`, any model of that family. `claude-opus-5` and
 * `claude-opus-5-5` are different models.
 */
export function claudeServedRequestedModel(requested: string, served: string): boolean {
  const withoutContext = (model: string) => model.trim().toLowerCase().replace(/\[[^\]]*\]$/u, '');
  const request = withoutContext(requested);
  const reply = withoutContext(served);
  if (reply === request || (reply.startsWith(`${request}-`) && /^\d{8}$/u.test(reply.slice(request.length + 1)))) {
    return true;
  }
  return /^[a-z]+$/u.test(request) && reply.startsWith(`claude-${request}-`);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unixSecondsToIso(value: unknown): string | undefined {
  const seconds = finiteNumber(value);
  if (seconds === undefined || seconds <= 0) {
    return undefined;
  }
  return new Date(seconds * 1000).toISOString();
}

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * SPEC-035: Claude Code expands `${VAR}` in MCP config headers from its own
 * environment, so the bearer stays out of argv and only the variable name is here.
 */
export function buildClaudeSessionMcpConfig(servers: readonly SessionMcpServerLaunch[]): string {
  return JSON.stringify({
    mcpServers: Object.fromEntries(servers.map((server) => [server.name, {
      type: 'http',
      url: server.url,
      ...(server.bearerTokenEnvVar
        ? { headers: { Authorization: 'Bearer ${' + server.bearerTokenEnvVar + '}' } }
        : {}),
    }])),
  });
}

function normalizeClaudeMcpServerStatuses(value: unknown[]): { name: string; status: string }[] {
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { name, status } = entry as { name?: unknown; status?: unknown };
    return typeof name === 'string' && typeof status === 'string' ? [{ name, status }] : [];
  });
}
