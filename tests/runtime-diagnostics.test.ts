import { describe, expect, it } from 'vitest';

import {
  lookupRuntimeCommand,
  probeRuntimeAgentInstance,
} from '../src/http/routes/diagnosticsSupport.js';

describe('runtime diagnostics helpers', () => {
  it('times out stalled command lookups', async () => {
    const startedAt = Date.now();
    const result = await lookupRuntimeCommand('stalled-command', {
      lookupCommandName: process.execPath,
      lookupArgs: ['-e', 'setTimeout(() => {}, 10_000)'],
      timeoutMs: 50,
    });

    expect(result).toEqual({
      available: false,
      resolvedPath: undefined,
      timedOut: true,
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('times out stalled agent probes', async () => {
    const startedAt = Date.now();

    await expect(probeRuntimeAgentInstance({
      id: 'bridge',
      providerName: 'codex',
      backend: 'agent',
      transport: 'agent_sdk_bridge',
    }, true, {
      timeoutMs: 50,
      adapter: {
        kind: 'test-agent',
        probe: async () => new Promise(() => {}),
      },
    })).rejects.toThrow("Timed out while probing agent adapter 'test-agent' for codex/bridge");

    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
