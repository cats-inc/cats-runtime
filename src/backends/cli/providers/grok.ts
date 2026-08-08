import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

export class GrokProvider implements Provider {
  name = 'grok';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: false, fork: false, permissions: false };

  buildSpawnArgs(_opts: ProviderSpawnOptions): string[] {
    throw new Error(
      'Grok CLI execution is not enabled yet because its subprocess and stream contracts '
      + 'have not been probed. Install Grok through setup, then add a verified '
      + 'compatibility profile before starting Grok sessions.',
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
