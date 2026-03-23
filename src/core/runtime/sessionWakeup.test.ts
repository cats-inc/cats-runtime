import { describe, expect, it, vi } from 'vitest';
import type {
  ExecutionHandle,
  SessionInfo,
  SessionSkillState,
} from '../types.js';
import { ensureSessionAwake } from './sessionWakeup.js';
import { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-1',
    providerName: 'claude',
    providerBackend: 'cli',
    providerInstanceId: 'default',
    providerSessionId: 'provider-session-1',
    status: 'closed',
    origin: 'runtime',
    cwd: '/repo',
    workspaceMode: 'shared',
    permissionMode: 'default',
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
    ...overrides,
  };
}

function makeRuntime(overrides?: {
  attached?: boolean;
  handle?: ExecutionHandle | undefined;
}) {
  return {
    get: vi.fn(() => overrides?.handle),
    isAttached: vi.fn(() => overrides?.attached ?? false),
    spawn: vi.fn(),
  };
}

function createAsyncGenerator(): AsyncGenerator<never> {
  return (async function* empty() {})();
}

function createActiveHandle(): ExecutionHandle {
  return {
    active: true,
    busy: false,
    streamMessage: () => createAsyncGenerator(),
    kill: vi.fn(),
    on: vi.fn(function on() {
      return this;
    }),
    off: vi.fn(function off() {
      return this;
    }),
  };
}

function makeConfig() {
  return {
    externalSessionLiveWindowMs: 60_000,
    piSessionsDir: '/home/tester/.pi/agent/sessions',
    providerCommands: {
      pi: {
        path: 'pi',
        runner: 'auto',
        runtime: { mode: 'native' as const },
      },
    },
    providerDefaultInstances: {
      pi: 'default',
    },
    providerInstances: {
      pi: {
        default: {
          id: 'default',
          providerName: 'pi',
          commandConfig: {
            path: 'pi',
            runner: 'auto',
            runtime: { mode: 'native' as const },
          },
          piSessionsDir: '/home/tester/.pi/agent/sessions',
        },
      },
    },
  } as const;
}

function makeInstructionSkillState(instructionsFile: string): SessionSkillState {
  return {
    requestedSkills: ['companion'],
    resolvedSkills: [],
    strict: false,
    delivery: {
      provider: 'claude',
      backend: 'api',
      preferredMode: 'instructions',
      mode: 'instructions',
      status: 'applied',
      warnings: [],
      instructions: {
        filePath: instructionsFile,
        byteLength: 18,
      },
    },
    warnings: [],
    appliedSkillIds: ['companion'],
    updatedAt: '2026-03-23T00:00:00.000Z',
  };
}

describe('ensureSessionAwake', () => {
  it('returns already_awake when an execution handle is already active', async () => {
    const registry = new SessionRegistry();
    registry.create(makeSession());
    registry.setProviderSessionId('session-1', 'provider-session-1');
    const runtime = makeRuntime({
      handle: createActiveHandle(),
    });

    const result = await ensureSessionAwake({
      config: makeConfig() as never,
      registry,
      runtime: runtime as never,
      sessionId: 'session-1',
    });

    expect(result).toEqual({
      sessionId: 'session-1',
      providerSessionId: 'provider-session-1',
      outcome: 'already_awake',
    });
    expect(runtime.spawn).not.toHaveBeenCalled();
    expect(registry.get('session-1')?.status).toBe('ready');
  });

  it('spawns non-cli sessions through their backend without requiring a provider session id', async () => {
    const registry = new SessionRegistry();
    registry.create(makeSession({
      id: 'api-session',
      providerName: 'claude',
      providerBackend: 'api',
      providerInstanceId: 'gateway',
      providerSessionId: undefined,
      skills: makeInstructionSkillState('/tmp/runtime-skills.md'),
    }));
    const runtime = makeRuntime();

    const result = await ensureSessionAwake({
      config: makeConfig() as never,
      registry,
      runtime: runtime as never,
      sessionId: 'api-session',
    });

    expect(result).toEqual({
      sessionId: 'api-session',
      providerSessionId: undefined,
      outcome: 'resumed',
    });
    expect(runtime.spawn).toHaveBeenCalledWith(
      'api-session',
      'claude',
      expect.objectContaining({
        cwd: '/repo',
        instructionsFile: '/tmp/runtime-skills.md',
      }),
      'gateway',
      'api',
    );
    expect(registry.get('api-session')?.status).toBe('ready');
  });

  it('rejects discovered sessions that are still active outside cats-runtime', async () => {
    const registry = new SessionRegistry();
    const discovered = registry.upsertDiscovered('external-provider-session', {
      providerName: 'claude',
      cwd: '/repo',
      lastActivity: new Date().toISOString(),
      messageCount: 1,
    });
    expect(discovered).not.toBeNull();
    const runtime = makeRuntime();

    await expect(ensureSessionAwake({
      config: makeConfig() as never,
      registry,
      runtime: runtime as never,
      sessionId: discovered!.id,
    })).rejects.toThrow(
      'This session appears to be active outside cats-runtime already and can only be observed right now.',
    );
    expect(runtime.spawn).not.toHaveBeenCalled();
  });

  it('resolves Pi sessions through their discovered session file path', async () => {
    const registry = new SessionRegistry();
    const discovered = registry.upsertDiscovered('pi-123', {
      providerName: 'pi',
      providerInstanceId: 'default',
      cwd: '/repo',
      sourcePath: '/home/tester/.pi/agent/sessions/repo/session.jsonl',
      messageCount: 1,
    });
    expect(discovered).not.toBeNull();
    const runtime = makeRuntime();

    const result = await ensureSessionAwake({
      config: makeConfig() as never,
      registry,
      runtime: runtime as never,
      sessionId: discovered!.id,
    });

    expect(result).toEqual({
      sessionId: discovered!.id,
      providerSessionId: 'pi-123',
      outcome: 'resumed',
    });
    expect(runtime.spawn).toHaveBeenCalledWith(
      discovered!.id,
      'pi',
      expect.objectContaining({
        cwd: '/repo',
        resumeSourcePath: '/home/tester/.pi/agent/sessions/repo/session.jsonl',
      }),
      'default',
      'cli',
    );
  });

  it('validates Kiro latest-session semantics before falling through to generic CLI resume', async () => {
    const registry = new SessionRegistry();
    const discovered = registry.upsertDiscovered('kiro-123', {
      providerName: 'kiro',
      providerInstanceId: 'default',
      cwd: '/repo',
      messageCount: 1,
    });
    expect(discovered).not.toBeNull();
    const runtime = makeRuntime();
    const getKiroNative = vi.fn(() => ({
      canResumeSession: vi.fn(async () => true),
    }));

    const result = await ensureSessionAwake({
      config: makeConfig() as never,
      registry,
      runtime: runtime as never,
      sessionId: discovered!.id,
      getKiroNative: getKiroNative as never,
    });

    expect(result).toEqual({
      sessionId: discovered!.id,
      providerSessionId: 'kiro-123',
      outcome: 'resumed',
    });
    expect(getKiroNative).toHaveBeenCalledWith('default');
    expect(runtime.spawn).toHaveBeenCalledWith(
      discovered!.id,
      'kiro',
      expect.objectContaining({
        cwd: '/repo',
        resumeSessionId: 'kiro-123',
      }),
      'default',
      'cli',
    );
  });

  it('rejects generic CLI resume when no provider session id is available', async () => {
    const registry = new SessionRegistry();
    registry.create(makeSession({
      id: 'missing-provider-session',
      providerSessionId: undefined,
    }));
    const runtime = makeRuntime();

    await expect(ensureSessionAwake({
      config: makeConfig() as never,
      registry,
      runtime: runtime as never,
      sessionId: 'missing-provider-session',
    })).rejects.toThrow('No provider session ID to resume.');
    expect(runtime.spawn).not.toHaveBeenCalled();
  });
});
