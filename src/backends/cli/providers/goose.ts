import { GooseNativeSessionService } from '../goose/GooseNativeSessionService.js';
import { parseGooseModel, parseGooseStreamLine } from '../goose/parser.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

export class GooseProvider implements Provider {
  name = 'goose';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  private pendingPrompt: string | null = null;
  private readonly native: GooseNativeSessionService;

  constructor(native: GooseNativeSessionService) {
    this.native = native;
  }

  prepareEphemeralTurn(content: string): void {
    this.pendingPrompt = content;
  }

  async afterTurn(opts: ProviderSpawnOptions): Promise<StreamEvent | null> {
    const latest = await this.native.getLatestSession(opts.cwd);
    if (!latest) return null;

    return {
      type: 'result',
      sessionId: latest.providerSessionId,
    };
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [
      'run',
      '--output-format', 'stream-json',
      '--quiet',
      '--max-turns', '100',
    ];

    if (opts.model) {
      const { provider, modelId } = parseGooseModel(opts.model);
      args.push('--provider', provider);
      args.push('--model', modelId);
    }

    if (opts.resumeSessionId) {
      args.push('--name', opts.resumeSessionId, '--resume');
    }

    if (this.pendingPrompt) {
      args.push('--text', this.pendingPrompt);
      this.pendingPrompt = null;
    }

    return args;
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    return parseGooseStreamLine(line);
  }
}
