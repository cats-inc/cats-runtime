import { describe, expect, it } from 'vitest';
import { buildPowerShellCommandScript, buildPowerShellExecEnv } from '../runtime/runtime.js';

describe('WorkerProcess PowerShell helpers', () => {
  it('builds a short PowerShell loader command for env-based argv passthrough', () => {
    const script = buildPowerShellCommandScript();

    expect(script).toBe(
      '$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:CATS_RUNTIME_PWSH_EXEC_B64)); '
      + '$payload = $payloadJson | ConvertFrom-Json; '
      + '$runtimeArgs = @(); '
      + 'foreach ($item in $payload.args) { $runtimeArgs += [string]$item }; '
      + '& ([string]$payload.command) @runtimeArgs; '
      + 'exit $LASTEXITCODE',
    );
  });

  it('encodes the command path and argv into a PowerShell exec payload env var', () => {
    const env = buildPowerShellExecEnv('copilot', [
      '--output-format',
      'json',
      '--stream',
      'on',
      '-p',
      "Let's go",
    ]);

    expect(env).toEqual({
      CATS_RUNTIME_PWSH_EXEC_B64: Buffer.from(JSON.stringify({
        command: 'copilot',
        args: ['--output-format', 'json', '--stream', 'on', '-p', "Let's go"],
      }), 'utf8').toString('base64'),
    });
  });
});
