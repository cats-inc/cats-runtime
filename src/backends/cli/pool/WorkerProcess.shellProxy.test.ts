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

  for (const windowsShellProxy of [true, false]) {
    it(windowsShellProxy ? 'ends the proxy with the CLI it started' : 'keeps SIGTERM for a CLI it runs directly', async () => {
      const cli = child();
      const killer = Object.assign(new EventEmitter(), { kill: vi.fn() });
      spawnMock.mockImplementation((command: string) => (command === 'taskkill.exe' ? killer : cli));
      buildSpawnConfigMock.mockReturnValue({
        command: windowsShellProxy ? 'cmd.exe' : 'claude.exe', args: [], shell: false, cwd: process.cwd(),
        ...(windowsShellProxy ? { windowsShellProxy: true } : {}),
      });
      const { WorkerProcess } = await import('./WorkerProcess.js');
      const worker = new WorkerProcess(provider, { cwd: process.cwd() }, commandConfig);
      worker.start();
      worker.cancel();
      if (windowsShellProxy) {
        expect(spawnMock).toHaveBeenCalledWith('taskkill.exe', ['/pid', '1234', '/t', '/f'], expect.objectContaining({ windowsHide: true }));
        killer.emit('exit', 0);
        expect(cli.kill).not.toHaveBeenCalled();
      } else {
        expect(spawnMock.mock.calls.map(([command]) => command)).not.toContain('taskkill.exe');
        expect(cli.kill).toHaveBeenCalledWith('SIGTERM');
      }
      cli.exitCode = 0;
      cli.emit('close', 0, null);
    });
  }
});
