import { describe, expect, it, vi } from 'vitest';
import {
  CursorNativeSessionService,
} from './CursorNativeSessionService.js';
import { createRuntimeAdapter } from '../runtime/runtime.js';

describe('CursorNativeSessionService', () => {
  function decodeEmbeddedPython(shellScript: string): string {
    const match = shellScript.match(/base64\.b64decode\(\"([^\"]+)\"\)/);
    expect(match?.[1]).toBeTruthy();
    return Buffer.from(match![1], 'base64').toString('utf8');
  }

  it('normalizes Windows workspaces to WSL mount paths when using WSL runtime', () => {
    const service = new CursorNativeSessionService({
      command: 'cursor-agent',
      chatsDir: '~/.cursor/chats',
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
    const service = new CursorNativeSessionService({
      command: 'cursor-agent',
      chatsDir: '~/.cursor/chats',
      runtime: createRuntimeAdapter({
        mode: 'native',
      }),
      runner: async () => ({ code: 0, stdout: '', stderr: '' }),
    });

    expect(service.normalizeWorkspace('/Users/test/project')).toBe('/Users/test/project');
  });

  it('lists globally discovered Cursor sessions without rewriting native macOS/Linux paths', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify([
        {
          sessionId: 'cursor-1',
          workspacePath: '/Users/kenne/Source/SK2/ai-content-storyteller',
          summary: 'Global Cursor Session',
          messageCount: 2,
          lastActivity: '2026-03-09T00:00:00Z',
          model: 'gpt-5.3-codex-xhigh',
        },
      ]),
      stderr: '',
    }));
    const service = new CursorNativeSessionService({
      command: 'cursor-agent',
      chatsDir: '~/.cursor/chats',
      runtime: createRuntimeAdapter({
        mode: 'native',
      }),
      runner,
    });

    const sessions = await service.listAllSessions();

    expect(sessions).toEqual([
      {
        providerSessionId: 'cursor-1',
        cwd: '/Users/kenne/Source/SK2/ai-content-storyteller',
        summary: 'Global Cursor Session',
        messageCount: 2,
        lastActivity: '2026-03-09T00:00:00Z',
        model: 'gpt-5.3-codex-xhigh',
      },
    ]);
  });

  it('filters workspace sessions from the global discovery result when using WSL runtime', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify([
        {
          sessionId: 'cursor-1',
          workspacePath: '/mnt/c/Users/kenne/Source/SK2/ai-content-storyteller',
          summary: 'Storyteller Session',
          messageCount: 2,
        },
        {
          sessionId: 'cursor-2',
          workspacePath: '/mnt/c/Users/kenne/Source/SK2/one-man-digital-company',
          summary: 'Runtime Session',
          messageCount: 1,
        },
      ]),
      stderr: '',
    }));
    const service = new CursorNativeSessionService({
      command: 'cursor-agent',
      chatsDir: '~/.cursor/chats',
      runtime: createRuntimeAdapter({
        mode: 'wsl',
        distro: 'Ubuntu',
      }),
      runner,
    });

    const sessions = await service.listSessions('C:/Users/kenne/Source/SK2/ai-content-storyteller');

    expect(sessions).toEqual([
      {
        providerSessionId: 'cursor-1',
        cwd: 'C:/Users/kenne/Source/SK2/ai-content-storyteller',
        summary: 'Storyteller Session',
        messageCount: 2,
        lastActivity: undefined,
        model: undefined,
      },
    ]);
  });

  it('uses an immutable SQLite fallback for active Cursor session stores', async () => {
    let shellScript = '';
    const runner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify([]),
      stderr: '',
    }));
    const service = new CursorNativeSessionService({
      command: 'cursor-agent',
      chatsDir: '~/.cursor/chats',
      runtime: {
        mode: 'native',
        toRuntimePath: (path) => path,
        toHostPath: (path) => path,
        buildShellInvocation: (script) => {
          shellScript = script;
          return { command: 'bash', args: ['-lc', script] };
        },
      },
      runner,
    });

    await service.listAllSessions();

    expect(decodeEmbeddedPython(shellScript)).toContain('mode=ro&immutable=1');
  });

  it('skips WSL discovery when startIfNeeded is false and the distro is stopped', async () => {
    const runner = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify([
        {
          sessionId: 'cursor-1',
          workspacePath: '/mnt/c/Users/kenne/Source/SK2/ai-content-storyteller',
          summary: 'Storyteller Session',
          messageCount: 2,
        },
      ]),
      stderr: '',
    }));
    const service = new CursorNativeSessionService({
      command: 'cursor-agent',
      chatsDir: '~/.cursor/chats',
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
