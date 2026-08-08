import { describe, expect, it } from 'vitest';
import { DevinProvider } from './devin.js';

describe('DevinProvider', () => {
  it('refuses CLI execution because Devin has no machine-readable output mode', () => {
    // Not a "not yet probed" refusal: 3000.3.27 was probed and --print returns
    // plain prose, so tool calls, usage, and session identity are unrecoverable.
    // See docs/research/2026-08-08-devin-cli-probe.md.
    const provider = new DevinProvider();

    expect(provider.name).toBe('devin');
    expect(provider.ephemeral).toBe(true);
    expect(() => provider.buildSpawnArgs({ cwd: '/tmp/devin-provider-test' }))
      .toThrow(/no machine-readable output mode/);
  });

  it('points at the ACP server as the structured surface', () => {
    expect(() => new DevinProvider().buildSpawnArgs({ cwd: '/work' }))
      .toThrow(/devin acp/);
  });

  it('reports resume as unavailable despite the CLI exposing --resume', () => {
    // -c/--continue and -r/--resume exist, but --print emits no session id, so
    // the runtime has nothing to resume against.
    expect(new DevinProvider().capabilities).toEqual({
      resume: false,
      fork: false,
      permissions: true,
    });
  });

  it('passes stdout lines through as raw events', () => {
    const provider = new DevinProvider();

    expect(provider.parseStreamLine('   ')).toBeNull();
    expect(provider.parseStreamLine('OK')).toEqual({ type: 'raw', text: 'OK' });
  });
});
