import { parsePiModel, parsePiStreamLine } from '../pi/parser.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

export class PiProvider implements Provider {
  name = 'pi';
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = ['--mode', 'rpc'];

    if (opts.model) {
      const { provider, modelId } = parsePiModel(opts.model);
      args.push('--provider', provider);
      args.push('--model', modelId);
    }

    if (opts.resumeSessionId) {
      args.push('--session', opts.resumeSessionId);
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
