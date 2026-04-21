import { readFile } from 'node:fs/promises';
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

  it('emits delete and history scripts that try every separator form for the DB key', async () => {
    // Regression: Kiro stores the raw OS path as conversations_v2.key, so on
    // Windows the stored key keeps backslashes. normalizeWorkspace forces
    // forward slashes, which previously left runtime-origin sessions impossible
    // to delete and made history load return empty. The Python scripts must
    // probe every separator form to match the stored key.
    const capturedScripts: string[] = [];
    const runner = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === '-c') {
        return { code: 0, stdout: 'python\n', stderr: '' };
      }
      const scriptPath = args.find(
        (entry) => typeof entry === 'string' && entry.endsWith('script.py'),
      );
      if (!scriptPath) {
        return { code: 0, stdout: '[]', stderr: '' };
      }
      const script = await readFile(scriptPath, 'utf8');
      capturedScripts.push(script);
      const stdout = script.includes('DELETE FROM conversations_v2')
        ? '{"deleted": true}'
        : '[]';
      return { code: 0, stdout, stderr: '' };
    });

    const service = new KiroNativeSessionService({
      command: 'kiro-cli',
      dbPath: '~/AppData/Local/kiro-cli/data.sqlite3',
      runtime: createRuntimeAdapter({ mode: 'native' }),
      runner,
    });

    await service.deleteSession('C:/Users/test/project', 'conv-del');
    await service.loadHistory('C:/Users/test/project', 'conv-load');

    expect(capturedScripts).toHaveLength(2);
    for (const script of capturedScripts) {
      expect(script).toContain('def workspace_key_candidates(workspace):');
      expect(script).toContain('workspace.replace("\\\\", "/")');
      expect(script).toContain('workspace.replace("/", "\\\\")');
      expect(script).toContain('key IN (');
      expect(script).not.toMatch(/WHERE key = \? AND conversation_id = \?/);
    }
  });

  it('skips WSL discovery when startIfNeeded is false and the distro is stopped', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify([
        {
          sessionId: 'kiro-latest',
          workspacePath: '/mnt/c/Users/kenne/Source/SK2/one-man-digital-company',
          summary: 'Latest session',
          messageCount: 3,
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
      wslInspector: vi.fn(async () => false),
    });

    await expect(service.listAllSessions({ startIfNeeded: false })).resolves.toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });
});
