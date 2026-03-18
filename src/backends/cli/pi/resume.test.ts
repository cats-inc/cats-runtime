import { describe, expect, it } from 'vitest';
import type { CliRuntimeConfig } from '../config.js';
import type { SessionInfo } from '../../../core/types.js';
import {
  getPiResumeSourcePath,
  isPiUnknownSessionError,
  resolvePiResumeTarget,
} from './resume.js';

function makeConfig(overrides?: {
  runtimeMode?: 'native' | 'wsl' | 'docker';
  distro?: string;
  sessionsDir?: string;
  instanceId?: string;
}): CliRuntimeConfig {
  const runtimeMode = overrides?.runtimeMode || 'native';
  const sessionsDir = overrides?.sessionsDir || '~/.pi/agent/sessions';
  const instanceId = overrides?.instanceId || 'default';

  return {
    piSessionsDir: sessionsDir,
    providerCommands: {
      pi: {
        path: 'pi',
        runner: 'auto',
        runtime: {
          mode: runtimeMode,
          distro: overrides?.distro,
        },
      },
    },
    providerDefaultInstances: {
      pi: instanceId,
    },
    providerInstances: {
      pi: {
        [instanceId]: {
          id: instanceId,
          providerName: 'pi',
          commandConfig: {
            path: 'pi',
            runner: 'auto',
            runtime: {
              mode: runtimeMode,
              distro: overrides?.distro,
            },
          },
          piSessionsDir: sessionsDir,
        },
      },
    },
  } as unknown as CliRuntimeConfig;
}

function makeSession(overrides?: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'pi-session',
    providerName: 'pi',
    providerBackend: 'cli',
    providerInstanceId: 'default',
    providerSessionId: 'pi-123',
    status: 'closed',
    origin: 'discovered',
    cwd: '/repo',
    workspaceMode: 'shared',
    messageCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: '2026-03-19T00:00:00.000Z',
    updatedAt: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('Pi resume helpers', () => {
  it('prefers providerSourcePath when available', () => {
    const session = makeSession({
      sourcePath: 'C:/old.jsonl',
      providerSourcePath: 'C:/provider.jsonl',
    });

    expect(getPiResumeSourcePath(session)).toBe('C:/provider.jsonl');
  });

  it('resolves native Pi resume targets from the discovered session path', () => {
    const config = makeConfig({
      runtimeMode: 'native',
      sessionsDir: 'C:/Users/test/.pi/agent/sessions',
    });
    const session = makeSession({
      sourcePath: 'C:/Users/test/.pi/agent/sessions/workspace/session.jsonl',
    });

    expect(resolvePiResumeTarget(config, session, 'win32')).toMatchObject({
      hostSourcePath: 'c:\\users\\test\\.pi\\agent\\sessions\\workspace\\session.jsonl',
      runtimeSourcePath: 'c:/users/test/.pi/agent/sessions/workspace/session.jsonl',
    });
  });

  it('converts WSL UNC discovery paths back into Linux runtime paths', () => {
    const config = makeConfig({
      runtimeMode: 'wsl',
      distro: 'Ubuntu',
      sessionsDir: '/home/tester/.pi/agent/sessions',
    });
    const session = makeSession({
      sourcePath: '\\\\wsl$\\Ubuntu\\home\\tester\\.pi\\agent\\sessions\\repo\\session.jsonl',
    });

    expect(resolvePiResumeTarget(config, session, 'win32')).toMatchObject({
      hostSourcePath: '\\\\wsl$\\Ubuntu\\home\\tester\\.pi\\agent\\sessions\\repo\\session.jsonl',
      runtimeSourcePath: '/home/tester/.pi/agent/sessions/repo/session.jsonl',
    });
  });

  it('rejects discovered Pi session paths outside the configured sessions_dir', () => {
    const config = makeConfig({
      runtimeMode: 'native',
      sessionsDir: 'C:/Users/test/.pi/agent/sessions',
    });
    const session = makeSession({
      sourcePath: 'C:/Users/test/Desktop/session.jsonl',
    });

    expect(() => resolvePiResumeTarget(config, session, 'win32')).toThrow(
      /outside the configured sessions_dir/,
    );
  });

  it('rejects Docker-backed Pi resume on Windows when the source path is host-only', () => {
    const config = makeConfig({
      runtimeMode: 'docker',
      sessionsDir: 'C:/Users/test/.pi/agent/sessions',
    });
    const session = makeSession({
      sourcePath: 'C:/Users/test/.pi/agent/sessions/workspace/session.jsonl',
    });

    expect(() => resolvePiResumeTarget(config, session, 'win32')).toThrow(
      /Docker-backed instances on Windows is not supported yet/,
    );
  });

  it('detects Pi unknown-session failures from process errors', () => {
    expect(isPiUnknownSessionError(new Error('Process exited. stderr: Unknown session abc'))).toBe(
      true,
    );
    expect(isPiUnknownSessionError(new Error('Process exited cleanly'))).toBe(false);
  });
});
