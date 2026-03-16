import { parseJunieStreamLine } from '../junie/parser.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

export class JunieProvider implements Provider {
  name = 'junie';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  private pendingPrompt: string | null = null;

  prepareEphemeralTurn(content: string): void {
    this.pendingPrompt = content;
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [
      '--output-format', 'json',
      '--skip-update-check',
    ];

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.cwd) {
      args.push('--project', opts.cwd);
    }

    if (opts.resumeSessionId) {
      args.push('--session-id', opts.resumeSessionId);
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
    return parseJunieStreamLine(line);
  }
}
