import { describe, expect, it } from 'vitest';
import { ClineProvider } from './cline.js';

describe('ClineProvider', () => {
  it('refuses to spawn until the verified adapter lands', () => {
    const provider = new ClineProvider();

    expect(provider.name).toBe('cline');
    expect(provider.ephemeral).toBe(true);
    expect(() => provider.buildSpawnArgs({ cwd: '/tmp/cline-provider-test' }))
      .toThrow(/Cline CLI execution is not enabled yet/);
  });

  it('reports resume as unavailable because --id conflicts with --json on 3.0.51', () => {
    // Live probe: `cline --json --id <any-value> "prompt"` fails identically for a valid
    // and a bogus session id, so resume is unreachable from machine-readable mode.
    // See docs/research/2026-08-08-cline-cli-probe.md.
    expect(new ClineProvider().capabilities).toEqual({
      resume: false,
      fork: false,
      permissions: true,
    });
  });

  it('passes stdout lines through as raw events while unwired', () => {
    const provider = new ClineProvider();

    expect(provider.parseStreamLine('  ')).toBeNull();
    expect(provider.parseStreamLine('{"type":"run_result"}')).toEqual({
      type: 'raw',
      text: '{"type":"run_result"}',
    });
  });
});
