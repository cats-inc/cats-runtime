import { describe, expect, it, vi } from 'vitest';
import {
  KiroNativeSessionService,
} from './KiroNativeSessionService.js';
import { createRuntimeAdapter } from '../runtime/runtime.js';

describe('KiroNativeSessionService', () => {
  it('normalizes Windows workspaces to WSL mount paths when using WSL runtime', () => {
    const service = new KiroNativeSessionService({
      command: 'kiro-cli',
      dbPath: '~/.local/share/kiro-cli/data.sqlite3',
      runtime: createRuntimeAdapter({
        mode: 'wsl',
        distro: 'Ubuntu',
      }),
      runner: async () => ({ code: 0, stdout: '', stderr: '' }),
    });

    expect(service.normalizeWorkspace('C:\\Users\\kenne\\Source\\repo'))
      .toBe('/mnt/c/Users/kenne/Source/repo');
  });

  it('keeps POSIX workspaces unchanged when using native runtime', () => {
    const service = new KiroNativeSessionService({
      command: 'kiro-cli',
      dbPath: '~/Library/Application Support/kiro-cli/data.sqlite3',
      runtime: createRuntimeAdapter({
        mode: 'native',
      }),
      runner: async () => ({ code: 0, stdout: '', stderr: '' }),
    });

    expect(service.normalizeWorkspace('/Users/test/project')).toBe('/Users/test/project');
  });

  it('lists globally discovered Kiro sessions without rewriting native macOS/Linux paths', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify([
        {
          sessionId: 'kiro-1',
          workspacePath: '/Users/kenne/Source/SK2/ai-content-storyteller',
          summary: 'What is pending?',
          messageCount: 2,
          lastActivity: '2026-03-09T00:00:00Z',
          model: 'auto',
        },
      ]),
      stderr: '',
    }));
    const service = new KiroNativeSessionService({
      command: 'kiro-cli',
      dbPath: '~/Library/Application Support/kiro-cli/data.sqlite3',
      runtime: createRuntimeAdapter({
        mode: 'native',
      }),
      runner,
    });

    const sessions = await service.listAllSessions();

    expect(sessions).toEqual([
      {
        providerSessionId: 'kiro-1',
        cwd: '/Users/kenne/Source/SK2/ai-content-storyteller',
        summary: 'What is pending?',
        messageCount: 2,
        lastActivity: '2026-03-09T00:00:00Z',
        model: 'auto',
      },
    ]);
  });

  it('returns the latest session for a workspace when using WSL runtime', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify([
        {
          sessionId: 'kiro-latest',
          workspacePath: '/mnt/c/Users/kenne/Source/SK2/one-man-digital-company',
          summary: 'Latest session',
          messageCount: 3,
          lastActivity: '2026-03-09T10:00:00Z',
        },
        {
          sessionId: 'kiro-old',
          workspacePath: '/mnt/c/Users/kenne/Source/SK2/one-man-digital-company',
          summary: 'Older session',
          messageCount: 1,
          lastActivity: '2026-03-09T09:00:00Z',
        },
      ]),
      stderr: '',
    }));
    const service = new KiroNativeSessionService({
      command: 'kiro-cli',
      dbPath: '~/.local/share/kiro-cli/data.sqlite3',
      runtime: createRuntimeAdapter({
        mode: 'wsl',
        distro: 'Ubuntu',
      }),
      runner,
    });

    const latest = await service.getLatestSession('C:/Users/kenne/Source/SK2/one-man-digital-company');

    expect(latest?.providerSessionId).toBe('kiro-latest');
    await expect(service.canResumeSession(
      'C:/Users/kenne/Source/SK2/one-man-digital-company',
      'kiro-latest',
    )).resolves.toBe(true);
  });
});
