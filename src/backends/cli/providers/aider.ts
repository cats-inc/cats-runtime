import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

export class AiderProvider implements Provider {
  name = 'aider';
  ephemeral = true;
  capabilities: ProviderCapabilities = { resume: false, fork: false, permissions: false };

  buildSpawnArgs(_opts: ProviderSpawnOptions): string[] {
    throw new Error(
      'Aider execution is not supported. Aider 0.86.2 has no machine-readable output, no '
      + 'ACP or server mode, and exits 0 even when the model call fails, so the runtime '
      + 'cannot recover text, tool calls, usage, or success from a turn. It also runs '
      + 'git init in the working directory. Aider is installable and detectable through '
      + 'setup, but not runnable as a runtime provider.',
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
