import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

interface CursorStreamEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  text?: string;
  timestamp_ms?: number;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string } | string>;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

function extractText(
  content: Array<{ type?: string; text?: string } | string> | undefined,
): string {
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item?.text === 'string') return item.text;
      return '';
    })
    .filter(Boolean)
    .join('');
}

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

  parseStreamLine(line: string): StreamEvent | null {
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
      return null;
    }

    if (event.type === 'assistant') {
      const text = extractText(event.message?.content);
      if (!text) return null;

      if (event.timestamp_ms) {
        this.sawAssistantChunk = true;
        return { type: 'text', text };
      }

      if (this.sawAssistantChunk) {
        return null;
      }

      return { type: 'text', text };
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
