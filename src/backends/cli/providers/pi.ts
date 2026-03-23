import { parsePiModel, parsePiStreamLine } from '../pi/parser.js';
import { mergeRuntimeInstructionLayers } from '../../../core/skills/catalog.js';
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
  private activeInstructionsFile?: string;

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
    this.activeInstructionsFile = instructionsFile;
    if (instructionsFile) {
      args.push('--append-system-prompt', instructionsFile);
    }

    return args;
  }

  buildStdinMessage(content: string, turn?: TurnInput): string {
    const skillInstructionsFile = turn?.skills?.delivery.instructions?.filePath;
    const inlineSkillState = !skillInstructionsFile || skillInstructionsFile !== this.activeInstructionsFile
      ? turn?.skills
      : undefined;
    const compiledInstructions = mergeRuntimeInstructionLayers(
      inlineSkillState,
      turn?.sessionInstructions,
      turn?.instructions,
    );
    const prompt = compiledInstructions
      ? ['Instructions:', compiledInstructions, '', 'User message:', content].join('\n')
      : content;
    return JSON.stringify({ type: 'prompt', message: prompt }) + '\n';
  }

  parseStreamLine(line: string): StreamEvent | StreamEvent[] | null {
    return parsePiStreamLine(line);
  }
}
