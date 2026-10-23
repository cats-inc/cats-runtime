import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock, startHostMock } = vi.hoisted(() => ({ spawnMock: vi.fn(), startHostMock: vi.fn() }));
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: spawnMock }));
vi.mock('../runtime/windowsCodexHost.js', () => ({ windowsCodexHostPath: () => 'fixture-host.exe', startWindowsCodexHost: startHostMock }));
import { loadConfig, resolveProviderInstance } from '../config.js';
import { SessionRegistry } from './SessionRegistry.js';
import { PoolSourceStopError, WorkerPool } from './WorkerPool.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function fixture() {
  const cwd = path.join(tmpdir(), 'cats-handoff-owned-lifetime');
  const config = loadConfig({ HOME: cwd, USERPROFILE: '' }, {
    providerYaml: 'providers: { codex: { instances: { native: {} } }, grok: { instances: { native: {} } } }',
  });
  const sourceInstance = resolveProviderInstance(config, 'codex', 'native');
  const imageInstance = resolveProviderInstance(config, 'grok', 'native');
  sourceInstance.commandConfig.singleton = imageInstance.commandConfig.singleton = 'test:handoff-resource';
  config.maxSessions = 1;
  const registry = new SessionRegistry(undefined, undefined, config.providerDefaultInstances, config.providerDefaultTargets);
  const pool = new WorkerPool(config, registry, {} as never, {} as never, {} as never, {} as never,
    { getCachedAssessment: () => undefined } as never);
  const helper = deferred<void>();
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(),
    stderr: new PassThrough(), exitCode: null, kill: vi.fn() });
  spawnMock.mockReturnValue(child);
  startHostMock.mockResolvedValue({ url: 'http://127.0.0.1:43210', closed: helper.promise, stop: vi.fn() });
  const captured = pool.spawn('source-chat', 'codex', { cwd }, sourceInstance.id);
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());
  return { pool, captured, child, helper, imageInstance };
}

afterEach(() => { vi.clearAllMocks(); });
describe('image handoff owns the complete source process lifetime', () => {
  it('blocks fresh and captured turns, waits for the helper and reserves the replacement slot', async () => {
    const { pool, captured, child, helper, imageInstance } = await fixture();
    const write = vi.spyOn(child.stdin, 'write'); let admitted = false;
    const handoff = pool.reserveExternalExecutionFromSession('image-one', 'grok', imageInstance.id, () => {}, 'source-chat')
      .then(release => { admitted = true; return release; });
    expect(pool.get('source-chat')).toBeUndefined(); expect(pool.isAttached('source-chat')).toBe(false);
    await expect(captured.sendMessage('late owner turn')).rejects.toThrow(/busy/); expect(write).not.toHaveBeenCalled();
    child.emit('close', 0);
    await Promise.resolve(); expect(admitted).toBe(false); expect(pool.activeCount).toBe(1);
    expect(() => pool.reserveExternalExecution('unrelated', 'grok', imageInstance.id, () => {})).toThrow(/Max sessions/);
    helper.resolve(); const release = await handoff;
    expect(admitted).toBe(true); expect(pool.activeCount).toBe(1); release(); expect(pool.activeCount).toBe(0);
  });

  it('keeps claims after aborted shutdown until the helper actually closes', async () => {
    const { pool, child, helper, imageInstance } = await fixture(); const abort = new AbortController();
    const handoff = pool.reserveExternalExecutionFromSession('image-one', 'grok', imageInstance.id, () => {}, 'source-chat', abort.signal);
    abort.abort(); await expect(handoff).rejects.toBeInstanceOf(PoolSourceStopError);
    child.emit('close', 0); await Promise.resolve(); expect(pool.activeCount).toBe(1);
    expect(() => pool.reserveExternalExecution('unrelated', 'grok', imageInstance.id, () => {})).toThrow(/Max sessions/);
    helper.resolve(); await vi.waitFor(() => expect(pool.activeCount).toBe(0));
    pool.reserveExternalExecution('next-explicit-image', 'grok', imageInstance.id, () => {})();
  });
});
