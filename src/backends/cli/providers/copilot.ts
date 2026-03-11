import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

/** Regex to strip ANSI escape sequences from Copilot CLI output */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export class CopilotProvider implements Provider {
  name = 'copilot';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  private _pendingPrompt: string | null = null;
  private _sessionId: string | undefined;
  private _lastOutputTokens = 0;
  private _sawMessageDelta = false;

  prepareEphemeralTurn(content: string): void {
    this._pendingPrompt = content;
    this._lastOutputTokens = 0;
    this._sawMessageDelta = false;
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [
      '--output-format', 'json',
      '--stream', 'on',
    ];

    // Permission handling
    if (opts.permissionMode === 'skip') {
      args.push('--yolo');
    } else {
      args.push('--allow-all-tools');
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    if (this._pendingPrompt) {
      args.push('-p', this._pendingPrompt);
      this._pendingPrompt = null;
    }

    return args;
  }

  buildStdinMessage(_content: string): string {
    return ''; // prompt already in args via prepareEphemeralTurn
  }

  parseStreamLine(line: string): StreamEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // Try parsing as JSON (JSONL from --output-format json)
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON line — strip ANSI and emit as raw text
      const clean = trimmed.replace(ANSI_RE, '').trim();
      if (!clean) return null;
      return { type: 'raw', text: clean };
    }

    const eventType = parsed.type as string | undefined;
    // Copilot nests event payloads inside a "data" wrapper
    const inner = parsed.data as Record<string, unknown> | undefined;

    switch (eventType) {
      case 'session.start':
        this._sessionId = inner?.sessionId as string | undefined;
        return this._sessionId
          ? { type: 'init', sessionId: this._sessionId }
          : null;

      case 'assistant.turn_start':
        return { type: 'init', sessionId: this._sessionId };

      case 'assistant.message_delta':
        this._sawMessageDelta = true;
        return { type: 'text', text: (inner?.deltaContent as string) ?? '' };

      case 'assistant.message': {
        // Capture outputTokens for usage tracking
        if (inner?.outputTokens) {
          this._lastOutputTokens = inner.outputTokens as number;
        }

        const content = extractContent(inner?.content);
        // Full message — check for tool requests
        const toolRequests = inner?.toolRequests as Array<{ name?: string; id?: string }> | undefined;
        if (toolRequests && toolRequests.length > 0) {
          const tool = toolRequests[0];
          return { type: 'tool_use', toolName: tool.name, toolId: tool.id };
        }

        // Copilot CLI 1.0.2 emits the final answer as a full assistant.message,
        // often without any assistant.message_delta chunks.
        if (content && !this._sawMessageDelta) {
          return { type: 'text', text: content };
        }
        return null;
      }

      case 'result':
        return {
          type: 'result',
          sessionId: (parsed.sessionId as string | undefined) ?? this._sessionId,
          usage: {
            inputTokens: 0,
            outputTokens: this._lastOutputTokens,
          },
        };

      case 'session.shutdown': {
        const usage = extractUsageFromShutdown(inner, this._lastOutputTokens);
        return {
          type: 'result',
          sessionId: this._sessionId,
          usage,
        };
      }

      // Skip these event types
      case 'user.message':
      case 'session.model_change':
      case 'assistant.reasoning_delta':
      case 'assistant.reasoning':
      case 'assistant.turn_end':
        return null;

      default:
        // Unknown event type — skip
        return null;
    }
  }
}

function extractContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item === 'object' && item && 'text' in item && typeof item.text === 'string') {
        return item.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('');
}

function extractUsageFromShutdown(
  data: Record<string, unknown> | undefined,
  fallbackOutputTokens: number,
): { inputTokens: number; outputTokens: number } {
  const modelMetrics = data?.modelMetrics as Record<string, unknown> | undefined;
  const currentModel = data?.currentModel as string | undefined;

  const currentMetrics = (currentModel && modelMetrics?.[currentModel])
    ? modelMetrics[currentModel] as Record<string, unknown>
    : Object.values(modelMetrics ?? {})[0] as Record<string, unknown> | undefined;

  const usage = currentMetrics?.usage as Record<string, unknown> | undefined;

  return {
    inputTokens: (usage?.inputTokens as number) ?? 0,
    outputTokens: (usage?.outputTokens as number) ?? fallbackOutputTokens,
  };
}
