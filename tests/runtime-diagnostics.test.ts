import { describe, expect, it } from 'vitest';

import {
  lookupRuntimeCommand,
  lookupRuntimeCommandInExecutionEnvironment,
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

  it('looks up commands inside a WSL execution environment', async () => {
    const shellRunner = async (
      invocation: { command: string; args: string[] },
      _timeoutMs: number,
    ): Promise<{ status: number | null; stdout: string; timedOut: boolean }> => {
      expect(invocation).toEqual({
        command: 'wsl',
        args: ['-d', 'Ubuntu', 'bash', '-lc', "command -v 'kiro-cli'"],
      });

      return {
        status: 0,
        stdout: '/usr/local/bin/kiro-cli\n',
        timedOut: false,
      };
    };

    await expect(lookupRuntimeCommandInExecutionEnvironment(
      'kiro-cli',
      {
        mode: 'wsl',
        distro: 'Ubuntu',
      },
      { shellRunner },
    )).resolves.toEqual({
      available: true,
      resolvedPath: '/usr/local/bin/kiro-cli',
      timedOut: false,
    });
  });
});
