import type {
  Provider,
  ProviderCapabilities,
  ProviderLaunchFailureInput,
  ProviderSpawnOptions,
  RuntimeProviderRefusal,
  StreamEvent,
  TurnInput,
} from './types.js';
import type {
  InitStreamEvent,
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

type CursorMessageContent = Array<{
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

interface CursorStreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  text?: string;
  timestamp_ms?: number;
  model_call_id?: string;
  message?: {
    role?: string;
    content?: CursorMessageContent;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

type CursorContentItem = CursorMessageContent[number];

export class CursorProvider implements Provider {
  name = 'cursor';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  private pendingPrompt: string | null = null;
  private sawAssistantChunk = false;
  /** Text streamed since Cursor last replayed its segment; see {@link parseAssistantEvent}. */
  private segmentText = '';
  /** A timestamped message equal to `segmentText` that the next line will classify. */
  private heldSegmentEcho: { event: CursorStreamEvent; events: StreamEvent[] } | null = null;

  constructor(
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
    this.sawAssistantChunk = false;
    this.segmentText = '';
    this.heldSegmentEcho = null;
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [
      '-p',
      '--trust',
      '--output-format', 'stream-json',
      '--stream-partial-output',
    ];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    if (this.pendingPrompt) {
      args.push(this.pendingPrompt);
      this.pendingPrompt = null;
    }

    return args;
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  classifyLaunchFailure(input: ProviderLaunchFailureInput): RuntimeProviderRefusal | null {
    const evidenceSummary = [input.line, ...input.stderrLines]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' | ');
    if (!evidenceSummary) {
      return null;
    }

    const unsupportedModel = parseUnsupportedCursorModel(evidenceSummary);
    if (!unsupportedModel) {
      return null;
    }

    return {
      category: 'provider_rejected',
      message: unsupportedModel.message,
      retryable: false,
      source: input.source,
      evidenceSummary,
      metadata: {
        rejectedModel: unsupportedModel.rejectedModel,
        availableModels: unsupportedModel.availableModels,
      },
    };
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let event: CursorStreamEvent;
    try {
      event = JSON.parse(trimmed) as CursorStreamEvent;
    } catch {
      return prependEvents(
        this.settleHeldSegmentEcho(null),
        observeRawPassthrough(this.evolutionObserver, {
          rawEventType: 'non_json_line',
          reason: 'stdout_passthrough',
          rawSample: trimmed,
        }, { type: 'raw', text: trimmed } satisfies RawStreamEvent),
      );
    }

    return prependEvents(this.settleHeldSegmentEcho(event), this.parseStreamEvent(event));
  }

  private parseStreamEvent(event: CursorStreamEvent): StreamEvent | StreamEvent[] | null {
    if (event.type === 'system' && event.subtype === 'init') {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: 'system:init',
        reason: 'session_bootstrap',
        rawSample: event,
      }, {
        type: 'init',
        sessionId: event.session_id,
      } satisfies InitStreamEvent);
    }

    if (event.type === 'user') {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: 'user',
        reason: 'user_echo',
        rawSample: event,
      }, null);
    }

    if (event.type === 'thinking') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'thinking',
        rawSample: event,
      }, createRuntimeProgressEvent({
        text: event.text?.trim() || 'Cursor updated reasoning.',
        provider: 'cursor',
        backend: 'cli',
        kind: 'reasoning',
        status: 'running',
        source: 'provider',
        native: {
          sourceEvent: 'thinking',
          ...(typeof event.timestamp_ms === 'number' ? { timestampMs: event.timestamp_ms } : {}),
        },
      }));
    }

    if (event.type === 'assistant') {
      return this.parseAssistantEvent(event);
    }

    if (event.type === 'result') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'result',
        rawSample: event,
      }, {
        type: 'result',
        sessionId: event.session_id,
        usage: event.usage ? {
          inputTokens: event.usage.inputTokens ?? 0,
          outputTokens: event.usage.outputTokens ?? 0,
        } : undefined,
      } satisfies ResultStreamEvent);
    }

    return observeUnknown(this.evolutionObserver, {
      rawEventType: event.type || 'unknown_json',
      rawSample: event,
    }, null);
  }

  /**
   * With `--stream-partial-output`, Cursor streams each text delta as a
   * timestamped assistant message and also buffers it. Before a tool call, a
   * retry, or an interaction query it replays that buffer as one more
   * timestamped message -- tagged `model_call_id` only before a tool call --
   * and at the end of the turn replays the rest without a timestamp. Emitting
   * the replays showed every text segment before a tool call twice.
   */
  private parseAssistantEvent(event: CursorStreamEvent): StreamEvent | StreamEvent[] | null {
    const assistantEvents = extractCursorAssistantEvents(event.message?.content);
    if (assistantEvents.length === 0) {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: 'assistant',
        reason: 'empty_assistant_content',
        rawSample: event,
      }, null);
    }

    if (event.timestamp_ms) {
      const text = assistantText(assistantEvents);
      if (this.segmentText && text === this.segmentText) {
        if (event.model_call_id) {
          this.segmentText = '';
          return this.suppressDuplicateText(event, assistantEvents, 'duplicate_segment_text');
        }
        // A retry or query replay looks exactly like a delta that happens to
        // repeat everything so far ("好" then "好"); the next line tells them apart.
        this.heldSegmentEcho = { event, events: assistantEvents };
        return null;
      }
      return this.emitAssistantDelta(event, assistantEvents);
    }

    this.segmentText = '';
    if (this.sawAssistantChunk) {
      return this.suppressDuplicateText(event, assistantEvents, 'duplicate_final_text');
    }

    const parsed = assistantEvents.length === 1 ? assistantEvents[0]! : assistantEvents;
    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'assistant',
      rawSample: event,
    }, parsed);
  }

  private emitAssistantDelta(
    event: CursorStreamEvent,
    assistantEvents: StreamEvent[],
  ): StreamEvent | StreamEvent[] {
    this.sawAssistantChunk = true;
    this.segmentText += assistantText(assistantEvents);
    const parsed = assistantEvents.length === 1 ? assistantEvents[0]! : assistantEvents;
    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'assistant',
      rawSample: event,
    }, parsed);
  }

  /**
   * Cursor writes the replay immediately before the `tool_call` started,
   * `retry`, or `interaction_query` event it precedes, so a held message
   * followed by one of those was the replay; anything else makes it a delta.
   */
  private settleHeldSegmentEcho(next: CursorStreamEvent | null): StreamEvent[] {
    const held = this.heldSegmentEcho;
    if (!held) {
      return [];
    }
    this.heldSegmentEcho = null;

    const followsReplay = next?.type === 'retry'
      || next?.type === 'interaction_query'
      || (next?.type === 'tool_call' && next.subtype === 'started');
    if (followsReplay) {
      this.segmentText = '';
      return toEventArray(this.suppressDuplicateText(held.event, held.events, 'duplicate_segment_text'));
    }
    return toEventArray(this.emitAssistantDelta(held.event, held.events));
  }

  private suppressDuplicateText(
    event: CursorStreamEvent,
    assistantEvents: StreamEvent[],
    reason: string,
  ): StreamEvent | StreamEvent[] | null {
    const nonTextEvents = assistantEvents.filter((item) => item.type !== 'text');
    if (nonTextEvents.length === 0) {
      return observeIgnored(this.evolutionObserver, {
        rawEventType: 'assistant',
        reason,
        rawSample: event,
      }, null);
    }
    const parsed = nonTextEvents.length === 1 ? nonTextEvents[0]! : nonTextEvents;
    return observeNormalized(this.evolutionObserver, {
      rawEventType: 'assistant',
      rawSample: event,
    }, parsed);
  }
}

function assistantText(events: StreamEvent[]): string {
  const text = events.find((item): item is TextStreamEvent => item.type === 'text');
  return text?.text ?? '';
}

function toEventArray(value: StreamEvent | StreamEvent[] | null): StreamEvent[] {
  if (value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function prependEvents(
  earlier: StreamEvent[],
  value: StreamEvent | StreamEvent[] | null,
): StreamEvent | StreamEvent[] | null {
  if (earlier.length === 0) return value;
  const combined = [...earlier, ...toEventArray(value)];
  return combined.length === 1 ? combined[0]! : combined;
}

function extractCursorAssistantEvents(
  content: CursorMessageContent | undefined,
): StreamEvent[] {
  if (!Array.isArray(content)) {
    return [];
  }

  const events: StreamEvent[] = [];
  const textParts: string[] = [];

  for (const item of content as CursorContentItem[]) {
    if (typeof item === 'string') {
      textParts.push(item);
      continue;
    }

    if (!item || typeof item !== 'object') {
      continue;
    }

    if (typeof item.text === 'string' && item.text) {
      textParts.push(item.text);
    }

    if (item.type === 'thinking' || item.type === 'reasoning') {
      events.push(createRuntimeProgressEvent({
        text: item.thinking?.trim() || item.text?.trim() || 'Cursor updated reasoning.',
        provider: 'cursor',
        backend: 'cli',
        kind: 'reasoning',
        status: 'running',
        source: 'provider',
        native: {
          sourceEvent: 'assistant',
        },
      }));
      continue;
    }

    if (item.type === 'tool_use') {
      const toolName = typeof item.name === 'string' && item.name ? item.name : 'unknown';
      events.push(
        createRuntimeProgressEvent({
          text: `Running tool: ${toolName}`,
          provider: 'cursor',
          backend: 'cli',
          kind: 'tool',
          status: 'running',
          source: 'provider',
          native: {
            sourceEvent: 'assistant',
            toolName,
          },
        }),
        {
          type: 'tool_use',
          toolName,
          ...(typeof item.id === 'string' && item.id ? { toolId: item.id } : {}),
          ...(item.input ? { toolArgs: item.input } : {}),
        } satisfies ToolUseStreamEvent,
      );
      continue;
    }

    if (item.type === 'tool_result') {
      const toolText = stringifyCursorContent(item.content);
      events.push(
        createRuntimeProgressEvent({
          text: 'Cursor completed a tool call.',
          provider: 'cursor',
          backend: 'cli',
          kind: 'tool',
          status: item.is_error === true ? 'failed' : 'updated',
          source: 'provider',
          native: {
            sourceEvent: 'assistant',
            ...(typeof item.tool_use_id === 'string' && item.tool_use_id
              ? { toolId: item.tool_use_id }
              : {}),
          },
        }),
        {
          type: 'tool_result',
          ...(typeof item.tool_use_id === 'string' && item.tool_use_id
            ? { toolId: item.tool_use_id }
            : {}),
          ...(toolText ? { text: toolText } : {}),
          ...(item.is_error === true ? { isError: true } : {}),
        } satisfies ToolResultStreamEvent,
      );
    }
  }

  const text = textParts.join('');
  if (text) {
    events.unshift({ type: 'text', text } satisfies TextStreamEvent);
  }

  return events;
}

function stringifyCursorContent(value: unknown): string | undefined {
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

function parseUnsupportedCursorModel(
  evidenceSummary: string,
): {
  message: string;
  rejectedModel: string;
  availableModels: string[];
} | null {
  const match = evidenceSummary.match(
    /(?:^|\|\s*)Cannot use this model:\s*(.+?)\.\s*Available models:\s*([^|]+)/i,
  );
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const rejectedModel = match[1].trim();
  const availableModels = match[2]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    message: availableModels.length > 0
      ? `Cursor cannot use model '${rejectedModel}'. Available models: ${availableModels.join(', ')}`
      : `Cursor cannot use model '${rejectedModel}'.`,
    rejectedModel,
    availableModels,
  };
}
