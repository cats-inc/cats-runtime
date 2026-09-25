import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from '../providers/types.js';
import type { ManagedCodexHost } from '../runtime/windowsCodexHost.js';

const { spawnMock, startHostMock } = vi.hoisted(() => ({ spawnMock: vi.fn(), startHostMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('../runtime/windowsCodexHost.js', () => ({
  windowsCodexHostPath: () => 'codex-code-mode-host.exe', startWindowsCodexHost: startHostMock,
}));
import { WorkerProcess } from './WorkerProcess.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('WorkerProcess with a managed Codex host', () => {
  let worker: WorkerProcess;
  let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; exitCode: null; kill: ReturnType<typeof vi.fn> };
  let pending: ReturnType<typeof deferred<ManagedCodexHost | null>>;
  let closed: ReturnType<typeof deferred<void>>;
  let host: ManagedCodexHost;
  beforeEach(() => {
    child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill: vi.fn(),
    });
    pending = deferred(); closed = deferred();
    host = { url: 'http://127.0.0.1:43210', closed: closed.promise, stop: vi.fn() };
    spawnMock.mockReturnValue(child); startHostMock.mockReturnValue(pending.promise);
    const provider: Provider = {
      name: 'codex', capabilities: { resume: true, fork: true, permissions: true },
      buildSpawnArgs: () => ['app-server'], buildStdinMessage: () => 'turn\n',
      parseStreamLine: (line) => JSON.parse(line),
    };
    worker = new WorkerProcess(provider, { cwd: process.cwd() }, {
      path: process.execPath, runner: 'direct', runtime: { mode: 'native' },
    });
    worker.on('error', () => undefined);
  });
  afterEach(() => { child.emit('close', 0); vi.clearAllMocks(); });

  it('holds the first turn until the hidden host is ready and reaps it on exit', async () => {
    worker.start();
    expect(worker.alive).toBe(true);
    const turn = worker.sendMessage('hello');
    expect(spawnMock).not.toHaveBeenCalled();
    pending.resolve(host);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    expect(spawnMock.mock.calls[0][1]).toEqual(['app-server', '--code-mode-host', host.url]);
    expect(child.stdin.read()?.toString()).toBe('turn\n');
    child.stdout.write('{"type":"result","sessionId":"test"}\n');
    await expect(turn).resolves.toMatchObject([{ type: 'result' }]);
    child.emit('close', 0);
    expect(host.stop).toHaveBeenCalledOnce();
    closed.resolve();
  });

  it('prevents a late startup from resurrecting a cancelled worker', async () => {
    worker.start(); worker.kill();
    expect(startHostMock.mock.calls[0][3].aborted).toBe(true);
    pending.resolve(host);
    await vi.waitFor(() => expect(host.stop).toHaveBeenCalledOnce());
    expect(spawnMock).not.toHaveBeenCalled();
    expect(worker.alive).toBe(false);
    await expect(worker.sendMessage('hello')).rejects.toThrow('startup cancelled');
  });

  it('retains legacy launch arguments when external hosts are unsupported', async () => {
    worker.start(); pending.resolve(null);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    expect(spawnMock.mock.calls[0][1]).toEqual(['app-server']);
  });

  it('isolates a restart from the cancelled startup finishing late', async () => {
    worker.start(); worker.cancel();
    const replacement = deferred<ManagedCodexHost | null>();
    startHostMock.mockReturnValueOnce(replacement.promise);
    const staleHost = { ...host, stop: vi.fn() };
    const exit = vi.fn(); worker.on('exit', exit);
    worker.start(); replacement.resolve(host);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    pending.resolve(staleHost);
    await vi.waitFor(() => expect(staleHost.stop).toHaveBeenCalledOnce());
    expect(host.stop).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    const turn = worker.sendMessage('hello');
    await vi.waitFor(() => expect(child.stdin.readableLength).toBeGreaterThan(0));
    child.stdout.write('{"type":"result"}\n');
    await expect(turn).resolves.toMatchObject([{ type: 'result' }]);
  });

  it('terminates the app-server if its host dies', async () => {
    const error = vi.fn(); worker.on('error', error);
    worker.start(); pending.resolve(host);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    closed.resolve();
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGTERM'));
    expect(error.mock.calls[0][0].message).toContain('host exited during the session');
  });

  it('ignores the old app-server closing while its replacement awaits a host', async () => {
    worker.start(); pending.resolve(host);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
    worker.cancel();
    const replacement = deferred<ManagedCodexHost | null>();
    startHostMock.mockReturnValueOnce(replacement.promise);
    const exit = vi.fn(); worker.on('exit', exit);
    worker.start();
    child.emit('close', 0);
    expect(exit).not.toHaveBeenCalled();
    expect(worker.alive).toBe(true);
    replacement.resolve(null);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2));
  });

  it('surfaces startup failures even before any turn has been sent', async () => {
    const exit = vi.fn(); worker.on('exit', exit);
    worker.start(); pending.reject(new Error('host failed'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1, null));
    await expect(worker.sendMessage('hello')).rejects.toThrow('host failed');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
