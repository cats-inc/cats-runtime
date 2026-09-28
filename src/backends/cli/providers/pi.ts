import { parsePiModel, parsePiStreamLine } from '../pi/parser.js';
import { mergeRuntimeInstructionLayers } from '../../../core/skills/catalog.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';

interface PiProviderOptions {
  instructionsFile?: string;
  evolutionObserver?: ProviderEvolutionEvidenceObserver;
}

export class PiProvider implements Provider {
  name = 'pi';
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };
  private activeInstructionsFile?: string;
  private requestedModelId: string | null = null;

  constructor(private readonly options: PiProviderOptions = {}) {}

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = ['--mode', 'rpc'];
    this.requestedModelId = null;

    if (opts.model) {
      const { provider, modelId } = opts.modelProvider
        ? { provider: opts.modelProvider, modelId: opts.model } : parsePiModel(opts.model);
      args.push('--provider', provider);
      args.push('--model', modelId);
      this.requestedModelId = modelId;
      const thinking = opts.modelControls?.['pi.thinking'];
      if (typeof thinking === 'string') args.push('--thinking', thinking);
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
    const parsed = parsePiStreamLine(line, this.options.evolutionObserver);
    const requested = this.requestedModelId;
    if (!parsed || !requested) return parsed;
    const compare = (event: StreamEvent): StreamEvent =>
      event.type === 'result' && event.reportedModels
        ? {
            ...event,
            reportedModels: event.reportedModels.map((entry) => ({
              ...entry,
              matchesRequest: entry.model.toLowerCase() === requested.toLowerCase(),
            })),
          }
        : event;
    return Array.isArray(parsed) ? parsed.map(compare) : compare(parsed);
  }
}
