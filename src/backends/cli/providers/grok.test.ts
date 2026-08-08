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
      .toThrow(/Grok CLI execution is not enabled.*success-stream fixtures.*tool.*error.*cancellation.*resume lifecycle/s);
  });

  it('keeps non-JSON probe output as raw evidence', () => {
    const provider = new GrokProvider();

    expect(provider.parseStreamLine('  probe output  ')).toEqual({
      type: 'raw',
      text: 'probe output',
    });
    expect(provider.parseStreamLine('   ')).toBeNull();
  });

  it('normalizes observed native text and terminal events', () => {
    const provider = new GrokProvider();

    expect(provider.parseStreamLine('{"type":"text","data":"chunk"}')).toEqual({
      type: 'text',
      text: 'chunk',
      raw: { type: 'text', data: 'chunk' },
    });
    expect(provider.parseStreamLine(JSON.stringify({
      type: 'end',
      sessionId: 'session-fixture',
      total_cost_usd: 0.25,
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 2,
        output_tokens: 5,
        total_tokens: 20,
      },
    }))).toMatchObject({
      type: 'result',
      sessionId: 'session-fixture',
      usage: {
        inputTokens: 15,
        outputTokens: 5,
        promptInputTokens: 10,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 2,
        totalTokens: 20,
        estimatedCost: 0.25,
        currency: 'USD',
      },
    });
  });
});
