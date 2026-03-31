import { spawn } from 'node:child_process';
import { hiddenWindowsSpawnOptions } from '../../../core/process/windowsSpawn.js';

type CommandRunner = (command: string, args: string[]) => Promise<{
  code: number;
  stdout: string;
  stderr: string;
}>;

export async function isDockerContainerRunning(
  container: string,
  runner: CommandRunner = defaultCommandRunner,
): Promise<boolean> {
  const result = await runner('docker', [
    'inspect',
    '--format',
    '{{.State.Running}}',
    container,
  ]);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim()
        || result.stdout.trim()
        || `Failed to inspect Docker container '${container}'`,
    );
  }

  return result.stdout.trim().toLowerCase() === 'true';
}

async function defaultCommandRunner(
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...hiddenWindowsSpawnOptions(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
      });
    });
  });
}
