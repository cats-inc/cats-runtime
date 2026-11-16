import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCommandConfig } from '../config.js';
import type { Provider } from '../providers/types.js';

const { spawnMock, buildSpawnConfigMock } = vi.hoisted(() => ({ spawnMock: vi.fn(), buildSpawnConfigMock: vi.fn() }));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), spawn: spawnMock }));
vi.mock('../runtime/runtime.js', async (original) => ({
  ...await original<typeof import('../runtime/runtime.js')>(),
  buildProcessSpawnConfig: buildSpawnConfigMock,
}));

function child() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    pid: 1234, exitCode: null as number | null, signalCode: null, killed: false, kill: vi.fn(() => true),
  });
}

const provider: Provider = {
  name: 'claude',
  capabilities: { resume: true, fork: true, permissions: true },
  ephemeral: false,
  buildSpawnArgs: () => [],
  buildStdinMessage: () => '',
  parseStreamLine: () => null,
};

const commandConfig: ProviderCommandConfig = { path: 'claude.cmd', runner: 'auto', runtime: { mode: 'native' } };

/**
 * A `.cmd` shim runs through cmd.exe (or PowerShell) on Windows; the Runtime's process is then that
 * shell, and only a tree kill also ends the CLI it started (see windowsProcessTree.test.ts).
 */
describe('stopping a worker whose process is a Windows shell proxy', () => {
  afterEach(() => {
    spawnMock.mockReset();
    buildSpawnConfigMock.mockReset();
    vi.resetModules();
  });

  function launch(windowsShellProxy: boolean) {
    const cli = child();
    const killer = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const inputEndedAtTaskkill: boolean[] = [];
    spawnMock.mockImplementation((command: string) => {
      if (command !== 'taskkill.exe') return cli;
      inputEndedAtTaskkill.push(cli.stdin.writableEnded);
      return killer;
    });
    buildSpawnConfigMock.mockReturnValue({
      command: windowsShellProxy ? 'cmd.exe' : 'claude.exe', args: [], shell: false, cwd: process.cwd(),
      ...(windowsShellProxy ? { windowsShellProxy: true } : {}),
    });
    return { cli, killer, inputEndedAtTaskkill };
  }

  for (const windowsShellProxy of [true, false]) {
    it(windowsShellProxy
      ? 'ends the proxy with the CLI it started, before the CLI sees its input end'
      : 'keeps EOF and SIGTERM for a CLI it runs directly', async () => {
      const { cli, killer, inputEndedAtTaskkill } = launch(windowsShellProxy);
      const { WorkerProcess } = await import('./WorkerProcess.js');
      const worker = new WorkerProcess(provider, { cwd: process.cwd() }, commandConfig);
      worker.start();
      worker.cancel();
      if (windowsShellProxy) {
        expect(spawnMock).toHaveBeenCalledWith('taskkill.exe', ['/pid', '1234', '/t', '/f'], expect.objectContaining({ windowsHide: true }));
        // An EOF first could let the CLI exit and orphan what it started, out of taskkill's reach.
        expect(inputEndedAtTaskkill).toEqual([false]);
        killer.emit('exit', 0);
        expect(cli.kill).not.toHaveBeenCalled();
      } else {
        expect(spawnMock.mock.calls.map(([command]) => command)).not.toContain('taskkill.exe');
        expect(cli.stdin.writableEnded).toBe(true);
        expect(cli.kill).toHaveBeenCalledWith('SIGTERM');
      }
      cli.exitCode = 0;
      cli.emit('close', 0, null);
    });
  }

  it('ends the tree on an error path too, and writes nothing more while taskkill runs', async () => {
    const { cli } = launch(true);
    let writes = '';
    cli.stdin.on('data', (chunk) => { writes += String(chunk); });
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess({ ...provider, buildStdinMessage: () => 'begin\n' }, { cwd: process.cwd() }, commandConfig);
    worker.start();
    const turn = worker.sendMessage('hello');
    const failed = expect(turn).rejects.toThrow('Provider input stream closed during the active turn.');
    await vi.waitFor(() => expect(writes).toContain('begin'));
    cli.stdin.emit('error', new Error('EPIPE'));
    await failed;
    expect(spawnMock.mock.calls.map(([command]) => command)).toContain('taskkill.exe');
    expect(cli.kill).not.toHaveBeenCalled();
    cli.exitCode = 0;
    cli.emit('close', 0, null);
  });
});
