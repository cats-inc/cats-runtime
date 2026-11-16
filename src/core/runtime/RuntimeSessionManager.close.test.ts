import { describe, expect, it, vi } from 'vitest';
import { RuntimeSessionManager } from './RuntimeSessionManager.js';
import type { SessionInfo } from '../types.js';

/**
 * A CLI session's close resolves only after its worker process has stopped:
 * on Windows the process holds its working folder until then, and a delete
 * right after the close removes that folder when it is a sandbox.
 */
describe('closing a CLI session', () => {
  function runtimeWithPool(kill: (sessionId: string) => unknown) {
    return new RuntimeSessionManager(
      {
        sessionBaseDir: '/tmp/cats-runtime-close',
        providerInstances: {},
        providerDefaultTargets: {},
        remoteProviderCatalog: { api: {}, local: {}, agent: {} },
      } as never,
      {
        get: vi.fn(),
        spawn: vi.fn(),
        kill: vi.fn(kill),
        killAll: vi.fn(),
        getCapabilities: vi.fn(() => ({ resume: true, fork: true, permissions: true })),
        status: vi.fn(() => ({ active: 0, busy: 0, idle: 0, providers: {} })),
      } as never,
    );
  }

  const session = {
    id: 'session-1',
    providerName: 'claude',
    providerBackend: 'cli',
    status: 'ready',
    cwd: '/tmp/cats-runtime-close/session-1',
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  } as SessionInfo;

  for (const reason of ['close', 'delete'] as const) {
    it(`waits for the worker process to stop on ${reason}`, async () => {
      let stop: (stopped: boolean) => void = () => {};
      const runtime = runtimeWithPool(() => new Promise<boolean>((resolve) => { stop = resolve; }));
      let closed = false;
      const closing = runtime.close(session, reason).then(() => { closed = true; });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(closed).toBe(false);
      stop(true);
      await closing;
      expect(closed).toBe(true);
    });
  }

  it('still closes when the process outlives the bound', async () => {
    const runtime = runtimeWithPool(() => Promise.resolve(false));
    await expect(runtime.close(session, 'delete')).resolves.toBeUndefined();
  });
});
