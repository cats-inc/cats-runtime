import { describe, expect, it } from 'vitest';
import { AiderProvider } from './aider.js';

describe('AiderProvider', () => {
  it('refuses execution because Aider exposes no machine-readable surface', () => {
    // Probed against 0.86.2: no JSON/stream output, no ACP, MCP, or server mode,
    // and --gui is a human browser UI. See
    // docs/research/2026-08-09-aider-cli-probe.md.
    const provider = new AiderProvider();

    expect(provider.name).toBe('aider');
    expect(() => provider.buildSpawnArgs({ cwd: '/tmp/aider-provider-test' }))
      .toThrow(/no machine-readable output/);
  });

  it('names the git init side effect in the refusal', () => {
    // Pointed at a non-repo directory Aider runs git init and edits .gitignore,
    // which matters because the runtime spawns into arbitrary workspaces.
    expect(() => new AiderProvider().buildSpawnArgs({ cwd: '/work' }))
      .toThrow(/git init/);
  });

  it('advertises no session capabilities', () => {
    expect(new AiderProvider().capabilities).toEqual({
      resume: false,
      fork: false,
      permissions: false,
    });
  });

  it('passes stdout lines through as raw events', () => {
    const provider = new AiderProvider();

    expect(provider.parseStreamLine('  ')).toBeNull();
    expect(provider.parseStreamLine('Tokens: 2.3k sent, 1 received.')).toEqual({
      type: 'raw',
      text: 'Tokens: 2.3k sent, 1 received.',
    });
  });
});
