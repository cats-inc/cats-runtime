import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  TurnInput,
} from './types.js';
import type {
  ErrorStreamEvent,
  InitStreamEvent,
  ReportedModel,
  ResultStreamEvent,
  StreamEvent,
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

/**
 * Kiro's V3 engine, run headless. `--output-format stream-json` writes one
 * self-describing JSON object per line: `runStarted`, then `sessionUpdate`
 * frames whose `data.update` is a verbatim ACP `session/update`, then
 * `runFinished` with the run's status, stop reason and final text.
 * The prompt goes over stdin, which Kiro reads when no positional argument is
 * given, so long turn prompts stay out of argv.
 */
const KIRO_HEADLESS_ARGS = [
  'chat',
  '--no-interactive',
  '--agent-engine', 'v3',
  '--output-format', 'stream-json',
] as const;

interface KiroTurnState {
  sessionId: string | null;
  engine: string | null;
  model: string | null;
  effortLevel: string | null;
  credits: number | null;
  elapsedMs: number | null;
  requestIds: string[];
  contextUsagePercentage: number | null;
  stopReason: string | null;
  sawText: boolean;
  finished: boolean;
  toolNames: Map<string, string>;
}

function freshTurnState(): KiroTurnState {
  return {
    sessionId: null,
    engine: null,
    model: null,
    effortLevel: null,
    credits: null,
    elapsedMs: null,
    requestIds: [],
    contextUsagePercentage: null,
    stopReason: null,
    sawText: false,
    finished: false,
    toolNames: new Map(),
  };
}

export class KiroProvider implements Provider {
  name = 'kiro';
  ephemeral = true;
  /**
   * Headless Kiro cannot ask: a tool call that needs approval is denied by Kiro
   * itself. `skip` trusts every tool and `whitelist` trusts the listed tool ids.
   */
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  private pendingPrompt: string | null = null;
  private requestedModel: string | null = null;
  private turn: KiroTurnState = freshTurnState();

  constructor(private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver) {}

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
    this.turn = freshTurnState();
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [...KIRO_HEADLESS_ARGS];
    this.requestedModel = opts.model?.trim() || null;

    if (opts.model) {
      args.push('--model', opts.model);
    }

    // Per-model values and availability come from catalog data; only the flag is code.
    const effort = opts.modelControls?.['kiro.reasoning_effort'];
    if (effort !== undefined) {
      if (typeof effort !== 'string' || !effort.trim() || /[\u0000-\u001f]/.test(effort)) {
        throw new Error('Unsupported Kiro reasoning effort.');
      }
      args.push('--effort', effort);
    }

    if (opts.permissionMode === 'skip') {
      args.push('--trust-all-tools');
    } else if (opts.permissionMode === 'whitelist') {
      args.push(`--trust-tools=${(opts.allowedTools || []).join(',')}`);
    }

    if (opts.resumeSessionId) {
      args.push('--resume-id', opts.resumeSessionId);
    }

    return args;
  }

  buildStdinMessage(_content: string): string {
    const prompt = this.pendingPrompt ?? '';
    this.pendingPrompt = null;
    return prompt;
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let frame: Record<string, unknown>;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      frame = parsed as Record<string, unknown>;
    } catch {
      return observeRawPassthrough(this.evolutionObserver, {
        rawEventType: 'non_json_line',
        reason: 'stdout_passthrough',
        rawSample: trimmed,
      }, null);
    }

    const type = readString(frame.type);
    const data = asRecord(frame.data) ?? {};
    switch (type) {
      case 'runStarted':
        this.turn.engine = readString(data.engine) ?? null;
        return observeIgnored(this.evolutionObserver, {
          rawEventType: 'runStarted',
          reason: 'run_lifecycle',
          rawSample: frame,
        }, null);
      case 'sessionUpdate':
        return this.parseSessionUpdate(data, frame);
      case 'runFinished':
        return this.parseRunFinished(data, frame);
      default: {
        const message = readString(data.message) ?? readString(data.error) ?? readString(frame.message);
        if (message || type === 'error' || type === 'interrupted') {
          this.turn.finished = true;
          return observeNormalized(this.evolutionObserver, {
            rawEventType: type ?? 'unknown_json',
            details: { provider: 'kiro', isError: true },
            rawSample: frame,
          }, {
            type: 'error',
            ...(this.turn.sessionId ? { sessionId: this.turn.sessionId } : {}),
            text: message ?? `Kiro run ${type}.`,
            metadata: { native: { sourceEvent: type ?? 'unknown' } },
          } satisfies ErrorStreamEvent);
        }
        return observeUnknown(this.evolutionObserver, {
          rawEventType: type ?? 'unknown_json',
          rawSample: frame,
        }, null);
      }
    }
  }

  private parseSessionUpdate(
    data: Record<string, unknown>,
    frame: Record<string, unknown>,
  ): StreamEvent | StreamEvent[] | null {
    const events: StreamEvent[] = [];
    const sessionId = readString(data.sessionId);
    if (sessionId && sessionId !== this.turn.sessionId) {
      this.turn.sessionId = sessionId;
      events.push({
        type: 'init',
        sessionId,
        metadata: {
          native: {
            sourceEvent: 'sessionUpdate',
            ...(this.turn.engine ? { engine: this.turn.engine } : {}),
          },
        },
      } satisfies InitStreamEvent);
    }

    const update = asRecord(data.update) ?? {};
    const kind = readString(update.sessionUpdate);
    const observed = (rawEventType: string, event: StreamEvent | null, details?: Record<string, unknown>) => {
      if (event) {
        observeNormalized(this.evolutionObserver, {
          rawEventType,
          details: { provider: 'kiro', ...details },
          rawSample: frame,
        }, event);
        events.push(event);
      } else {
        observeIgnored(this.evolutionObserver, { rawEventType, reason: 'no_runtime_event', rawSample: frame }, null);
      }
      return events.length > 0 ? events : null;
    };

    switch (kind) {
      case 'agent_message_chunk': {
        const text = readContentText(update.content);
        if (text) this.turn.sawText = true;
        return observed(kind, text ? { type: 'text', text } satisfies TextStreamEvent : null);
      }
      case 'agent_thought_chunk': {
        const text = readContentText(update.content);
        return observed(kind, text
          ? createRuntimeProgressEvent({
              text,
              provider: 'kiro',
              backend: 'cli',
              kind: 'reasoning',
              status: 'running',
              source: 'provider',
              native: { sourceEvent: 'session/update:agent_thought_chunk', hasReasoningDelta: true },
            })
          : null);
      }
      case 'tool_call': {
        const toolId = readString(update.toolCallId);
        const toolName = readString(update.title) ?? readString(update.kind);
        if (toolId && toolName) this.turn.toolNames.set(toolId, toolName);
        const toolArgs = asRecord(update.rawInput);
        return observed(kind, {
          type: 'tool_use',
          ...(toolId ? { toolId } : {}),
          ...(toolName ? { toolName } : {}),
          ...(toolArgs ? { toolArgs } : {}),
          metadata: {
            native: {
              sourceEvent: 'session/update:tool_call',
              ...(readString(update.kind) ? { kind: update.kind } : {}),
              ...(readString(update.status) ? { status: update.status } : {}),
              ...(Array.isArray(update.locations) ? { locations: update.locations } : {}),
            },
          },
        } satisfies ToolUseStreamEvent);
      }
      case 'tool_call_update': {
        const status = readString(update.status);
        if (status !== 'completed' && status !== 'failed') {
          return observed(kind, null);
        }
        const toolId = readString(update.toolCallId);
        const toolName = readString(update.title) ?? (toolId ? this.turn.toolNames.get(toolId) : undefined);
        const text = readToolResultText(update);
        const failureReason = readString(asRecord(asRecord(update._meta)?.kiro)?.failureReason);
        return observed(kind, {
          type: 'tool_result',
          ...(toolId ? { toolId } : {}),
          ...(toolName ? { toolName } : {}),
          ...(text ? { text } : {}),
          ...(status === 'failed' ? { isError: true } : {}),
          metadata: {
            native: {
              sourceEvent: 'session/update:tool_call_update',
              status,
              ...(failureReason ? { failureReason } : {}),
            },
          },
        } satisfies ToolResultStreamEvent, { status });
      }
      case 'session_info_update':
        this.recordSessionInfo(asRecord(asRecord(update._meta)?.kiro) ?? {});
        return observed(kind, null);
      case 'config_option_update':
        this.recordConfigOptions(update.configOptions);
        return observed(kind, null);
      case 'available_commands_update':
      case 'current_mode_update':
        return observed(kind, null);
      default:
        observeUnknown(this.evolutionObserver, {
          rawEventType: kind ? `sessionUpdate:${kind}` : 'sessionUpdate',
          rawSample: frame,
        }, null);
        return events.length > 0 ? events : null;
    }
  }

  private recordSessionInfo(meta: Record<string, unknown>): void {
    switch (readString(meta.kind)) {
      case 'turn_completion': {
        const summaries = Array.isArray(meta.promptTurnSummaries) ? meta.promptTurnSummaries : [];
        let credits = 0;
        let sawCredits = false;
        for (const summary of summaries) {
          const usage = readNumber(asRecord(summary)?.usage);
          if (usage !== undefined) {
            credits += usage;
            sawCredits = true;
          }
        }
        if (sawCredits) this.turn.credits = (this.turn.credits ?? 0) + credits;
        this.turn.elapsedMs = readNumber(meta.elapsedTime) ?? this.turn.elapsedMs;
        if (Array.isArray(meta.requestIds)) {
          this.turn.requestIds.push(...meta.requestIds.filter((id): id is string => typeof id === 'string'));
        }
        return;
      }
      case 'context_usage':
        this.turn.contextUsagePercentage = readNumber(meta.usagePercentage) ?? this.turn.contextUsagePercentage;
        return;
      case 'turn_end':
        this.turn.stopReason = readString(meta.stopReason) ?? this.turn.stopReason;
        return;
      default:
        return;
    }
  }

  private recordConfigOptions(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const option of value) {
      const record = asRecord(option);
      const id = readString(record?.id);
      const current = readString(record?.currentValue);
      if (!id || !current) continue;
      if (id === 'model') this.turn.model = current;
      if (id === 'effortLevel') this.turn.effortLevel = current;
    }
  }

  private parseRunFinished(
    data: Record<string, unknown>,
    frame: Record<string, unknown>,
  ): StreamEvent | StreamEvent[] {
    this.turn.finished = true;
    const sessionId = readString(data.sessionId) ?? this.turn.sessionId ?? undefined;
    const status = readString(data.status) ?? 'unknown';
    const stopReason = readString(data.stopReason) ?? this.turn.stopReason ?? undefined;
    const finalText = typeof data.finalText === 'string' ? data.finalText : '';
    const native: Record<string, unknown> = {
      sourceEvent: 'runFinished',
      status,
      ...(stopReason ? { stopReason } : {}),
      ...(this.turn.engine ? { engine: this.turn.engine } : {}),
      ...(this.turn.effortLevel ? { effortLevel: this.turn.effortLevel } : {}),
      ...(this.turn.credits !== null ? { credits: this.turn.credits } : {}),
      ...(this.turn.elapsedMs !== null ? { elapsedMs: this.turn.elapsedMs } : {}),
      ...(this.turn.requestIds.length > 0 ? { requestIds: [...this.turn.requestIds] } : {}),
      ...(this.turn.contextUsagePercentage !== null
        ? { contextUsagePercentage: this.turn.contextUsagePercentage }
        : {}),
      ...(data.finalTextTruncated === true ? { finalTextTruncated: true } : {}),
    };

    if (status !== 'success') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'runFinished',
        details: { provider: 'kiro', isError: true, status },
        rawSample: frame,
      }, {
        type: 'error',
        ...(sessionId ? { sessionId } : {}),
        text: finalText.trim() || `Kiro run ${status}${stopReason ? ` (${stopReason})` : ''}.`,
        metadata: { native },
      } satisfies ErrorStreamEvent);
    }

    const events: StreamEvent[] = [];
    if (!this.turn.sawText && finalText.trim()) {
      // The reply never streamed as chunks; the final text is the only copy.
      events.push({ type: 'text', text: finalText } satisfies TextStreamEvent);
    }

    const reportedModels = this.reportedModels();
    events.push(observeNormalized(this.evolutionObserver, {
      rawEventType: 'runFinished',
      details: { provider: 'kiro', isError: false, status, hasSessionId: Boolean(sessionId) },
      rawSample: frame,
    }, {
      type: 'result',
      ...(sessionId ? { sessionId } : {}),
      ...(reportedModels ? { reportedModels } : {}),
      metadata: { native },
    } satisfies ResultStreamEvent));
    return events;
  }

  /** The model Kiro's config reports for the session, compared with the request. */
  private reportedModels(): ReportedModel[] | undefined {
    const model = this.turn.model;
    if (!model) return undefined;
    const requested = this.requestedModel;
    return [{
      model,
      ...(requested ? { matchesRequest: model.toLowerCase() === requested.toLowerCase() } : {}),
    }];
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** ACP content block text, as in `{ type: 'text', text }`. */
function readContentText(value: unknown): string | undefined {
  const content = asRecord(value);
  if (!content || content.type !== 'text') return undefined;
  return typeof content.text === 'string' && content.text ? content.text : undefined;
}

/**
 * The text of a finished tool call: its content blocks (`content.content.text`
 * for tool output, `diff` for an edit), else the raw output message.
 */
function readToolResultText(update: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  if (Array.isArray(update.content)) {
    for (const item of update.content) {
      const block = asRecord(item);
      if (!block) continue;
      if (block.type === 'content') {
        const text = readContentText(block.content);
        if (text) parts.push(text);
      } else if (block.type === 'diff') {
        const path = readString(block.path);
        const newText = typeof block.newText === 'string' ? block.newText : '';
        parts.push(`${path ? `${path}\n` : ''}${newText}`);
      }
    }
  }
  if (parts.length > 0) return parts.join('\n');
  return readString(asRecord(update.rawOutput)?.message);
}
