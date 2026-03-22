import { parsePiModel, parsePiStreamLine } from '../pi/parser.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
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

    const instructionsFile = opts.instructionsFile ?? this.options.instructionsFile;
    if (instructionsFile) {
      args.push('--append-system-prompt', instructionsFile);
    }

    return args;
  }

  buildStdinMessage(content: string, turn?: TurnInput): string {
    const prompt = turn?.instructions
      ? ['Instructions:', turn.instructions, '', 'User message:', content].join('\n')
      : content;
    return JSON.stringify({ type: 'prompt', message: prompt }) + '\n';
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    return parsePiStreamLine(line);
  }
}
