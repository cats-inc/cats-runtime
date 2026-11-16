import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { hiddenWindowsSpawnOptions } from './windowsSpawn.js';

/** How long taskkill gets before the process alone is killed instead. */
export const TASKKILL_TIMEOUT_MS = 1000;

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/**
 * Ends a Windows process together with every process it started (`taskkill /T /F`). A shell
 * proxy (cmd.exe running a `.cmd` shim) killed on its own leaves the CLI it runs, and the folder
 * that CLI works in, behind. taskkill finds the tree through the live parent, so it runs before the
 * parent can be gone. When taskkill cannot run, fails or hangs, the process alone is killed.
 */
export function killWindowsProcessTree(child: ChildProcess, run: Spawn = spawn): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const killOne = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
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
