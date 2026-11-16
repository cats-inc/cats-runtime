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

const commandConfig: ProviderCommandConfig = { path: 'claude.exe', runner: 'auto', runtime: { mode: 'native' } };

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
function onPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
}

/**
 * Windows does not end a process's children with it. Whether the Runtime's process is a shell
 * proxy (cmd.exe running a `.cmd` shim) or a CLI it runs directly, only a tree kill also ends the
 * CLI behind the proxy and the tools the CLI started (see processTree.test.ts).
 */
describe('stopping a worker process', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', platformDescriptor);
    spawnMock.mockReset();
    buildSpawnConfigMock.mockReset();
    vi.resetModules();
  });

  function launch(command: string) {
    const cli = child();
    const killer = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const inputEndedAtTaskkill: boolean[] = [];
    spawnMock.mockImplementation((file: string) => {
      if (file !== 'taskkill.exe') return cli;
      inputEndedAtTaskkill.push(cli.stdin.writableEnded);
      return killer;
    });
    buildSpawnConfigMock.mockReturnValue({ command, args: [], shell: false, cwd: process.cwd() });
    return { cli, killer, inputEndedAtTaskkill };
  }

  for (const command of ['cmd.exe', 'claude.exe']) {
    it(`on Windows, ends ${command} with every process under it, before it sees its input end`, async () => {
      onPlatform('win32');
      const { cli, killer, inputEndedAtTaskkill } = launch(command);
      const { WorkerProcess } = await import('./WorkerProcess.js');
      const worker = new WorkerProcess(provider, { cwd: process.cwd() }, commandConfig);
      worker.start();
      worker.cancel();
      expect(spawnMock).toHaveBeenCalledWith('taskkill.exe', ['/pid', '1234', '/t', '/f'], expect.objectContaining({ windowsHide: true }));
      // An EOF first could let the CLI exit and orphan what it started, out of taskkill's reach.
      expect(inputEndedAtTaskkill).toEqual([false]);
      killer.emit('exit', 0);
      expect(cli.kill).not.toHaveBeenCalled();
      cli.exitCode = 0;
      cli.emit('close', 0, null);
    });
  }

  it('elsewhere, sends EOF and then SIGTERM to the CLI alone', async () => {
    onPlatform('linux');
    const { cli } = launch('claude');
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess(provider, { cwd: process.cwd() }, commandConfig);
    worker.start();
    worker.cancel();
    expect(spawnMock.mock.calls.map(([file]) => file)).not.toContain('taskkill.exe');
    expect(cli.stdin.writableEnded).toBe(true);
    expect(cli.kill).toHaveBeenCalledWith('SIGTERM');
    cli.exitCode = 0;
    cli.emit('close', 0, null);
  });

  it('on Windows, ends the tree on an error path too, and neither writes to nor hears from the CLI while taskkill runs', async () => {
    onPlatform('win32');
    const { cli } = launch('claude.exe');
    let writes = '';
    cli.stdin.on('data', (chunk) => { writes += String(chunk); });
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess({
      ...provider,
      buildStdinMessage: () => 'begin\n',
      // Any line asks for an automatic answer, and is also an event of its own.
      buildAutoResponse: () => 'auto-answer\n',
      parseStreamLine: (line) => ({ type: 'text', text: line }),
      // Any stderr line is a refusal that fails the launch at once.
      classifyLaunchFailure: () => ({ category: 'capacity_exhausted', message: 'No capacity.', retryable: true, source: 'stderr' }),
    }, { cwd: process.cwd() }, commandConfig);
    const events: unknown[] = [];
    worker.on('event', (event) => { events.push(event); });
    worker.start();
    const turn = worker.sendMessage('hello');
    const failed = expect(turn).rejects.toThrow('Provider input stream closed during the active turn.');
    await vi.waitFor(() => expect(writes).toContain('begin'));
    cli.stdin.emit('error', new Error('EPIPE'));
    await failed;
    expect(spawnMock.mock.calls.map(([command]) => command)).toContain('taskkill.exe');
    expect(cli.kill).not.toHaveBeenCalled();
    // The CLI is still alive until taskkill has run: what it says now goes nowhere. A refusal on
    // stderr would otherwise be reported once more, after the turn and its listener are gone.
    const errors: unknown[] = [];
    worker.on('error', (error) => { errors.push(error); });
    cli.stdout.write('still talking\n');
    cli.stderr.write('429 Too Many Requests\n');
    await new Promise<void>((done) => setImmediate(done));
    expect(writes).not.toContain('auto-answer');
    expect(events).toEqual([]);
    expect(errors).toEqual([]);
    cli.exitCode = 0;
    cli.emit('close', 0, null);
  });
});
