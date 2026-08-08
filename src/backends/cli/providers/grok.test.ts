import { describe, expect, it } from 'vitest';
import { GrokProvider } from './grok.js';

describe('GrokProvider', () => {
  it('refuses execution until a subprocess and stream contract is verified', () => {
    const provider = new GrokProvider();

    expect(provider.ephemeral).toBe(true);
    expect(provider.capabilities).toEqual({
      resume: false,
      fork: false,
      permissions: false,
    });
    expect(() => provider.buildSpawnArgs({ cwd: '/tmp/grok-provider-test' }))
      .toThrow(/Grok CLI execution is not enabled.*subprocess and stream contracts.*setup.*compatibility profile/s);
  });

  it('keeps non-empty probe output as raw evidence', () => {
    const provider = new GrokProvider();

    expect(provider.parseStreamLine('  probe output  ')).toEqual({
      type: 'raw',
      text: 'probe output',
    });
    expect(provider.parseStreamLine('   ')).toBeNull();
  });
});
