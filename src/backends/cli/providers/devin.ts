import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

export class DevinProvider implements Provider {
  name = 'devin';
  ephemeral = true;
  // Devin 3000.3.27 supports -c/--continue and -r/--resume, but the runtime
  // cannot drive them yet: --print emits plain prose with no session id and no
  // structured events. See docs/research/2026-08-08-devin-cli-probe.md.
  capabilities: ProviderCapabilities = { resume: false, fork: false, permissions: true };

  buildSpawnArgs(_opts: ProviderSpawnOptions): string[] {
    throw new Error(
      'Devin CLI execution is not enabled through the CLI backend. Devin 3000.3.27 has no '
      + 'machine-readable output mode: --print returns plain prose, so tool calls, usage, and '
      + 'session identity are unrecoverable. Its structured surface is the ACP server '
      + '(devin acp), which belongs to the agent backend.',
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
