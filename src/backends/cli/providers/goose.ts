import { GooseNativeSessionService } from '../goose/GooseNativeSessionService.js';
import { parseGooseModel, parseGooseStreamLine } from '../goose/parser.js';
import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
  TurnInput,
} from './types.js';
import type { ResultStreamEvent } from '../../../core/types.js';
import type { ProviderEvolutionEvidenceObserver } from '../../../core/compatibility/providerEvolution.js';
import { compileRuntimeTurnPrompt } from './prompt.js';

export class GooseProvider implements Provider {
  name = 'goose';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: true, fork: false, permissions: false };

  private pendingPrompt: string | null = null;
  private readonly native: GooseNativeSessionService;

  constructor(
    native: GooseNativeSessionService,
    private readonly evolutionObserver?: ProviderEvolutionEvidenceObserver,
  ) {
    this.native = native;
  }

  prepareEphemeralTurn(turn: TurnInput): void {
    this.pendingPrompt = compileRuntimeTurnPrompt(turn.message, turn);
  }

  async afterTurn(opts: ProviderSpawnOptions): Promise<StreamEvent | null> {
    const latest = await this.native.getLatestSession(opts.cwd);
    if (!latest) return null;

    return {
      type: 'result',
      sessionId: latest.providerSessionId,
    } satisfies ResultStreamEvent;
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [
      'run',
      '--output-format', 'stream-json',
      '--quiet',
      '--max-turns', '100',
    ];

    if (opts.model) {
      const { provider, modelId } = opts.modelProvider
        ? { provider: opts.modelProvider, modelId: opts.model } : parseGooseModel(opts.model);
      args.push('--provider', provider);
      const effort = opts.modelControls?.['goose.thinking_effort'];
      // Goose's native -none suffix becomes ThinkingEffort::Off before request
      // construction, overriding saved/global effort without changing user config.
      args.push('--model', effort === 'off' ? `${modelId}-none` : modelId);
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
    return parseGooseStreamLine(line, this.evolutionObserver);
  }
}
