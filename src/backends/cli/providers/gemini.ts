import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';
import {
  observeIgnored,
  observeNormalized,
  observeRawPassthrough,
  observeSchemaFailure,
  observeUnknown,
} from '../../../core/compatibility/providerEvolution.js';
import { createRuntimeProgressEvent } from '../../../core/progress.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

interface GeminiStreamEvent {
  type: string;
  role?: string;
  content?: unknown;
  session_id?: string;
  message?: string;
  // Gemini CLI uses snake_case (tool_name, tool_id)
  tool_name?: string;
  tool_id?: string;
  stats?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class GeminiProvider implements Provider {
  name = 'gemini';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {}

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = this.compatibilityProfile?.spawnBaseArgs
      ? [...this.compatibilityProfile.spawnBaseArgs]
      : ['--output-format', 'stream-json', '--yolo'];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    return args;
  }

  buildStdinMessage(content: string, turn?: TurnInput): string {
    return compileRuntimeTurnPrompt(content, turn);
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let event: GeminiStreamEvent;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return observeRawPassthrough(this.evolutionObserver, {
        reason: 'non_json_line',
        rawSample: trimmed,
      }, {
        type: 'raw',
        text: trimmed,
      });
    }

    // init — session ID
    if (event.type === 'init') {
      const value: StreamEvent = {
        type: 'init',
        sessionId: event.session_id,
      };
      if (!event.session_id) {
        this.evolutionObserver?.recordSchemaFailure({
          rawEventType: 'init',
          reason: 'missing_session_id',
          rawSample: event,
        });
      }
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'init',
        rawSample: event,
      }, value);
    }

    // message — assistant text content
    if (event.type === 'message') {
      if (event.role === 'user') {
        return observeIgnored(this.evolutionObserver, {
          rawEventType: 'message:user',
          reason: 'user_echo',
          rawSample: event,
        }, null);
      }
      if (event.role === 'assistant' && event.content) {
        const messageEvents = extractGeminiAssistantEvents(event.content);
        if (messageEvents.length > 0) {
          return observeNormalized(this.evolutionObserver, {
            rawEventType: 'message:assistant',
            rawSample: event,
          }, messageEvents.length === 1 ? messageEvents[0]! : messageEvents);
        }
        return observeSchemaFailure(this.evolutionObserver, {
          rawEventType: 'message:assistant',
          reason: 'assistant_message_without_supported_parts',
          rawSample: event,
        }, null);
      }
      return observeIgnored(this.evolutionObserver, {
        rawEventType: `message:${event.role || 'unknown'}`,
        reason: 'unsupported_message_role',
        rawSample: event,
      }, null);
    }

    // tool_use — Gemini CLI uses snake_case field names
    if (event.type === 'tool_use') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'tool_use',
        rawSample: event,
      }, {
        type: 'tool_use',
        toolName: event.tool_name,
        toolId: event.tool_id,
      });
    }

    // tool_result — promote to the shared runtime event tape
    if (event.type === 'tool_result') {
      const text = extractGeminiToolResultText(event.content) || event.message;
      if (!event.tool_name && !event.tool_id && !text) {
        return observeSchemaFailure(this.evolutionObserver, {
          rawEventType: 'tool_result',
          reason: 'tool_result_without_identity_or_content',
          rawSample: event,
        }, null);
      }
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'tool_result',
        rawSample: event,
      }, [
        createRuntimeProgressEvent({
          text: event.tool_name
            ? `Gemini completed tool: ${event.tool_name}`
            : 'Gemini completed a tool call.',
          provider: 'gemini',
          backend: 'cli',
          kind: 'tool',
          status: 'updated',
          source: 'provider',
          native: {
            sourceEvent: event.type,
            ...(event.tool_name ? { toolName: event.tool_name } : {}),
            ...(event.tool_id ? { toolId: event.tool_id } : {}),
          },
        }),
        {
          type: 'tool_result',
          toolName: event.tool_name,
          toolId: event.tool_id,
          ...(text ? { text } : {}),
        },
      ]);
    }

    // error
    if (event.type === 'error') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'error',
        rawSample: event,
      }, {
        type: 'error',
        text: event.message || 'Gemini CLI reported an error.',
      });
    }

    // result — final event with usage stats
    if (event.type === 'result') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'result',
        rawSample: event,
      }, {
        type: 'result',
        usage: event.stats ? {
          inputTokens: event.stats.input_tokens ?? 0,
          outputTokens: event.stats.output_tokens ?? 0,
        } : undefined,
      });
    }

    return observeUnknown(this.evolutionObserver, {
      rawEventType: event.type || 'unknown',
      reason: 'unknown_gemini_event',
      rawSample: event,
    }, {
      type: 'raw',
      text: trimmed,
    });
  }
}

function extractGeminiAssistantEvents(content: unknown): StreamEvent[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const textParts: string[] = [];
  const events: StreamEvent[] = [];

  for (const part of content) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      continue;
    }

    if (typeof part.text === 'string' && part.text) {
      textParts.push(part.text);
    }

    const functionCall = asRecord(part.functionCall);
    if (functionCall) {
      const toolName = readNonEmptyString(functionCall.name);
      const toolArgs = asRecord(functionCall.args) ?? asRecord(functionCall.arguments);
      if (!toolName && !toolArgs) {
        continue;
      }
      events.push(
        createRuntimeProgressEvent({
          text: `Running tool: ${toolName ?? 'unknown'}`,
          provider: 'gemini',
          backend: 'cli',
          kind: 'tool',
          status: 'running',
          source: 'provider',
          native: {
            sourceEvent: 'message:assistant',
            ...(toolName ? { toolName } : {}),
          },
        }),
        {
          type: 'tool_use',
          toolName,
          toolArgs,
        },
      );
    }

    const functionResponse = asRecord(part.functionResponse);
    if (functionResponse) {
      const toolName = readNonEmptyString(functionResponse.name);
      const responseText = stringifyGeminiResponse(
        functionResponse.response ?? functionResponse.content ?? functionResponse.output,
      );
      if (!toolName && !responseText) {
        continue;
      }
      events.push(
        createRuntimeProgressEvent({
          text: toolName
            ? `Gemini completed tool: ${toolName}`
            : 'Gemini completed a tool call.',
          provider: 'gemini',
          backend: 'cli',
          kind: 'tool',
          status: 'updated',
          source: 'provider',
          native: {
            sourceEvent: 'message:assistant',
            ...(toolName ? { toolName } : {}),
          },
        }),
        {
          type: 'tool_result',
          ...(toolName ? { toolName } : {}),
          ...(responseText ? { text: responseText } : {}),
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

function extractGeminiToolResultText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object' || Array.isArray(part)) {
        return '';
      }
      if (typeof part.text === 'string') {
        return part.text;
      }
      return stringifyGeminiResponse(
        (part as Record<string, unknown>).response
        ?? (part as Record<string, unknown>).content
        ?? (part as Record<string, unknown>).output,
      );
    })
    .filter(Boolean)
    .join('');
}

function stringifyGeminiResponse(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
