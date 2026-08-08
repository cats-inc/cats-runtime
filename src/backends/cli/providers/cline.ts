import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
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
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  iteration?: unknown;
}

interface ClineStreamLine {
  ts?: unknown;
  type?: unknown;
  hookEventName?: unknown;
  event?: ClineAgentEvent;
  message?: unknown;
  finishReason?: unknown;
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

  constructor(private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver) {}

  buildSpawnArgs(_opts: ProviderSpawnOptions): string[] {
    throw new Error(
      'Cline CLI execution is not enabled yet. The 3.0.51 --json stream is parsed and '
      + 'fixture-backed, but spawn arguments, permission mapping, and cancellation have '
      + 'not been probed. Install cline through setup and wait for the verified adapter.',
    );
  }

  buildStdinMessage(_content: string): string {
    return '';
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
        // Despite the name, this is the delta itself for text and the call for
        // tools; several arrive per block.
        return event.contentType === 'tool'
          ? this.parseToolCall(event)
          : this.parseTextDelta(event);

      case 'content_end':
        // For text this repeats the whole block the deltas already streamed, so
        // emitting it would duplicate the message. Only the tool form carries
        // new information.
        return event.contentType === 'tool'
          ? this.parseToolResult(event)
          : observeIgnored(this.evolutionObserver, {
            rawEventType: 'content_end:text',
            reason: 'duplicate_of_streamed_text',
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

  private parseToolResult(event: ClineAgentEvent): StreamEvent[] {
    const toolName = typeof event.toolName === 'string' ? event.toolName : 'unknown';
    const toolId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
    const { text, isError } = summarizeToolOutput(event.output);

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

  private parseRunResult(line: ClineStreamLine): StreamEvent {
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

function summarizeToolOutput(output: unknown): { text?: string; isError: boolean } {
  if (!Array.isArray(output)) {
    return { isError: false };
  }

  const parts: string[] = [];
  let isError = false;
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
