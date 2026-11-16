import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { killProcessTree, killWindowsProcessTree, TASKKILL_TIMEOUT_MS } from './processTree.js';

function fakeChild(overrides: Partial<{ pid: number | undefined; exitCode: number | null }> = {}) {
  return Object.assign(new EventEmitter(), {
    pid: 4321 as number | undefined, exitCode: null as number | null, signalCode: null, kill: vi.fn(() => true),
    ...overrides,
  }) as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

function fakeKiller() {
  return Object.assign(new EventEmitter(), { kill: vi.fn(() => true) }) as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

describe('process tree kill', () => {
  afterEach(() => { vi.useRealTimers(); });

  /** Whether a promise has settled by the time the queued callbacks have run. */
  async function settled(promise: Promise<void>): Promise<boolean> {
    let done = false;
    void promise.then(() => { done = true; });
    await Promise.resolve();
    return done;
  }

  it('ends the whole tree with taskkill and leaves the process to it when taskkill succeeds', async () => {
    const child = fakeChild();
    const killer = fakeKiller();
    const run = vi.fn(() => killer);
    const stopped = killWindowsProcessTree(child, run);
    expect(run).toHaveBeenCalledWith('taskkill.exe', ['/pid', '4321', '/t', '/f'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true }));
    expect(await settled(stopped)).toBe(false);
    killer.emit('exit', 0);
    expect(await settled(stopped)).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills the process alone when taskkill fails, cannot start or hangs, and settles then', async () => {
    vi.useFakeTimers();
    for (const failure of ['exit', 'error', 'throw', 'hang'] as const) {
      const child = fakeChild();
      const killer = fakeKiller();
      const stopped = killWindowsProcessTree(child, () => {
        if (failure === 'throw') throw new Error('no taskkill');
        return killer;
      });
      if (failure === 'exit') killer.emit('exit', 128);
      if (failure === 'error') killer.emit('error', new Error('ENOENT'));
      if (failure === 'hang') vi.advanceTimersByTime(TASKKILL_TIMEOUT_MS);
      expect(child.kill, failure).toHaveBeenCalledOnce();
      if (failure === 'hang') expect(killer.kill).toHaveBeenCalledOnce();
      expect(await settled(stopped), failure).toBe(true);
    }
  });

  it('closes the input of a process it has to kill alone', () => {
    const stdin = new PassThrough();
    const child = Object.assign(fakeChild(), { stdin });
    const killer = fakeKiller();
    killWindowsProcessTree(child, () => killer);
    expect(stdin.writableEnded).toBe(false);
    killer.emit('exit', 1);
    expect(stdin.writableEnded).toBe(true);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('does nothing for a process that has no pid or has already exited', async () => {
    const run = vi.fn();
    expect(await settled(killWindowsProcessTree(fakeChild({ pid: undefined }), run))).toBe(true);
    expect(await settled(killWindowsProcessTree(fakeChild({ exitCode: 0 }), run))).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  describe('killProcessTree', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('uses taskkill on Windows', async () => {
      const child = fakeChild();
      const killer = fakeKiller();
      const run = vi.fn(() => killer);
      const stopped = killProcessTree(child, 'win32', run);
      expect(run).toHaveBeenCalledWith('taskkill.exe', ['/pid', '4321', '/t', '/f'], expect.anything());
      killer.emit('exit', 0);
      expect(await settled(stopped)).toBe(true);
    });

    it('sends SIGKILL to the process group elsewhere, also once its leader has exited', async () => {
      const signal = vi.spyOn(process, 'kill').mockImplementation(() => true);
      const run = vi.fn();
      for (const exitCode of [null, 0]) {
        const child = fakeChild({ exitCode });
        expect(await settled(killProcessTree(child, 'linux', run))).toBe(true);
        expect(child.kill).not.toHaveBeenCalled();
      }
      expect(signal.mock.calls).toEqual([[-4321, 'SIGKILL'], [-4321, 'SIGKILL']]);
      expect(run).not.toHaveBeenCalled();
    });

    it('kills the process alone when its group cannot be signalled, and skips one with no pid', async () => {
      vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); });
      const child = fakeChild();
      await killProcessTree(child, 'darwin');
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      const unstarted = fakeChild({ pid: undefined });
      await killProcessTree(unstarted, 'linux');
      expect(unstarted.kill).not.toHaveBeenCalled();
    });
  });

  /**
   * A CLI that ignores its closed input and has started a detached tool process of its own, behind a
   * batch shim like npm's, run through a cmd.exe proxy. Everything it starts is reaped afterwards.
   */
  class StubbornCli {
    readonly dir = mkdtempSync(join(tmpdir(), 'cats-runtime-process-tree-'));
    proxy: ChildProcess | undefined;
    pids: number[] = [];

    async start() {
      const pidFile = join(this.dir, 'pids');
      const script = join(this.dir, 'stubborn.cjs');
      writeFileSync(script, [
        // The folder as an argument names the tool as this fixture's in its command line.
        `const tool = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ${JSON.stringify(this.dir)}],`
          + " { detached: true, stdio: 'ignore', windowsHide: true });",
        `require('fs').writeFileSync(${JSON.stringify(pidFile)}, process.pid + ' ' + tool.pid);`,
        "process.stdin.resume(); process.stdin.on('end', () => {}); setInterval(() => {}, 1000);",
      ].join('\n'));
      const shim = join(this.dir, 'stubborn.cmd');
      writeFileSync(shim, `@"${process.execPath}" "${script}" %*\r\n`);
      this.proxy = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${shim}"`],
        { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, windowsVerbatimArguments: true });
      await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 10_000 });
      this.pids = readFileSync(pidFile, 'utf8').trim().split(' ').map(Number);
      return { proxy: this.proxy, cliPid: this.pids[0]!, toolPid: this.pids[1]! };
    }

    /**
     * Also when an assertion exposes a regression, or the CLI never reported its pids. Only a
     * process whose command line names this fixture's folder is killed, so a reused PID is not.
     */
    reap() {
      for (const pid of [this.proxy?.pid ?? 0, ...this.pids]) {
        if (pid > 0 && alive(pid) && this.owns(pid)) {
          spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
        }
      }
      rmSync(this.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }

    private owns(pid: number): boolean {
      const query = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8', windowsHide: true });
      return (query.stdout ?? '').includes(this.dir);
    }
  }

  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  it('control: killing only the cmd.exe proxy leaves its CLI running (Windows)', async () => {
    if (process.platform !== 'win32') return;
    const cli = new StubbornCli();
    try {
      const { proxy, cliPid } = await cli.start();
      proxy.stdin?.end();
      proxy.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(alive(cliPid)).toBe(true);
    } finally {
      cli.reap();
    }
  }, 20_000);

  it('ends the CLI a cmd.exe proxy started, and what that CLI started, while the input stays open (Windows)', async () => {
    if (process.platform !== 'win32') return;
    const cli = new StubbornCli();
    try {
      const { proxy, cliPid, toolPid } = await cli.start();
      const closed = once(proxy, 'close');
      await killWindowsProcessTree(proxy);
      await closed;
      await vi.waitFor(() => {
        expect(alive(cliPid)).toBe(false);
        expect(alive(toolPid)).toBe(false);
      }, { timeout: 5_000 });
    } finally {
      cli.reap();
    }
  }, 20_000);
});
