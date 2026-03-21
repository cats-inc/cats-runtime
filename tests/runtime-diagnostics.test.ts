import { describe, expect, it } from 'vitest';

import { lookupRuntimeCommand } from '../src/http/routes/diagnosticsSupport.js';

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
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
