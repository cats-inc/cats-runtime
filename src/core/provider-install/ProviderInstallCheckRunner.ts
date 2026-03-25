import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { ProviderRuntimeConfig } from '../../backends/cli/config.js';
import { createRuntimeAdapter, quoteForBash } from '../../backends/cli/runtime/runtime.js';
import { expandNativeEnvPath } from './pathUtils.js';

const DEFAULT_CHECK_TIMEOUT_MS = 3_000;
const FORCE_KILL_GRACE_MS = 500;

export interface RuntimeCheckCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  error?: string;
}

export interface RuntimeCommandLookupResult {
  available: boolean;
  resolvedPath?: string;
  timedOut: boolean;
  error?: string;
}

export interface RuntimePathCheckResult {
  exists: boolean;
  timedOut: boolean;
  error?: string;
}

export interface RuntimeValueCheckResult {
  value?: string;
  timedOut: boolean;
  error?: string;
}

export interface ProviderInstallCheckRunner {
  lookupCommand(
    command: string,
    runtime: ProviderRuntimeConfig,
    timeoutMs?: number,
  ): Promise<RuntimeCommandLookupResult>;
  checkPath(
    pathValue: string,
    runtime: ProviderRuntimeConfig,
    timeoutMs?: number,
  ): Promise<RuntimePathCheckResult>;
  checkNpmPackage(
    packageName: string,
    runtime: ProviderRuntimeConfig,
    timeoutMs?: number,
  ): Promise<RuntimePathCheckResult>;
  checkShellRcEntry(
    shellRcPath: string,
    entry: string,
    runtime: ProviderRuntimeConfig,
    timeoutMs?: number,
  ): Promise<RuntimePathCheckResult>;
  getNpmPrefix(
    runtime: ProviderRuntimeConfig,
    timeoutMs?: number,
  ): Promise<RuntimeValueCheckResult>;
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function isHomeRelativePath(pathValue: string): boolean {
  return pathValue.startsWith('~/') || pathValue.startsWith('~\\');
}

function resolveHomePath(pathValue: string): string {
  const expanded = expandNativeEnvPath(pathValue);
  if (!isHomeRelativePath(pathValue)) {
    return expanded;
  }

  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) {
    return expanded;
  }
  return `${home}${expanded.slice(1)}`;
}

function quotePathForRuntimeShell(pathValue: string): string {
  if (isHomeRelativePath(pathValue)) {
    return `"$HOME/${pathValue.slice(2).replace(/[\\"]/g, (value) => value === '\\' ? '/' : '\\"')}"`;
  }

  return quoteForBash(pathValue);
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<RuntimeCheckCommandResult> {
  return new Promise((resolveCommand) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeoutError: string | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: Omit<RuntimeCheckCommandResult, 'durationMs'>) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      resolveCommand({
        ...result,
        durationMs: Date.now() - startedAt,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      timeoutError = `Timed out after ${timeoutMs}ms`;
      try {
        child.kill();
      } catch {
        // Ignore kill failures and allow the close/error path to settle.
      }
      forceKillTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore force-kill failures and allow the close/error path to settle.
        }
      }, FORCE_KILL_GRACE_MS);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      finish({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        error: error.message,
      });
    });
    child.once('close', (exitCode) => {
      finish({
        exitCode,
        stdout,
        stderr,
        timedOut,
        ...(timedOut && timeoutError ? { error: timeoutError } : {}),
      });
    });
  });
}

async function runShellCommand(
  runtime: ProviderRuntimeConfig,
  script: string,
  timeoutMs: number,
): Promise<RuntimeCheckCommandResult> {
  const invocation = createRuntimeAdapter(runtime).buildShellInvocation(script);
  return runCommand(invocation.command, invocation.args, timeoutMs);
}

export const defaultProviderInstallCheckRunner: ProviderInstallCheckRunner = {
  async lookupCommand(
    command: string,
    runtime: ProviderRuntimeConfig,
    timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  ): Promise<RuntimeCommandLookupResult> {
    if (!command.trim()) {
      return {
        available: false,
        timedOut: false,
      };
    }

    if (runtime.mode === 'native' && (isAbsolute(command) || hasPathSeparator(command))) {
      const resolvedPath = isAbsolute(command)
        ? resolveHomePath(command)
        : resolvePath(resolveHomePath(command));
      try {
        await access(resolvedPath);
        return {
          available: true,
          resolvedPath,
          timedOut: false,
        };
      } catch {
        return {
          available: false,
          resolvedPath,
          timedOut: false,
        };
      }
    }

    const result = runtime.mode === 'native'
      ? await runCommand(
        process.platform === 'win32' ? 'where.exe' : 'which',
        [command],
        timeoutMs,
      )
      : await runShellCommand(
        runtime,
        `command -v ${quoteForBash(command)}`,
        timeoutMs,
      );
    const resolvedPath = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);

    return {
      available: result.exitCode === 0 && Boolean(resolvedPath),
      resolvedPath,
      timedOut: result.timedOut,
      error: result.error,
    };
  },

  async checkPath(
    pathValue: string,
    runtime: ProviderRuntimeConfig,
    timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  ): Promise<RuntimePathCheckResult> {
    if (!pathValue.trim()) {
      return {
        exists: false,
        timedOut: false,
      };
    }

    if (runtime.mode === 'native') {
      const resolvedPath = isAbsolute(pathValue)
        ? resolveHomePath(pathValue)
        : resolvePath(resolveHomePath(pathValue));
      try {
        await access(resolvedPath);
        return {
          exists: true,
          timedOut: false,
        };
      } catch {
        return {
          exists: false,
          timedOut: false,
        };
      }
    }

    const script = `test -x ${quotePathForRuntimeShell(pathValue)} && printf ok`;
    const result = await runShellCommand(runtime, script, timeoutMs);
    return {
      exists: result.exitCode === 0 && result.stdout.includes('ok'),
      timedOut: result.timedOut,
      error: result.error,
    };
  },

  async checkNpmPackage(
    packageName: string,
    runtime: ProviderRuntimeConfig,
    timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  ): Promise<RuntimePathCheckResult> {
    if (!packageName.trim()) {
      return {
        exists: false,
        timedOut: false,
      };
    }

    const result = runtime.mode === 'native'
      ? await runCommand('npm', ['list', '-g', packageName, '--depth=0'], timeoutMs)
      : await runShellCommand(
        runtime,
        `npm list -g ${quoteForBash(packageName)} --depth=0`,
        timeoutMs,
      );

    return {
      exists: result.exitCode === 0,
      timedOut: result.timedOut,
      error: result.error,
    };
  },

  async checkShellRcEntry(
    shellRcPath: string,
    entry: string,
    runtime: ProviderRuntimeConfig,
    timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  ): Promise<RuntimePathCheckResult> {
    if (!shellRcPath.trim() || !entry.trim()) {
      return {
        exists: false,
        timedOut: false,
      };
    }

    if (runtime.mode === 'native') {
      const resolvedPath = isAbsolute(shellRcPath)
        ? resolveHomePath(shellRcPath)
        : resolvePath(resolveHomePath(shellRcPath));

      try {
        const content = await readFile(resolvedPath, 'utf8');
        return {
          exists: content.includes(entry),
          timedOut: false,
        };
      } catch (error) {
        return {
          exists: false,
          timedOut: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const result = await runShellCommand(
      runtime,
      `grep -q ${quoteForBash(entry)} ${quotePathForRuntimeShell(shellRcPath)} && printf ok`,
      timeoutMs,
    );
    return {
      exists: result.exitCode === 0 && result.stdout.includes('ok'),
      timedOut: result.timedOut,
      error: result.error,
    };
  },

  async getNpmPrefix(
    runtime: ProviderRuntimeConfig,
    timeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
  ): Promise<RuntimeValueCheckResult> {
    const result = runtime.mode === 'native'
      ? await runCommand('npm', ['config', 'get', 'prefix'], timeoutMs)
      : await runShellCommand(runtime, 'npm config get prefix', timeoutMs);

    return {
      value: result.exitCode === 0
        ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
        : undefined,
      timedOut: result.timedOut,
      error: result.error,
    };
  },
};
