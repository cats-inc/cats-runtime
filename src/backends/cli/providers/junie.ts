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

  resolveFirstEventTimeoutMs(_defaultTimeoutMs: number): number {
    // Junie only writes its JSON result after the task finishes.
    return 0;
  }

  buildSpawnArgs(opts: ProviderSpawnOptions): string[] {
    const args: string[] = [
      '--output-format', 'json',
      '--skip-update-check',
    ];

    const model = normalizeJunieModelId(opts.model);
    if (model) {
      args.push('--model', model);
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

function normalizeJunieModelId(model?: string): string | undefined {
  if (!model) return undefined;

  const trimmed = model.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/^openai\//, '')
    .replace(/^anthropic\//, '')
    .replace(/^google\//, '')
    .replace(/^xai\//, '')
    .trim();

  if (normalized.includes('codex')) {
    return 'gpt-codex';
  }

  if (normalized.startsWith('gpt')) {
    return 'gpt';
  }

  if (normalized.includes('opus')) {
    return 'opus';
  }

  if (normalized.includes('sonnet')) {
    return 'sonnet';
  }

  if (normalized.includes('gemini') && normalized.includes('flash')) {
    return 'gemini-flash';
  }

  if (normalized.includes('gemini')) {
    return 'gemini-pro';
  }

  if (normalized.includes('grok')) {
    return 'grok';
  }

  return trimmed;
}
