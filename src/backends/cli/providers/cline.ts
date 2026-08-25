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

export const CLINE_JSON_PROFILE_ID = 'cline-cli-json-3.0.51';

export const CLINE_JSON_BASE_ARGS = ['--json'] as const;

interface ClineUsage {
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
  totalCost?: unknown;
}

interface ClineToolOutputEntry {
  query?: unknown;
  result?: unknown;
  success?: unknown;
}

interface ClineAgentEvent {
  type?: unknown;
  contentType?: unknown;
  text?: unknown;
  reasoning?: unknown;
  redacted?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  update?: unknown;
  error?: unknown;
  iteration?: unknown;
}

interface ClineStreamLine {
  ts?: unknown;
  type?: unknown;
  hookEventName?: unknown;
  event?: ClineAgentEvent;
  message?: unknown;
  reason?: unknown;
  finishReason?: unknown;
  text?: unknown;
  usage?: ClineUsage;
  aggregateUsage?: ClineUsage;
  durationMs?: unknown;
}

export class ClineProvider implements Provider {
  name = 'cline';
  ephemeral = true;
  // Cline 3.0.51 rejects `--id` whenever `--json` is set, so resume is not
  // reachable from the machine-readable mode the runtime depends on. See
  // docs/research/2026-08-08-cline-cli-probe.md.
  capabilities: ProviderCapabilities = { resume: false, fork: false, permissions: true };

  private pendingPrompt: string | null = null;

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const prompt = this.pendingPrompt;
    if (!prompt) {
      throw new Error('Cline CLI requires prepareEphemeralTurn before building spawn arguments.');
    }
    this.pendingPrompt = null;

    if (opts.resumeSessionId) {
      throw new Error(
        'Cline CLI 3.0.51 cannot resume a session: passing --id alongside --json fails '
        + 'regardless of whether the id is valid, and the stream never emits a resumable id.',
      );
    }
    if (opts.forkSession) {
      throw new Error('Cline CLI 3.0.51 has no session fork mechanism.');
    }

    const args = [
      ...(this.compatibilityProfile?.spawnBaseArgs ?? CLINE_JSON_BASE_ARGS),
      '--cwd', opts.cwd,
    ];

    const model = normalizeClineModelId(opts.model);
    if (model) {
      args.push('--model', model);
    }

    appendClinePermissionArgs(args, opts);

    // The prompt is positional and must come last. Cline matches subcommands on
    // an exact first-argument match, so a prompt is only ambiguous when it is a
    // single bare word like "doctor"; keeping it last behind valued flags means
    // it is never the first argument.
    args.push(prompt);
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

    if (normalized.includes('insufficient balance') || normalized.includes('credits balance')) {
      return {
        category: 'provider_rejected',
        message: 'Cline rejected the request for insufficient credits. Top up the Cline account or switch provider with cline auth.',
        statusCode: 402,
        retryable: false,
        source: input.source,
        evidenceSummary,
      };
    }

    if (normalized.includes('not authenticated') || normalized.includes('run cline auth')) {
      return {
        category: 'auth_required',
        message: 'Cline CLI is not signed in. Run cline auth to configure a provider.',
        statusCode: 401,
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

    let parsed: ClineStreamLine;
    try {
      parsed = JSON.parse(text) as ClineStreamLine;
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

    switch (parsed.type) {
      case 'agent_event':
        return this.parseAgentEvent(parsed);
      case 'hook_event':
        // agent_start / agent_end / tool_call / tool_result carry only agent and
        // task ids. Tool identity lives on the paired agent_event, so these add
        // nothing the normalized stream does not already have.
        return observeIgnored(this.evolutionObserver, {
          rawEventType: `hook_event:${String(parsed.hookEventName)}`,
          reason: 'stream_metadata',
          rawSample: parsed,
        }, null);
      case 'run_result':
        return this.parseRunResult(parsed);
      case 'run_aborted':
        // Emitted after run_result when a turn ends abnormally, e.g. every tool
        // call being denied under --auto-approve false.
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'run_aborted',
          rawSample: parsed,
        }, {
          type: 'error',
          text: buildAbortMessage(parsed),
          raw: parsed,
        } satisfies ErrorStreamEvent);
      case 'error':
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'error',
          rawSample: parsed,
        }, {
          type: 'error',
          text: typeof parsed.message === 'string' && parsed.message.trim()
            ? parsed.message
            : 'Cline CLI request failed.',
          raw: parsed,
        } satisfies ErrorStreamEvent);
      default:
        return observeUnknown(this.evolutionObserver, {
          rawEventType: typeof parsed.type === 'string' ? parsed.type : 'unknown_json',
          rawSample: parsed,
        }, {
          type: 'raw',
          raw: parsed,
        } satisfies RawStreamEvent);
    }
  }

  private parseAgentEvent(line: ClineStreamLine): StreamEvent | StreamEvent[] | null {
    const event = line.event;
    if (!event) {
      return observeUnknown(this.evolutionObserver, {
        rawEventType: 'agent_event:missing_event',
        rawSample: line,
      }, {
        type: 'raw',
        raw: line,
      } satisfies RawStreamEvent);
    }

    switch (event.type) {
      case 'content_start':
        // Despite the name, this is the delta itself for text and reasoning,
        // and the call for tools; several arrive per block.
        if (event.contentType === 'tool') {
          return this.parseToolCall(event);
        }
        if (event.contentType === 'reasoning') {
          return this.parseReasoningDelta(event);
        }
        return this.parseTextDelta(event);

      case 'content_update':
        // 3.0.57 streams tool output between the content_start call and the
        // content_end result. Only the tool form has been observed, so other
        // content types stay unknown rather than being guessed at.
        if (event.contentType === 'tool') {
          return this.parseToolOutputChunk(event);
        }
        return observeUnknown(this.evolutionObserver, {
          rawEventType: `content_update:${String(event.contentType ?? 'unknown')}`,
          rawSample: event,
        }, {
          type: 'raw',
          raw: event,
        } satisfies RawStreamEvent);

      case 'content_end':
        // For text and reasoning this repeats the whole block the deltas
        // already streamed, so emitting it would duplicate the message. Only
        // the tool form carries new information.
        if (event.contentType === 'tool') {
          return this.parseToolResult(event);
        }
        return observeIgnored(this.evolutionObserver, {
          rawEventType: `content_end:${String(event.contentType ?? 'text')}`,
          reason: 'duplicate_of_streamed_content',
          rawSample: event,
        }, null);

      case 'usage':
        // Cumulative, not incremental: every event carries both per-call and
        // running-total fields. Summing these across events double counts
        // against run_result.aggregateUsage, which is the single source used.
        return observeIgnored(this.evolutionObserver, {
          rawEventType: 'usage',
          reason: 'cumulative_superseded_by_run_result',
          rawSample: event,
        }, null);

      case 'done':
        // Duplicates run_result's finish reason, text, and usage.
        return observeIgnored(this.evolutionObserver, {
          rawEventType: 'done',
          reason: 'duplicate_of_run_result',
          rawSample: event,
        }, null);

      case 'iteration_start':
      case 'iteration_end':
        return observeIgnored(this.evolutionObserver, {
          rawEventType: String(event.type),
          reason: 'stream_metadata',
          rawSample: event,
        }, null);

      default:
        return observeUnknown(this.evolutionObserver, {
          rawEventType: typeof event.type === 'string'
            ? `agent_event:${event.type}`
            : 'agent_event:unknown',
          rawSample: event,
        }, {
          type: 'raw',
          raw: event,
        } satisfies RawStreamEvent);
    }
  }

  private parseTextDelta(event: ClineAgentEvent): StreamEvent | null {
    // `accumulated` is present on some runs and absent on others, so the parser
    // reads only `text` and lets the consumer concatenate.
    const text = typeof event.text === 'string' ? event.text : '';
    if (!text) return null;

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'content_start:text',
      rawSample: event,
    }, {
      type: 'text',
      text,
      raw: event,
    } satisfies TextStreamEvent);
  }

  private parseReasoningDelta(event: ClineAgentEvent): StreamEvent | null {
    const reasoning = typeof event.reasoning === 'string' ? event.reasoning : '';
    if (!reasoning) return null;

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'content_start:reasoning',
      rawSample: event,
    }, createRuntimeProgressEvent({
      text: reasoning,
      provider: 'cline',
      backend: 'cli',
      kind: 'reasoning',
      status: 'running',
      source: 'provider',
      native: {
        sourceEvent: 'content_start',
        ...(event.redacted === true ? { redacted: true } : {}),
      },
    }));
  }

  private parseToolCall(event: ClineAgentEvent): StreamEvent[] {
    const toolName = typeof event.toolName === 'string' ? event.toolName : 'unknown';
    const toolId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
    const toolArgs = asRecord(event.input);

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'content_start:tool',
      rawSample: event,
    }, [
      createRuntimeProgressEvent({
        text: `Running Cline tool: ${toolName}`,
        provider: 'cline',
        backend: 'cli',
        kind: 'tool',
        status: 'running',
        source: 'provider',
        native: {
          sourceEvent: 'content_start',
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

  private parseToolOutputChunk(event: ClineAgentEvent): StreamEvent | null {
    const update = asRecord(event.update);
    const chunk = typeof update?.chunk === 'string' ? update.chunk : '';
    if (!chunk.trim()) {
      // Each stream opens with empty chunks before the command writes anything.
      return observeIgnored(this.evolutionObserver, {
        rawEventType: 'content_update:tool',
        reason: 'empty_tool_output_chunk',
        rawSample: event,
      }, null);
    }

    const toolName = typeof event.toolName === 'string' ? event.toolName : 'unknown';
    const toolId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
    const stream = typeof update?.stream === 'string' ? update.stream : undefined;

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'content_update:tool',
      rawSample: event,
    }, createRuntimeProgressEvent({
      text: chunk.trim(),
      provider: 'cline',
      backend: 'cli',
      kind: 'tool',
      status: 'running',
      source: 'provider',
      native: {
        sourceEvent: 'content_update',
        toolName,
        ...(toolId ? { toolId } : {}),
        ...(stream ? { stream } : {}),
      },
      raw: event,
    }));
  }

  private parseToolResult(event: ClineAgentEvent): StreamEvent[] {
    const toolName = typeof event.toolName === 'string' ? event.toolName : 'unknown';
    const toolId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
    const { text, isError } = summarizeToolOutput(event.output, event.error);

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'content_end:tool',
      rawSample: event,
    }, [
      createRuntimeProgressEvent({
        text: isError
          ? `Cline tool failed: ${toolName}`
          : `Cline tool completed: ${toolName}`,
        provider: 'cline',
        backend: 'cli',
        kind: 'tool',
        status: isError ? 'failed' : 'completed',
        source: 'provider',
        native: {
          sourceEvent: 'content_end',
          toolName,
          ...(toolId ? { toolId } : {}),
        },
      }),
      {
        type: 'tool_result',
        toolName,
        ...(toolId ? { toolId } : {}),
        ...(text ? { text } : {}),
        ...(isError ? { isError: true } : {}),
        raw: event,
      } satisfies ToolResultStreamEvent,
    ]);
  }

  private parseRunResult(line: ClineStreamLine): StreamEvent | null {
    // A non-completed run must terminate the turn here.
    //
    // An earlier version yielded to the trailing `{"type":"error"}` line on the
    // assumption that it carried a better message. An end-to-end run against
    // the real CLI disproved that: Cline writes `run_*` lines to stdout but
    // `error` lines to **stderr**, and the runtime only feeds stdout through
    // parseStreamLine. The trailing line therefore never reaches this parser,
    // so yielding produced no terminal event at all and the turn degraded to a
    // turn-timeout instead of reporting the real cause. The original fixtures
    // hid this because they were captured with `2>&1`.
    //
    // run_result.text carries the cause on the failing path (verified:
    // "Insufficient balance. Your Cline Credits balance is $-0.11"), so it is
    // used directly. stderr is still classified separately by
    // classifyLaunchFailure; whichever terminates first gives a usable message.
    if (line.finishReason !== 'completed') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: `run_result:${String(line.finishReason)}`,
        rawSample: line,
      }, {
        type: 'error',
        text: buildFailedRunMessage(line),
        raw: line,
      } satisfies ErrorStreamEvent);
    }

    // No session id is emitted anywhere in the stream. `taskId` (conv_*) is not
    // the id `cline history` reports, and not the one `--id` accepts, so the
    // result deliberately carries none rather than a value that cannot resume.
    const usage = line.aggregateUsage ?? line.usage;

    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'run_result',
      rawSample: line,
    }, {
      type: 'result',
      ...(usage ? { usage: normalizeClineUsage(usage) } : {}),
      raw: line,
    } satisfies ResultStreamEvent);
  }
}

function summarizeToolOutput(
  output: unknown,
  error: unknown,
): { text?: string; isError: boolean } {
  // `output` is an array of per-query results on success, but an object shaped
  // `{ error }` when the call fails — a denied tool under --auto-approve false
  // produces the latter. Treating a non-array as "no error" would report every
  // failed tool as successful.
  const outputRecord = asRecord(output);
  if (outputRecord) {
    const message = typeof outputRecord.error === 'string' && outputRecord.error
      ? outputRecord.error
      : typeof error === 'string' && error
        ? error
        : undefined;
    return { ...(message ? { text: message } : {}), isError: true };
  }

  if (!Array.isArray(output)) {
    const message = typeof error === 'string' && error ? error : undefined;
    return message ? { text: message, isError: true } : { isError: false };
  }

  const parts: string[] = [];
  let isError = typeof error === 'string' && error.length > 0;
  for (const entry of output) {
    const record = asRecord(entry) as ClineToolOutputEntry | null;
    if (!record) continue;
    if (record.success === false) {
      isError = true;
    }
    if (typeof record.result === 'string' && record.result) {
      parts.push(record.result);
    }
  }

  return {
    ...(parts.length > 0 ? { text: parts.join('\n') } : {}),
    isError,
  };
}

function appendClinePermissionArgs(args: string[], opts: ProviderSpawnOptions): void {
  if (opts.permissionMode === 'whitelist') {
    // Cline 3.0.51 exposes only a global --auto-approve boolean; there is no
    // per-tool allowlist flag. Silently downgrading to deny-all would look like
    // a working whitelist while blocking every tool, so refuse instead.
    throw new Error(
      'Cline CLI 3.0.51 cannot enforce a tool allowlist: --auto-approve is a global '
      + 'boolean with no per-tool form. Use skip or default permission mode.',
    );
  }

  // Anything other than skip is deny-all. Cline does not prompt in --json mode;
  // it refuses each call with "Tool approval requires an interactive session",
  // lets the agent retry, and ends the run aborted.
  args.push('--auto-approve', opts.permissionMode === 'skip' ? 'true' : 'false');
}

function normalizeClineModelId(model?: string): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === 'cline-default') {
    return undefined;
  }
  return trimmed;
}

function buildFailedRunMessage(line: ClineStreamLine): string {
  const reason = typeof line.finishReason === 'string' ? line.finishReason : 'unknown';
  const detail = typeof line.text === 'string' && line.text.trim() ? line.text.trim() : '';
  const head = `Cline run ended without completing (finishReason: ${reason})`;
  return detail ? `${head}. ${detail}` : `${head}.`;
}

function buildAbortMessage(line: ClineStreamLine): string {
  const reason = typeof line.reason === 'string' ? line.reason : undefined;
  const message = typeof line.message === 'string' ? line.message : undefined;
  const detail = [message, reason ? `(${reason})` : undefined].filter(Boolean).join(' ');
  return detail ? `Cline run aborted: ${detail}` : 'Cline run aborted.';
}

function normalizeClineUsage(usage: ClineUsage) {
  // Cline's `inputTokens` already includes cache reads and writes: run 2 of the
  // probe reported inputTokens 8098 against cacheReadTokens 7806, and the
  // aggregate (15906 in / 7806 cached) reconciles to 8100 fresh prompt tokens.
  const inputTokens = finiteNumber(usage.inputTokens);
  const outputTokens = finiteNumber(usage.outputTokens);
  const cacheReadInputTokens = finiteNumber(usage.cacheReadTokens);
  const cacheCreationInputTokens = finiteNumber(usage.cacheWriteTokens);
  const promptInputTokens = Math.max(
    0,
    inputTokens - cacheReadInputTokens - cacheCreationInputTokens,
  );

  return {
    inputTokens,
    outputTokens,
    promptInputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(typeof usage.totalCost === 'number' && Number.isFinite(usage.totalCost)
      ? { estimatedCost: usage.totalCost, currency: 'USD' }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
