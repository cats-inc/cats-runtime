import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, resolveProviderInstance } from '../config.js';
import { PoolCapacityError, PoolSourceBusyError, WorkerPool } from './WorkerPool.js';
import { SessionRegistry } from './SessionRegistry.js';

describe('WorkerPool', () => {
  it('shares admission, singleton ownership and shutdown with bounded external executions', () => {
    const config = loadConfig({ HOME: '/tmp/cats-runtime-workerpool-test', USERPROFILE: '' }, {
      providerYaml: 'providers: { grok: { instances: { native: {} } } }',
    });
    const instance = resolveProviderInstance(config, 'grok');
    instance.commandConfig.singleton = 'test:grok-image';
    config.maxSessions = 2;
    const registry = new SessionRegistry(undefined, undefined, config.providerDefaultInstances, config.providerDefaultTargets);
    const pool = new WorkerPool(config, registry, {} as never, {} as never,
      {} as never, {} as never, { getCachedAssessment: () => undefined } as never);
    let cancelled = 0;
    const release = pool.reserveExternalExecution('image-1', 'grok', instance.id, () => { cancelled++; });
    expect(pool.activeCount).toBe(1);
    expect(() => pool.reserveExternalExecution('image-2', 'grok', instance.id, () => {})).toThrow(/singleton/);
    config.maxSessions = 1;
    expect(() => pool.spawn('chat-1', 'grok', { cwd: '/tmp/cats-runtime-workerpool-test' }, instance.id)).toThrow(/Max sessions/);
    // A full pool is a capacity error, which callers report differently from a held singleton.
    expect(() => pool.reserveExternalExecution('image-3', 'grok', instance.id, () => {})).toThrow(PoolCapacityError);
    pool.killAll(); expect(cancelled).toBe(1);
    expect(pool.activeCount).toBe(1); // Killing is not evidence of process exit.
    release(); release(); expect(pool.activeCount).toBe(0);
    pool.reserveExternalExecution('image-2', 'grok', instance.id, () => {})();
  });
  it('uses the global spawn timeout for Antigravity', () => {
    const config = loadConfig({
      HOME: '/tmp/cats-runtime-workerpool-test',
      USERPROFILE: '',
    }, {
      providerYaml: 'providers: { antigravity: { instances: { native: {} } } }',
    });

    const registry = new SessionRegistry(
      undefined,
      undefined,
      config.providerDefaultInstances,
      config.providerDefaultTargets,
    );
    const pool = new WorkerPool(
      config,
      registry,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getCachedAssessment: () => undefined } as never,
    );

    const worker = pool.spawn('session-1', 'antigravity', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    });

    expect((worker as unknown as { spawnResilience: { timeoutMs: number } }).spawnResilience)
      .toMatchObject({
        timeoutMs: 30_000,
      });
  });

  it('prefers provider-instance timeout over the global spawn timeout', () => {
    const config = loadConfig({
      HOME: '/tmp/cats-runtime-workerpool-test',
      USERPROFILE: '',
    }, {
      providerYaml: 'providers: { antigravity: { instances: { native: {} } } }',
    });
    const antigravityInstance = resolveProviderInstance(config, 'antigravity');
    config.providerInstances!.antigravity[antigravityInstance.id] = {
      ...antigravityInstance,
      timeoutMs: 45_000,
    };

    const registry = new SessionRegistry(
      undefined,
      undefined,
      config.providerDefaultInstances,
      config.providerDefaultTargets,
    );
    const pool = new WorkerPool(
      config,
      registry,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getCachedAssessment: () => undefined } as never,
    );

    const worker = pool.spawn('session-1', 'antigravity', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    });

    expect((worker as unknown as { spawnResilience: { timeoutMs: number } }).spawnResilience)
      .toMatchObject({
        timeoutMs: 45_000,
      });
  });

  it('rejects a second active worker for the same configured singleton resource', () => {
    const config = loadConfig({
      HOME: '/tmp/cats-runtime-workerpool-test',
      USERPROFILE: '',
    }, {
      providerYaml: 'providers: { antigravity: { instances: { native: {} } } }',
    });
    const antigravityInstance = resolveProviderInstance(config, 'antigravity');
    config.providerDefaultInstances!.antigravity = 'singleton';
    config.providerInstances!.antigravity = {
      singleton: {
        ...antigravityInstance,
        id: 'singleton',
        commandConfig: {
          ...antigravityInstance.commandConfig,
          singleton: 'test:shared-browser',
        },
      },
    };

    const registry = new SessionRegistry(
      undefined,
      undefined,
      config.providerDefaultInstances,
      config.providerDefaultTargets,
    );
    const pool = new WorkerPool(
      config,
      registry,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getCachedAssessment: () => undefined } as never,
    );
    const first = pool.spawn('singleton-session-1', 'antigravity', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    }, 'singleton');
    expect(first.alive).toBe(true);

    expect(() => pool.spawn('singleton-session-2', 'antigravity', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    }, 'singleton')).toThrow(
      "Provider singleton resource 'test:shared-browser' is already attached "
      + "to active Cats session 'singleton-session-1'",
    );

    pool.kill('singleton-session-1');
    expect(() => pool.spawn('singleton-session-2', 'antigravity', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    }, 'singleton')).not.toThrow();
  });
});


describe('originating-session image resource handoff', () => {
  function fixture() {
    const cwd = path.join(tmpdir(), 'cats-idle-image-handoff');
    const config = loadConfig({ HOME: cwd, USERPROFILE: '' }, {
      providerYaml: 'providers: { grok: { instances: { native: {}, other: {} } } }',
    });
    const instance = resolveProviderInstance(config, 'grok', 'native');
    const other = resolveProviderInstance(config, 'grok', 'other');
    instance.commandConfig.singleton = 'test:image-target'; other.commandConfig.singleton = 'test:other-source';
    config.maxSessions = 2;
    const registry = new SessionRegistry(undefined, undefined, config.providerDefaultInstances, config.providerDefaultTargets);
    const pool = new WorkerPool(config, registry, {} as never, {} as never, {} as never, {} as never,
      { getCachedAssessment: () => undefined } as never);
    return { cwd, config, instance, other, pool };
  }

  it('yields only the originating idle worker and reuses its capacity and singleton', async () => {
    const { cwd, config, instance, pool } = fixture(); config.maxSessions = 1;
    const source = pool.spawn('source-chat', 'grok', { cwd }, instance.id);
    expect(source.processRunning).toBe(false);
    const release = await pool.reserveExternalExecutionFromSession('image-one', 'grok', instance.id, () => {}, 'source-chat');
    expect(source.alive).toBe(false); expect(pool.get('source-chat')).toBeUndefined();
    expect(pool.activeCount).toBe(1);
    expect(() => pool.spawn('other-chat', 'grok', { cwd }, instance.id)).toThrow(/Max sessions/);
    release(); release(); expect(pool.activeCount).toBe(0);
    const resumed = pool.spawn('source-chat', 'grok', { cwd }, instance.id);
    expect(resumed.alive).toBe(true); pool.killAll();
  });

  it('refuses a busy originating worker without stopping it', async () => {
    const { cwd, instance, pool } = fixture();
    const source = pool.spawn('source-chat', 'grok', { cwd }, instance.id);
    // A pure worker-state fixture: no provider process is launched.
    (source as unknown as { isBusy: boolean }).isBusy = true;
    await expect(pool.reserveExternalExecutionFromSession('image-one', 'grok', instance.id, () => {}, 'source-chat'))
      .rejects.toBeInstanceOf(PoolSourceBusyError);
    expect(source.alive).toBe(true); expect(pool.activeCount).toBe(1);
    (source as unknown as { isBusy: boolean }).isBusy = false; pool.killAll();
  });

  it('does not evict an unrelated singleton holder when the pool is full', async () => {
    const { cwd, instance, other, pool } = fixture();
    const unrelated = pool.spawn('unrelated-chat', 'grok', { cwd }, instance.id);
    const source = pool.spawn('source-chat', 'grok', { cwd }, other.id);
    await expect(pool.reserveExternalExecutionFromSession('image-one', 'grok', instance.id, () => {}, 'source-chat'))
      .rejects.toThrow(/singleton/);
    expect(unrelated.alive).toBe(true); expect(source.alive).toBe(true); expect(pool.activeCount).toBe(2);
    pool.killAll();
  });
});
