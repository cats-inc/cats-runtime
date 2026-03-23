import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
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

/**
 * Extract text from Gemini content which can be a string or a part-list array.
 * Part-list format: [{ text: "..." }, { functionCall: ... }, ...]
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: Record<string, unknown>) => {
        if (typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  return '';
}

export class GeminiProvider implements Provider {
  name = 'gemini';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  constructor(
    private readonly compatibilityProfile?: CompatibilityProfileSelection,
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

  parseStreamLine(line: string): StreamEvent | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    let event: GeminiStreamEvent;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return { type: 'raw', text: trimmed };
    }

    // init — session ID
    if (event.type === 'init') {
      return {
        type: 'init',
        sessionId: event.session_id,
      };
    }

    // message — assistant text content
    if (event.type === 'message') {
      if (event.role === 'user') return null; // skip echo
      if (event.role === 'assistant' && event.content) {
        const text = extractText(event.content);
        if (text) return { type: 'text', text };
      }
      return null;
    }

    // tool_use — Gemini CLI uses snake_case field names
    if (event.type === 'tool_use') {
      return {
        type: 'tool_use',
        toolName: event.tool_name,
        toolId: event.tool_id,
      };
    }

    // tool_result — skip
    if (event.type === 'tool_result') {
      return null;
    }

    // error
    if (event.type === 'error') {
      return {
        type: 'error',
        text: event.message,
      };
    }

    // result — final event with usage stats
    if (event.type === 'result') {
      return {
        type: 'result',
        usage: event.stats ? {
          inputTokens: event.stats.input_tokens ?? 0,
          outputTokens: event.stats.output_tokens ?? 0,
        } : undefined,
      };
    }

    return { type: 'raw', text: trimmed };
  }
}
