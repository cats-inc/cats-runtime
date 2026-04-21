import { describe, expect, it } from 'vitest';
import { loadConfig, resolveProviderInstance } from '../config.js';
import { WorkerPool } from './WorkerPool.js';
import { SessionRegistry } from './SessionRegistry.js';

describe('WorkerPool', () => {
  it('uses a 60000ms default spawn timeout for gemini', () => {
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

    const worker = pool.spawn('session-1', 'gemini', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    });

    expect((worker as unknown as { spawnResilience: { timeoutMs: number } }).spawnResilience)
      .toMatchObject({
        timeoutMs: 60_000,
      });
  });

  it('prefers provider-instance timeout over the global spawn timeout', () => {
    const config = loadConfig({
      HOME: '/tmp/cats-runtime-workerpool-test',
      USERPROFILE: '',
    }, {
      skipProviderFile: true,
    });
    const geminiInstance = resolveProviderInstance(config, 'gemini');
    config.providerInstances!.gemini[geminiInstance.id] = {
      ...geminiInstance,
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

    const worker = pool.spawn('session-1', 'gemini', {
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
    const geminiInstance = resolveProviderInstance(config, 'gemini');
    config.providerDefaultInstances!.gemini = 'singleton';
    config.providerInstances!.gemini = {
      singleton: {
        ...geminiInstance,
        id: 'singleton',
        commandConfig: {
          ...geminiInstance.commandConfig,
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
    const first = pool.spawn('singleton-session-1', 'gemini', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    }, 'singleton');
    expect(first.alive).toBe(true);

    expect(() => pool.spawn('singleton-session-2', 'gemini', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    }, 'singleton')).toThrow(
      "Provider singleton resource 'test:shared-browser' is already attached "
      + "to active Cats session 'singleton-session-1'",
    );

    pool.kill('singleton-session-1');
    expect(() => pool.spawn('singleton-session-2', 'gemini', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    }, 'singleton')).not.toThrow();
  });
});
