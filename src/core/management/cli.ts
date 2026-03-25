import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// CLI command result
// ---------------------------------------------------------------------------

export interface CliCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Run a CLI command as a subprocess
// ---------------------------------------------------------------------------

export async function runCliCommand(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    timeoutMs?: number;
    env?: Record<string, string>;
  },
): Promise<CliCommandResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  return new Promise<CliCommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env ? { ...process.env, ...options.env } : undefined,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    function settle(code: number | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - start,
      });
    }

    child.on('close', (code) => settle(code));
    child.on('error', () => settle(null));
  });
}

// ---------------------------------------------------------------------------
// Quick availability check
// ---------------------------------------------------------------------------

export async function isCliAvailable(
  command: string,
  versionArgs: string[] = ['--version'],
  timeoutMs = 5_000,
): Promise<{ available: boolean; version?: string }> {
  try {
    const result = await runCliCommand(command, versionArgs, { timeoutMs });
    if (result.timedOut || result.code !== 0) {
      return { available: false };
    }
    const version = result.stdout.trim().split('\n')[0] || undefined;
    return { available: true, version };
  } catch {
    return { available: false };
  }
}

// ---------------------------------------------------------------------------
// Parse JSON from CLI stdout, with fallback
// ---------------------------------------------------------------------------

export function parseCliJson<T = Record<string, unknown>>(
  stdout: string,
): T | undefined {
  try {
    return JSON.parse(stdout.trim()) as T;
  } catch {
    return undefined;
  }
}
