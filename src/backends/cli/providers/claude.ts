import type {
  CompatibilityProfileSelection,
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  ClaudeStreamEvent,
  TurnInput,
} from './types.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';
import {
  observeNormalized,
  observeRawPassthrough,
} from '../../../core/compatibility/providerEvolution.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

export class ClaudeProvider implements Provider {
  name = 'claude';
  capabilities: ProviderCapabilities = { resume: true, fork: true, permissions: true };

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

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }

    if (opts.forkSession) {
      args.push('--fork-session');
    }

    switch (opts.permissionMode) {
      case 'skip':
        args.push('--dangerously-skip-permissions');
        break;
      case 'whitelist':
        if (opts.allowedTools?.length) {
          args.push('--allowedTools', opts.allowedTools.join(','));
        }
        break;
      // 'default' — no extra flags
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

  parseStreamLine(line: string): StreamEvent | null {
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
      });
    }

    // system/init — session ID
    if (event.type === 'system' && event.subtype === 'init') {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'system:init',
        rawSample: event,
      }, {
        type: 'init',
        sessionId: event.session_id,
        raw: event,
      });
    }

    // assistant message — accumulate text content
    if (event.type === 'assistant' && event.message?.content) {
      const texts = event.message.content
        .map((block) => {
          if (typeof block === 'string') return block;
          if (block.text) return block.text;
          return null;
        })
        .filter(Boolean);

      if (texts.length > 0) {
        return observeNormalized(this.evolutionObserver, {
          rawEventType: 'assistant',
          rawSample: event,
        }, {
          type: 'text',
          text: texts.join(''),
          raw: event,
        });
      }
    }

    // content_block_delta — streaming text chunks
    if (event.type === 'content_block_delta' && event.content_block_delta?.text) {
      return observeNormalized(this.evolutionObserver, {
        rawEventType: 'content_block_delta',
        rawSample: event,
      }, {
        type: 'text',
        text: event.content_block_delta.text,
        raw: event,
      });
    }

    // result — done, with token usage
    if (event.type === 'result') {
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
        } : undefined,
        raw: event,
      });
    }

    // Pass through anything else as raw
    return observeRawPassthrough(this.evolutionObserver, {
      rawEventType: event.subtype ? `${event.type}:${event.subtype}` : event.type,
      reason: 'unhandled_claude_event',
      rawSample: event,
    }, {
      type: 'raw',
      raw: event,
    });
  }
}
