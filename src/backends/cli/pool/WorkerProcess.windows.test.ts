import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCommandConfig } from '../config.js';
import type { Provider, ProviderServerRequestContext, StreamEvent } from '../providers/types.js';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

function createMockChildProcess() {
  const process = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: () => void;
    exitCode: number | null;
  };
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.stdin = new PassThrough();
  process.kill = () => undefined;
  process.exitCode = null;
  return process;
}

function createProvider(): Provider {
  return {
    name: 'codex',
    capabilities: { resume: true, fork: true, permissions: true },
    ephemeral: false,
    buildSpawnArgs() {
      return ['exec'];
    },
    buildStdinMessage() {
      return '';
    },
    parseStreamLine() {
      return null;
    },
  };
}

function createCommandConfig(): ProviderCommandConfig {
  return {
    path: 'codex',
    runner: 'direct',
    runtime: { mode: 'native' },
  };
}

describe('WorkerProcess Windows spawn options', () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.resetModules();
  });

  it('hides provider child windows when spawning background workers', async () => {
    spawnMock.mockReturnValue(createMockChildProcess());

    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess(
      createProvider(),
      { cwd: process.cwd() },
      createCommandConfig(),
    );

    worker.start();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({
      windowsHide: true,
    });
  });

  it('prepends command-config launch args to provider spawn args', async () => {
    spawnMock.mockReturnValue(createMockChildProcess());

    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess(
      createProvider(),
      { cwd: process.cwd() },
      {
        ...createCommandConfig(),
        args: ['--chrome'],
      },
    );

    worker.start();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(['--chrome', 'exec']);
  });

  it('lets the actual Codex adapter place configured overrides after its native subcommand', async () => {
    spawnMock.mockReturnValue(createMockChildProcess());
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const { CodexProvider } = await import('../providers/codex.js');
    const worker = new WorkerProcess(new CodexProvider(),
      { cwd: process.cwd(), model: 'selected-model' },
      { ...createCommandConfig(), args: ['-c', 'features.apps=false', '-c', 'model="default-model"'] });
    worker.start();
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(['app-server',
      '-c', 'features.apps=false', '-c', 'model="default-model"', '-c', 'model="selected-model"']);
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ windowsHide: true });
  });
});

describe('WorkerProcess asynchronous provider replies', () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.resetModules();
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
  }

  function asyncProvider(handler: NonNullable<Provider['buildServerResponse']>): Provider {
    return { ...createProvider(), buildStdinMessage: () => 'begin\n',
      parseStreamLine: (line) => {
        const event = JSON.parse(line) as StreamEvent;
        return event.type === 'result' ? event : null;
      }, buildServerResponse: handler };
  }

  function emitRequest(child: ReturnType<typeof createMockChildProcess>) {
    child.stdout.write(JSON.stringify({ type: 'request' }) + '\n');
  }

  function finish(child: ReturnType<typeof createMockChildProcess>) {
    child.stdout.write(JSON.stringify({ type: 'result' }) + '\n');
  }

  it('delivers an asynchronous response to the current native child and turn', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);
    let writes = '';
    child.stdin.on('data', (chunk) => { writes += String(chunk); });
    const started = deferred<ProviderServerRequestContext>();
    const response = deferred<string | null>();
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess(asyncProvider(async (line, context) => {
      if (JSON.parse(line).type !== 'request') return null;
      started.resolve(context);
      return response.promise;
    }), { cwd: process.cwd() }, createCommandConfig());
    worker.start();
    const turn = worker.sendMessage('inspect');
    await vi.waitFor(() => expect(writes).toContain('begin'));
    emitRequest(child);
    expect((await started.promise).signal.aborted).toBe(false);
    response.resolve('read-result\n');
    await vi.waitFor(() => expect(writes).toContain('read-result'));
    finish(child);
    await turn;
    expect((await started.promise).signal.aborted).toBe(true);
  });

  it('aborts pending response work on cancellation and suppresses writes to the closed child', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);
    let writes = '';
    child.stdin.on('data', (chunk) => { writes += String(chunk); });
    const started = deferred<ProviderServerRequestContext>();
    const response = deferred<string | null>();
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess(asyncProvider(async (line, context) => {
      if (JSON.parse(line).type !== 'request') return null;
      started.resolve(context);
      return response.promise;
    }), { cwd: process.cwd() }, createCommandConfig());
    worker.start();
    const turn = worker.sendMessage('inspect').catch(() => []);
    await vi.waitFor(() => expect(writes).toContain('begin'));
    emitRequest(child);
    const context = await started.promise;
    worker.cancel();
    expect(context.signal.aborted).toBe(true);
    child.exitCode = 0;
    child.emit('close', 0, null);
    await turn;
    response.resolve('stale-read-result\n');
    await new Promise<void>((done) => setImmediate(done));
    expect(writes).not.toContain('stale-read-result');
    expect(worker.alive).toBe(false);
  });

  it('never sends a prior turn reply into the next turn on the same child', async () => {
    const child = createMockChildProcess();
    spawnMock.mockReturnValue(child);
    let writes = '';
    child.stdin.on('data', (chunk) => { writes += String(chunk); });
    const started = deferred<ProviderServerRequestContext>();
    const response = deferred<string | null>();
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess(asyncProvider(async (line, context) => {
      if (JSON.parse(line).type !== 'request') return null;
      started.resolve(context);
      return response.promise;
    }), { cwd: process.cwd() }, createCommandConfig());
    worker.start();
    const first = worker.sendMessage('first');
    await vi.waitFor(() => expect(writes).toContain('begin'));
    emitRequest(child);
    await started.promise;
    finish(child);
    await first;
    const next = worker.sendMessage('next');
    await vi.waitFor(() => expect(writes.match(/begin/g)).toHaveLength(2));
    response.resolve('prior-turn-read\n');
    await new Promise<void>((done) => setImmediate(done));
    expect(writes).not.toContain('prior-turn-read');
    finish(child);
    await next;
  });

  it('ignores old child replies and close events after process replacement', async () => {
    const firstChild = createMockChildProcess();
    const nextChild = createMockChildProcess();
    spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(nextChild);
    let firstWrites = '';
    let nextWrites = '';
    firstChild.stdin.on('data', (chunk) => { firstWrites += String(chunk); });
    nextChild.stdin.on('data', (chunk) => { nextWrites += String(chunk); });
    const started = deferred<void>();
    const response = deferred<string | null>();
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess(asyncProvider(async (line) => {
      if (JSON.parse(line).type !== 'request') return null;
      started.resolve();
      return response.promise;
    }), { cwd: process.cwd() }, createCommandConfig());
    worker.start();
    const first = worker.sendMessage('first');
    await vi.waitFor(() => expect(firstWrites).toContain('begin'));
    emitRequest(firstChild);
    await started.promise;
    finish(firstChild);
    await first;
    worker.start();
    const next = worker.sendMessage('next');
    await vi.waitFor(() => expect(nextWrites).toContain('begin'));
    firstChild.exitCode = 0;
    firstChild.emit('close', 0, null);
    firstChild.stdin.emit('error', new Error('late EPIPE'));
    response.resolve('old-child-read\n');
    await new Promise<void>((done) => setImmediate(done));
    expect(firstWrites).not.toContain('old-child-read');
    expect(nextWrites).not.toContain('old-child-read');
    expect(worker.alive).toBe(true);
    expect(worker.busy).toBe(true);
    finish(nextChild);
    await next;
  });

  it('fails the turn on an unexpected asynchronous response failure without unhandled rejection', async () => {
    const child = createMockChildProcess();
    child.kill = vi.fn();
    spawnMock.mockReturnValue(child);
    let writes = '';
    child.stdin.on('data', (chunk) => { writes += String(chunk); });
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess(asyncProvider(async (line) => {
      if (JSON.parse(line).type === 'request') throw new Error('private failure details');
      return null;
    }), { cwd: process.cwd() }, createCommandConfig());
    worker.start();
    const turn = worker.sendMessage('inspect');
    const failed = expect(turn).rejects.toThrow('Provider server-request response failed.');
    await vi.waitFor(() => expect(writes).toContain('begin'));
    emitRequest(child);
    await failed;
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(writes).not.toContain('private failure details');
  });

  it('handles a closed input pipe during an active asynchronous reply without an unhandled stream error', async () => {
    const child = createMockChildProcess();
    child.kill = vi.fn();
    spawnMock.mockReturnValue(child);
    let writes = '';
    child.stdin.on('data', (chunk) => { writes += String(chunk); });
    const started = deferred<ProviderServerRequestContext>();
    const response = deferred<string | null>();
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const worker = new WorkerProcess(asyncProvider(async (line, context) => {
      if (JSON.parse(line).type !== 'request') return null;
      started.resolve(context);
      return response.promise;
    }), { cwd: process.cwd() }, createCommandConfig());
    worker.start();
    const turn = worker.sendMessage('inspect');
    const failed = expect(turn).rejects.toThrow('Provider input stream closed during the active turn.');
    await vi.waitFor(() => expect(writes).toContain('begin'));
    emitRequest(child);
    const context = await started.promise;
    child.stdin.emit('error', new Error('EPIPE'));
    await failed;
    expect(context.signal.aborted).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    response.resolve('late-pipe-reply\n');
    await new Promise<void>((done) => setImmediate(done));
    expect(writes).not.toContain('late-pipe-reply');
  });

  it.each(['wsl', 'docker'] as const)('refuses granted host reads for %s before spawning', async (mode) => {
    const { WorkerProcess } = await import('./WorkerProcess.js');
    const { CodexProvider } = await import('../providers/codex.js');
    const worker = new WorkerProcess(new CodexProvider(),
      { cwd: process.cwd(), allowedTools: ['read_file'] },
      { ...createCommandConfig(), runtime: { mode } });
    expect(() => worker.start()).toThrow('verified native local workspace');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
