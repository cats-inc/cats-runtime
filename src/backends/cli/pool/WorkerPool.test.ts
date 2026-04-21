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

  it('rejects a second active native Claude Chrome worker', () => {
    const config = loadConfig({
      HOME: '/tmp/cats-runtime-workerpool-test',
      USERPROFILE: '',
    }, {
      skipProviderFile: true,
    });
    const claudeInstance = resolveProviderInstance(config, 'claude');
    config.providerDefaultInstances!.claude = 'native-chrome';
    config.providerInstances!.claude = {
      'native-chrome': {
        ...claudeInstance,
        id: 'native-chrome',
        commandConfig: {
          ...claudeInstance.commandConfig,
          args: ['--chrome'],
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
    const internals = pool as unknown as {
      workers: Map<string, { alive: boolean }>;
      workerSingletonResources: Map<string, string>;
    };
    internals.workers.set('chrome-session-1', { alive: true });
    internals.workerSingletonResources.set('chrome-session-1', 'claude:chrome');

    expect(() => pool.spawn('chrome-session-2', 'claude', {
      cwd: '/tmp/cats-runtime-workerpool-test',
    }, 'native-chrome')).toThrow(
      "Claude Chrome integration is already attached to an active Cats session 'chrome-session-1'",
    );
  });
});
