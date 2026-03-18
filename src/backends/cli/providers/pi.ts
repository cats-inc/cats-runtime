import { parsePiModel, parsePiStreamLine } from '../pi/parser.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

interface PiProviderOptions {
  instructionsFile?: string;
}

export class PiProvider implements Provider {
  name = 'pi';
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  constructor(private readonly options: PiProviderOptions = {}) {}

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = ['--mode', 'rpc'];

    if (opts.model) {
      const { provider, modelId } = parsePiModel(opts.model);
      args.push('--provider', provider);
      args.push('--model', modelId);
    }

    const resumeSourcePath = opts.resumeSourcePath || opts.resumeSessionId;
    if (resumeSourcePath) {
      args.push('--session', resumeSourcePath);
    }

    if (this.options.instructionsFile) {
      args.push('--append-system-prompt', this.options.instructionsFile);
    }

    return args;
  }

  buildStdinMessage(content: string): string {
    return JSON.stringify({ type: 'prompt', message: content }) + '\n';
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    return parsePiStreamLine(line);
  }
}
