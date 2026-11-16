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
 * closed, so a CLI left behind at least sees the end of its input. Settles once taskkill has
 * finished or the process has been killed alone; it never rejects.
 */
export function killWindowsProcessTree(child: ChildProcess, run: Spawn = spawn): Promise<void> {
  // After exit the PID may already belong to another process; never hand it to taskkill then.
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const killOne = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
    child.kill();
  };
  return new Promise((done) => {
    let killer: ChildProcess;
    try {
      killer = run('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', ...hiddenWindowsSpawnOptions() });
    } catch {
      killOne();
      done();
      return;
    }
    const reap = setTimeout(() => {
      killOne();
      killer.kill();
      done();
    }, TASKKILL_TIMEOUT_MS);
    reap.unref?.();
    killer.on('error', () => {
      clearTimeout(reap);
      killOne();
      done();
    });
    killer.on('exit', (code) => {
      clearTimeout(reap);
      if (code !== 0) killOne();
      done();
    });
  });
}

/**
 * Ends a helper process the caller spawned, and everything it started, with no chance to clean
 * up. On Windows that is the tree under it ({@link killWindowsProcessTree}). Elsewhere the caller
 * must have spawned it `detached`, so that it leads a process group, and the whole group gets
 * SIGKILL; when that fails, the process alone. The group is signalled even after its leader has
 * exited: what the leader started can still hold its output open, and a group's ID is not reused
 * while any member is alive. Settles as {@link killWindowsProcessTree} does.
 */
export function killProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  run: Spawn = spawn,
): Promise<void> {
  if (platform === 'win32') return killWindowsProcessTree(child, run);
  if (child.pid !== undefined) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
  return Promise.resolve();
}

/** CLIs `stopCliProcess` has already been asked to stop. */
const stoppedClis = new WeakSet<ChildProcess>();

/**
 * Stops a provider CLI the Runtime runs. On Windows the CLI goes together with every process under
 * it ({@link killWindowsProcessTree}): Windows does not end a process's children with it, and only
 * a CLI that is a Node program ends its own. Elsewhere it gets SIGTERM. A CLI already being stopped
 * is left to that stop.
 */
export function stopCliProcess(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  run: Spawn = spawn,
): void {
  if (child.exitCode !== null || child.signalCode !== null || stoppedClis.has(child)) return;
  stoppedClis.add(child);
  if (platform === 'win32') void killWindowsProcessTree(child, run);
  else child.kill('SIGTERM');
}
