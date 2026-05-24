import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

export class AntigravityProvider implements Provider {
  name = 'antigravity';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: false, fork: false, permissions: false };

  buildSpawnArgs(_opts: ProviderSpawnOptions): string[] {
    throw new Error(
      'Antigravity CLI execution is not enabled yet because the raw agy subprocess '
      + 'or stream contract has not been probed. Install agy through setup, then add '
      + 'a verified compatibility profile before starting Antigravity sessions.',
    );
  }

  buildStdinMessage(_content: string): string {
    return '';
  }

  parseStreamLine(line: string): StreamEvent | null {
    const text = line.trim();
    return text ? { type: 'raw', text } : null;
  }
}
