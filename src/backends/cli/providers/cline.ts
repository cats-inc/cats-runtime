import type {
  Provider,
  ProviderCapabilities,
  ProviderSpawnOptions,
  StreamEvent,
} from './types.js';

export class ClineProvider implements Provider {
  name = 'cline';
  ephemeral = true;
  // Cline 3.0.51 rejects `--id` whenever `--json` is set, so resume is not
  // reachable from the machine-readable mode the runtime depends on. See
  // docs/research/2026-08-08-cline-cli-probe.md.
  capabilities: ProviderCapabilities = { resume: false, fork: false, permissions: true };

  buildSpawnArgs(_opts: ProviderSpawnOptions): string[] {
    throw new Error(
      'Cline CLI execution is not enabled yet. The 3.0.51 --json stream contract has '
      + 'been probed but its parser is not wired, so sessions would drop tool and usage '
      + 'events. Install cline through setup and wait for the verified adapter.',
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
