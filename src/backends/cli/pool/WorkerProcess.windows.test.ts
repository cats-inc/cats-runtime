import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCommandConfig } from '../config.js';
import type { Provider } from '../providers/types.js';

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
});
