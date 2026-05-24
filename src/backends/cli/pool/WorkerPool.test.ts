import { describe, expect, it } from 'vitest';
import { loadConfig, resolveProviderInstance } from '../config.js';
import { WorkerPool } from './WorkerPool.js';
import { SessionRegistry } from './SessionRegistry.js';

describe('WorkerPool', () => {
  it('uses the global spawn timeout for Antigravity', () => {
    const config = loadConfig({
      HOME: '/tmp/cats-runtime-workerpool-test',
      USERPROFILE: '',
    }, {
      skipProviderFile: true,
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
      skipProviderFile: true,
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
      skipProviderFile: true,
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
