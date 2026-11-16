import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCommandConfig } from '../config.js';
import type { Provider, ProviderTurnOptions } from '../providers/types.js';
import { WorkerProcess } from './WorkerProcess.js';

const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const commandConfig: ProviderCommandConfig = { path: 'kimi', runner: 'auto', runtime: { mode: 'native' } };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function turnProcess() {
  return Object.assign(new EventEmitter(), {
    pid: 4321, exitCode: null, signalCode: null, kill: vi.fn(() => true),
  }) as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

/** Like Kimi Code and Junie: the provider starts a process of its own for each turn. */
function perTurnProvider(run: (opts: ProviderTurnOptions) => Promise<void>): Provider {
  return {
    name: 'kimi',
    capabilities: { resume: true, fork: false, permissions: false },
    ephemeral: true,
    buildSpawnArgs: () => [],
    buildStdinMessage: () => '',
    parseStreamLine: () => null,
    async *streamTurn(_turn, opts) {
      await run(opts);
      yield { type: 'result', sessionId: 'kimi-session' };
    },
  };
}

/**
 * On Windows the worker's working folder stays in use until that process has exited, so the worker
 * counts as running, and a close waits, until then. Elsewhere than Windows here: the stop is SIGTERM.
 */
describe('a process a streamTurn provider starts for its turn', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', platformDescriptor);
  });

  /** As Node reports a process that has gone: exited, then closed. */
  function closes(child: ReturnType<typeof turnProcess>) {
    Object.assign(child, { signalCode: 'SIGTERM' });
    child.emit('close', null, 'SIGTERM');
  }

  it('keeps the worker running until it has closed, and is stopped with the worker', async () => {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
    const child = turnProcess();
    const tracked = deferred();
    const worker = new WorkerProcess(perTurnProvider(async (opts) => {
      opts.trackProcess?.(child);
      tracked.resolve();
      // This provider never stops the process itself: the worker has to.
      await new Promise<void>((done) => opts.signal?.addEventListener('abort', () => done(), { once: true }));
    }), { cwd: process.cwd() }, commandConfig);
    const stopped = vi.fn();
    worker.on('process-stopped', stopped);

    const turn = worker.sendMessage('go');
    await tracked.promise;
    expect(worker.processRunning).toBe(true);
    worker.kill();
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    await turn;
    expect(worker.alive).toBe(false);
    expect(worker.processRunning).toBe(true);
    expect(stopped).not.toHaveBeenCalled();

    closes(child);
    expect(worker.processRunning).toBe(false);
    expect(stopped).toHaveBeenCalledOnce();
  });

  it('stops at once a process the provider starts after the turn was stopped', async () => {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
    const child = turnProcess();
    const prepared = deferred();
    const worker = new WorkerProcess(perTurnProvider(async (opts) => {
      await prepared.promise;
      opts.trackProcess?.(child);
    }), { cwd: process.cwd() }, commandConfig);

    const turn = worker.sendMessage('go');
    await vi.waitFor(() => expect(worker.busy).toBe(true));
    worker.cancel();
    prepared.resolve();
    await turn;
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    expect(worker.processRunning).toBe(true);
    closes(child);
    expect(worker.processRunning).toBe(false);
  });

  it('kills a turn process outright when it ignores the stop for 5 s', async () => {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
    vi.useFakeTimers();
    const child = turnProcess();
    const tracked = deferred();
    const worker = new WorkerProcess(perTurnProvider(async (opts) => {
      opts.trackProcess?.(child);
      tracked.resolve();
      await new Promise<void>((done) => opts.signal?.addEventListener('abort', () => done(), { once: true }));
    }), { cwd: process.cwd() }, commandConfig);

    const turn = worker.sendMessage('go');
    await tracked.promise;
    worker.kill();
    worker.cancel();
    await turn;
    vi.advanceTimersByTime(4999);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    vi.advanceTimersByTime(1);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    closes(child);
    expect(worker.processRunning).toBe(false);
  });
});
