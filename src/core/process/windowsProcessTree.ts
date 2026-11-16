import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { hiddenWindowsSpawnOptions } from './windowsSpawn.js';

/** How long taskkill gets before the process alone is killed instead. */
export const TASKKILL_TIMEOUT_MS = 1000;

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/**
 * Ends a Windows process together with every process it started (`taskkill /T /F`). A shell
 * proxy (cmd.exe running a `.cmd` shim) killed on its own leaves the CLI it runs, and the folder
 * that CLI works in, behind. taskkill finds the tree through parent links, so the caller keeps the
 * tree alive until then: closing the process's input first can let the CLI exit and orphan what it
 * started. When taskkill cannot run, fails or hangs, the process alone is killed and its input
 * closed, so a CLI left behind at least sees the end of its input.
 */
export function killWindowsProcessTree(child: ChildProcess, run: Spawn = spawn): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const killOne = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
    child.kill();
  };
  let killer: ChildProcess;
  try {
    killer = run('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', ...hiddenWindowsSpawnOptions() });
  } catch {
    killOne();
    return;
  }
  const reap = setTimeout(() => {
    killOne();
    killer.kill();
  }, TASKKILL_TIMEOUT_MS);
  reap.unref?.();
  killer.on('error', () => {
    clearTimeout(reap);
    killOne();
  });
  killer.on('exit', (code) => {
    clearTimeout(reap);
    if (code !== 0) killOne();
  });
}
