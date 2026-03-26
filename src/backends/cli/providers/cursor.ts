import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
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

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
    this.sawAssistantChunk = false;
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

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let event: CursorStreamEvent;
    try {
      event = JSON.parse(trimmed) as CursorStreamEvent;
    } catch {
      return { type: 'raw', text: trimmed };
    }

    if (event.type === 'system' && event.subtype === 'init') {
      return {
        type: 'init',
        sessionId: event.session_id,
      };
    }

    if (event.type === 'user') {
      return null;
    }

    if (event.type === 'thinking') {
      return createRuntimeProgressEvent({
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
      });
    }

    if (event.type === 'assistant') {
      const assistantEvents = extractCursorAssistantEvents(event.message?.content);
      if (assistantEvents.length === 0) return null;

      if (event.timestamp_ms) {
        this.sawAssistantChunk = true;
        return assistantEvents.length === 1 ? assistantEvents[0]! : assistantEvents;
      }

      if (this.sawAssistantChunk) {
        const nonTextEvents = assistantEvents.filter((item) => item.type !== 'text');
        if (nonTextEvents.length === 0) {
          return null;
        }
        return nonTextEvents.length === 1 ? nonTextEvents[0]! : nonTextEvents;
      }

      return assistantEvents.length === 1 ? assistantEvents[0]! : assistantEvents;
    }

    if (event.type === 'result') {
      return {
        type: 'result',
        sessionId: event.session_id,
        usage: event.usage ? {
          inputTokens: event.usage.inputTokens ?? 0,
          outputTokens: event.usage.outputTokens ?? 0,
        } : undefined,
      };
    }

    return null;
  }
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
        },
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
        },
      );
    }
  }

  const text = textParts.join('');
  if (text) {
    events.unshift({ type: 'text', text });
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
