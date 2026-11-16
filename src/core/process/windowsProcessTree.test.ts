import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { killWindowsProcessTree, TASKKILL_TIMEOUT_MS } from './windowsProcessTree.js';

function fakeChild(overrides: Partial<{ pid: number | undefined; exitCode: number | null }> = {}) {
  return Object.assign(new EventEmitter(), {
    pid: 4321 as number | undefined, exitCode: null as number | null, signalCode: null, kill: vi.fn(() => true),
    ...overrides,
  }) as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

function fakeKiller() {
  return Object.assign(new EventEmitter(), { kill: vi.fn(() => true) }) as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

describe('killWindowsProcessTree', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ends the whole tree with taskkill and leaves the process to it when taskkill succeeds', () => {
    const child = fakeChild();
    const killer = fakeKiller();
    const run = vi.fn(() => killer);
    killWindowsProcessTree(child, run);
    expect(run).toHaveBeenCalledWith('taskkill.exe', ['/pid', '4321', '/t', '/f'],
      expect.objectContaining({ stdio: 'ignore', windowsHide: true }));
    killer.emit('exit', 0);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills the process alone when taskkill fails, cannot start or hangs', () => {
    vi.useFakeTimers();
    for (const failure of ['exit', 'error', 'throw', 'hang'] as const) {
      const child = fakeChild();
      const killer = fakeKiller();
      killWindowsProcessTree(child, () => {
        if (failure === 'throw') throw new Error('no taskkill');
        return killer;
      });
      if (failure === 'exit') killer.emit('exit', 128);
      if (failure === 'error') killer.emit('error', new Error('ENOENT'));
      if (failure === 'hang') vi.advanceTimersByTime(TASKKILL_TIMEOUT_MS);
      expect(child.kill, failure).toHaveBeenCalledOnce();
      if (failure === 'hang') expect(killer.kill).toHaveBeenCalledOnce();
    }
  });

  it('does nothing for a process that has no pid or has already exited', () => {
    const run = vi.fn();
    killWindowsProcessTree(fakeChild({ pid: undefined }), run);
    killWindowsProcessTree(fakeChild({ exitCode: 0 }), run);
    expect(run).not.toHaveBeenCalled();
  });

  /** A CLI that ignores its closed input, behind a batch shim like npm's, run through a cmd.exe proxy. */
  async function stubbornCliBehindProxy(dir: string) {
    const pidFile = join(dir, 'cli.pid');
    const script = join(dir, 'stubborn.cjs');
    writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n`
      + 'process.stdin.resume(); process.stdin.on("end", () => {}); setInterval(() => {}, 1000);\n');
    const shim = join(dir, 'stubborn.cmd');
    writeFileSync(shim, `@"${process.execPath}" "${script}" %*\r\n`);
    const proxy = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${shim}"`],
      { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true, windowsVerbatimArguments: true });
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 10_000 });
    return { proxy, cliPid: Number(readFileSync(pidFile, 'utf8')) };
  }

  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

  /** Reaps only this fixture's CLI, also when an assertion exposes a regression. */
  function reap(pid: number, dir: string) {
    if (pid > 0 && alive(pid)) spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  it('control: killing only the cmd.exe proxy leaves its CLI running (Windows)', async () => {
    if (process.platform !== 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'cats-runtime-process-tree-'));
    let cliPid = 0;
    try {
      const started = await stubbornCliBehindProxy(dir);
      cliPid = started.cliPid;
      started.proxy.stdin?.end();
      started.proxy.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(alive(cliPid)).toBe(true);
    } finally {
      reap(cliPid, dir);
    }
  }, 20_000);

  it('ends a CLI that a cmd.exe proxy started, not just the proxy (Windows)', async () => {
    if (process.platform !== 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'cats-runtime-process-tree-'));
    let cliPid = 0;
    try {
      const { proxy, cliPid: pid } = await stubbornCliBehindProxy(dir);
      cliPid = pid;
      const closed = once(proxy, 'close');
      proxy.stdin?.end();
      killWindowsProcessTree(proxy);
      await closed;
      await vi.waitFor(() => expect(alive(cliPid)).toBe(false), { timeout: 5_000 });
    } finally {
      reap(cliPid, dir);
    }
  }, 20_000);
});
