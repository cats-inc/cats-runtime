import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ProcessSpawnConfig } from './runtime.js';

export interface ManagedCodexHost {
  url: string;
  /** Always resolves; an unexpected exit is reported to the owning worker. */
  closed: Promise<void>;
  stop(): void;
}

/** Only native Windows app-server tasks need a host; quota reads never turn. */
export function windowsCodexHostPath(config: ProcessSpawnConfig, provider: string): string | null {
  if (process.platform !== 'win32' || provider !== 'codex' || config.shell
    || basename(config.command).toLowerCase() !== 'codex.exe'
    || !config.args.includes('app-server')
    || config.args.some((arg) => arg === '--code-mode-host' || arg.startsWith('--code-mode-host='))) return null;
  const host = join(dirname(config.command), 'codex-code-mode-host.exe');
  try { return statSync(host).isFile() ? host : null; } catch { return null; }
}

// Keep the host tied to an input pipe, including when Runtime is forcibly
// terminated on Windows (where JS signal/exit handlers do not run). The guard
// owns only this host, drains diagnostics, and never touches unrelated PIDs.
export const CODEX_HOST_GUARD = String.raw`
const { spawn } = require('node:child_process');
const host = spawn(process.argv[1], process.argv.slice(2), {
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  host.kill();
}
host.stdout.pipe(process.stdout);
host.stderr.pipe(process.stderr);
process.stdout.on('error', stop);
process.stderr.on('error', stop);
process.stdin.on('error', stop);
process.stdin.on('end', stop);
process.stdin.resume();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
host.on('error', (err) => { console.error(err.message); process.exit(1); });
host.on('exit', (code) => process.exit(stopping ? 0 : (code || 1)));
`;

const supportCache = new Map<string, boolean>();

/** Capability probe, never a version allowlist. Failed probes remain retryable. */
async function supportsExternalHost(
  config: ProcessSpawnConfig, host: string, env: NodeJS.ProcessEnv, signal: AbortSignal,
): Promise<boolean> {
  const stamp = (path: string) => {
    const stat = statSync(path);
    return `${path}:${stat.size}:${stat.mtimeMs}`;
  };
  const key = `${stamp(config.command)}|${stamp(host)}`;
  const cached = supportCache.get(key);
  if (cached !== undefined) return cached;
  const help = (command: string, args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(command, args, {
      cwd: config.cwd, env, windowsHide: true, timeout: 5_000, maxBuffer: 256 * 1024, signal,
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  try {
    const serverHelp = await help(config.command, ['app-server', '--help']);
    const hostHelp = await help(host, ['--help']);
    const supported = serverHelp.includes('--code-mode-host') && hostHelp.includes('grpc://');
    if (supportCache.size >= 32) supportCache.clear();
    supportCache.set(key, supported);
    return supported;
  } catch (error) {
    if (signal.aborted) throw error;
    return false;
  }
}

export async function startWindowsCodexHost(
  config: ProcessSpawnConfig,
  hostPath: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<ManagedCodexHost | null> {
  signal.throwIfAborted();
  if (!await supportsExternalHost(config, hostPath, env, signal)) return null;
  signal.throwIfAborted();
  const guard = spawn(process.execPath, ['-e', CODEX_HOST_GUARD, hostPath, '--listen', 'grpc://127.0.0.1:0'], {
    cwd: config.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
  });
  return waitForHost(guard, signal);
}

function waitForHost(guard: ChildProcess, signal: AbortSignal): Promise<ManagedCodexHost> {
  return new Promise((resolve, reject) => {
    let ready = false;
    let stopped = false;
    let output = '';
    let diagnostics = '';
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      // EOF asks the guard to kill its host before it exits. Killing the guard
      // itself would strand the host on Windows.
      guard.stdin?.end();
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const fail = (error: Error) => {
      cleanup();
      stop();
      if (!ready) reject(error);
    };
    const abort = () => fail(new Error('Codex Code Mode host startup cancelled.'));
    const timer = setTimeout(() => fail(new Error('Codex Code Mode host did not publish its address within 5s.')), 5_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    guard.stdin?.on('error', (error) => fail(error));
    guard.on('error', (error) => { fail(error); resolveClosed(); });
    guard.on('close', () => {
      fail(new Error(`Codex Code Mode host exited${diagnostics ? `: ${diagnostics.trim()}` : '.'}`));
      resolveClosed();
    });
    guard.stderr?.on('data', (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString('utf8')).slice(-2_048);
    });
    guard.stdout?.on('data', (chunk: Buffer) => {
      if (ready || stopped) return;
      output += chunk.toString('utf8');
      if (output.length > 4_096) { fail(new Error('Invalid Codex Code Mode host address.')); return; }
      const end = output.indexOf('\n');
      if (end < 0) return;
      const url = output.slice(0, end).trim();
      const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/u.exec(url);
      if (!match || Number(match[1]) > 65_535) { fail(new Error('Invalid Codex Code Mode host address.')); return; }
      ready = true;
      cleanup();
      resolve({ url, closed, stop });
    });
  });
}
