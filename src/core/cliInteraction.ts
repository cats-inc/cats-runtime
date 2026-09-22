import { spawn } from 'node:child_process';
import { emitKeypressEvents, type Key } from 'node:readline';

export function browserUrl(host: string, port: number, path = '/'): string {
  let hostname = host.replace(/^\[|\]$/g, '');
  if (hostname === '0.0.0.0') hostname = '127.0.0.1';
  if (hostname === '::') hostname = '::1';
  return new URL(path, `http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`).href;
}

export function browserCommand(url: string, platform = process.platform): [string, string[]] {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Browser address must be an HTTP(S) URL without credentials.');
  }
  if (platform === 'win32') {
    // EncodedCommand is a literal PowerShell program; quote its only data value.
    const command = `Start-Process -FilePath '${target.href.replace(/'/g, "''")}'`;
    return ['powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64'),
    ]];
  }
  if (platform === 'darwin') return ['open', [target.href]];
  return ['xdg-open', [target.href]];
}

export function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const [command, args] = browserCommand(url);
    // Detached Windows PowerShell can exit 0 without executing EncodedCommand.
    // Keep its console association; windowsHide prevents an extra console window.
    const child = spawn(command, args, {
      stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32',
    });
    const timer = setTimeout(() => reject(new Error('Browser launcher timed out.')), 10_000);
    timer.unref();
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Browser launcher exited with code ${code}.`));
    });
    child.unref();
  });
}

export interface CliInteractionOptions {
  url: string;
  mode: 'standalone' | 'app-managed';
  readyOutput: 'plain' | 'json' | 'silent';
  noOpen?: boolean;
  onQuit: (reason: 'keyboard' | 'sigint') => void;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  env?: NodeJS.ProcessEnv;
  openUrl?: (url: string) => Promise<void>;
}

/** Attach only after this instance is ready. Managed/stdio consumers own their input. */
export function startCliInteraction({
  url, mode, readyOutput, noOpen = false, onQuit,
  input = process.stdin, output = process.stdout, env = process.env,
  openUrl = openBrowser,
}: CliInteractionOptions): () => void {
  if (mode !== 'standalone' || readyOutput !== 'plain') return () => {};
  output.write(`\n  Open Cats: ${url}\n`);
  const ci = env.CI && env.CI !== 'false' && env.CI !== '0';
  if (!input.isTTY || !output.isTTY || ci) return () => {};

  let disposed = false;
  let opening = false;
  const wasRaw = input.isRaw;
  const wasFlowing = input.readableFlowing;
  const open = () => {
    if (disposed || opening) return;
    opening = true;
    void Promise.resolve().then(() => { if (!disposed) return openUrl(url); }).catch(() => {
      if (!disposed) output.write(`  Could not open the browser. Open ${url} manually, or press o to try again.\n`);
    }).finally(() => { opening = false; });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    input.off('keypress', onKey);
    process.off('exit', dispose);
    input.setRawMode(wasRaw);
    if (!wasFlowing) input.pause();
  };
  const onKey = (_text: string, key: Key) => {
    if (disposed || !key) return;
    if (key.ctrl && key.name === 'c') {
      dispose();
      onQuit('sigint');
    } else if (!key.ctrl && !key.meta && key.name === 'q') {
      dispose();
      onQuit('keyboard');
    } else if (!key.ctrl && !key.meta && key.name === 'o') {
      open();
    }
  };
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.on('keypress', onKey);
  input.resume();
  process.once('exit', dispose);
  output.write('  o  open browser   q  stop service   Ctrl+C  stop service\n\n');
  if (!noOpen) open();
  return dispose;
}
