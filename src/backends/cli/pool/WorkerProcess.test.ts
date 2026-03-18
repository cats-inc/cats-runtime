import { describe, expect, it } from 'vitest';
import type { ProviderCommandConfig } from '../config.js';
import { WorkerProcess } from './WorkerProcess.js';
import { buildPowerShellCommandScript, buildPowerShellExecEnv } from '../runtime/runtime.js';
import type { Provider, StreamEvent } from '../providers/types.js';

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

  it('times out silent ephemeral providers by default', async () => {
    const worker = new WorkerProcess(
      createCompletionOnlyProvider(),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 10 },
    );

    await expect(worker.sendMessage('ignored')).rejects.toThrow(
      'Provider did not respond within 10ms',
    );
  });

  it('lets completion-only ephemeral providers disable the first-event timeout', async () => {
    const worker = new WorkerProcess(
      createCompletionOnlyProvider(0),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 10 },
    );

    await expect(worker.sendMessage('ignored')).resolves.toEqual([
      { type: 'result', sessionId: 'junie-session' },
    ]);
  });

  it('surfaces the real process exit error when an ephemeral provider exits before emitting any events', async () => {
    const worker = new WorkerProcess(
      createMaskingErrorProvider(),
      { cwd: process.cwd() },
      createNodeCommandConfig(),
      { retries: 1, timeoutMs: 1000 },
    );

    await expect(worker.sendMessage('ignored')).rejects.toThrow(
      /Process exited with code 127 before responding\..*stderr: sh: 1: auggie: not found/s,
    );
  });
});

function createNodeCommandConfig(): ProviderCommandConfig {
  return {
    path: process.execPath,
    runner: 'direct',
    runtime: { mode: 'native' },
  };
}

function createCompletionOnlyProvider(
  timeoutOverrideMs?: number,
): Provider {
  return {
    name: 'junie',
    capabilities: { resume: true, fork: false, permissions: false },
    ephemeral: true,
    buildSpawnArgs() {
      return [
        '-e',
        [
          "setTimeout(() => {",
          "  process.stdout.write(JSON.stringify({ sessionId: 'junie-session', result: 'done' }) + '\\n');",
          '}, 50);',
        ].join(' '),
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine(line: string): StreamEvent | null {
      const data = JSON.parse(line) as { sessionId?: string };
      return {
        type: 'result',
        sessionId: data.sessionId,
      };
    },
    resolveFirstEventTimeoutMs(defaultTimeoutMs: number): number {
      return timeoutOverrideMs ?? defaultTimeoutMs;
    },
  };
}

function createMaskingErrorProvider(): Provider {
  return {
    name: 'auggie',
    capabilities: { resume: true, fork: false, permissions: true },
    ephemeral: true,
    buildSpawnArgs() {
      return [
        '-e',
        [
          "process.stderr.write('sh: 1: auggie: not found\\n');",
          'process.exit(127);',
        ].join(' '),
      ];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine() {
      return null;
    },
    async afterTurn() {
      throw new Error('Auggie exited without emitting a usable JSON result.');
    },
  };
}
