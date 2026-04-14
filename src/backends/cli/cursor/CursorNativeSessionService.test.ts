import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CursorNativeSessionService,
} from './CursorNativeSessionService.js';
import { createRuntimeAdapter } from '../runtime/runtime.js';

describe('CursorNativeSessionService', () => {
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

  it('uses a native temp Python file and keeps the immutable SQLite fallback logic', async () => {
    let executedCommand = '';
    let executedArgs: string[] = [];
    let executedShell = false;
    let capturedScript = '';
    const service = new CursorNativeSessionService({
      command: 'cursor-agent',
      chatsDir: '~/.cursor/chats',
      runtime: {
        mode: 'native',
        toRuntimePath: (path) => path,
        toHostPath: (path) => path,
        buildShellInvocation: () => ({ command: 'bash', args: ['-lc', 'ignored'] }),
      },
      runner: vi.fn(async (command, args, options) => {
        if (process.platform === 'win32' && args[0] === '-c') {
          return {
            code: 0,
            stdout: 'C:\\Python312\\python.exe\n',
            stderr: '',
          };
        }
        executedCommand = command;
        executedArgs = args;
        executedShell = Boolean(options?.shell);
        capturedScript = readFileSync(args[0]!, 'utf8');
        return { code: 0, stdout: JSON.stringify([]), stderr: '' };
      }),
    });

    await service.listAllSessions();

    expect(executedCommand).toMatch(/python(?:3)?(?:\.exe)?$/i);
    expect(executedArgs[0]).toMatch(/script\.py$/);
    expect(executedShell).toBe(false);
    expect(capturedScript).toContain('mode=ro&immutable=1');
  });

  it('keeps the native temp Python file in place until the runner completes', async () => {
    let scriptPath = '';
    const service = new CursorNativeSessionService({
      command: 'cursor-agent',
      chatsDir: '~/.cursor/chats',
      runtime: {
        mode: 'native',
        toRuntimePath: (path) => path,
        toHostPath: (path) => path,
        buildShellInvocation: () => ({ command: 'bash', args: ['-lc', 'ignored'] }),
      },
      runner: vi.fn(async (command, args, options) => {
        if (process.platform === 'win32' && args[0] === '-c') {
          return {
            code: 0,
            stdout: 'C:\\Python312\\python.exe\n',
            stderr: '',
          };
        }

        scriptPath = args[0]!;
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(existsSync(scriptPath)).toBe(true);
        return { code: 0, stdout: JSON.stringify([]), stderr: '' };
      }),
    });

    await service.listAllSessions();
    expect(scriptPath).toMatch(/script\.py$/);
    expect(existsSync(scriptPath)).toBe(false);
  });

  it('creates native Cursor sessions by executing create-chat inside the workspace cwd', async () => {
    const runner = vi.fn(async (command, args, options) => {
      if (command === 'cursor-agent.cmd' || command === 'cursor-agent') {
        return {
          code: 0,
          stdout: 'cursor-session-123\n',
          stderr: '',
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify([
          {
            sessionId: 'cursor-session-123',
            workspacePath: 'C:/repo',
            summary: 'Native Cursor Session',
            messageCount: 0,
          },
        ]),
        stderr: '',
      };
    });
    const service = new CursorNativeSessionService({
      command: process.platform === 'win32' ? 'cursor-agent.cmd' : 'cursor-agent',
      chatsDir: '~/.cursor/chats',
      runtime: createRuntimeAdapter({
        mode: 'native',
      }),
      runner,
    });

    const session = await service.createSession('C:/repo');

    expect(session).toEqual({
      providerSessionId: 'cursor-session-123',
      cwd: 'C:/repo',
      summary: 'Native Cursor Session',
      messageCount: 0,
      lastActivity: undefined,
      model: undefined,
    });
    expect(runner).toHaveBeenNthCalledWith(
      1,
      process.platform === 'win32' ? 'cursor-agent.cmd' : 'cursor-agent',
      ['create-chat'],
      expect.objectContaining({
        cwd: 'C:/repo',
        ...(process.platform === 'win32' ? { shell: true } : {}),
      }),
    );
  });

  it('resolves Windows Cursor shim commands before creating a native session', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    const originalPath = process.env.PATH;
    const tempDir = mkdtempSync(join(tmpdir(), 'cursor-native-shim-'));
    const shimPath = join(tempDir, 'cursor-agent.cmd');
    writeFileSync(shimPath, '@echo off\r\n', 'utf8');
    process.env.PATH = `${tempDir};${originalPath || ''}`;

    const runner = vi.fn(async (command) => {
      if (command === shimPath) {
        return {
          code: 0,
          stdout: 'cursor-session-456\n',
          stderr: '',
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify([
          {
            sessionId: 'cursor-session-456',
            workspacePath: 'C:/repo',
            summary: 'Resolved Cursor Session',
            messageCount: 0,
          },
        ]),
        stderr: '',
      };
    });
    const service = new CursorNativeSessionService({
      command: 'cursor-agent',
      chatsDir: '~/.cursor/chats',
      runtime: createRuntimeAdapter({
        mode: 'native',
      }),
      runner,
    });

    try {
      const session = await service.createSession('C:/repo');

      expect(session).toEqual({
        providerSessionId: 'cursor-session-456',
        cwd: 'C:/repo',
        summary: 'Resolved Cursor Session',
        messageCount: 0,
        lastActivity: undefined,
        model: undefined,
      });
      expect(runner).toHaveBeenNthCalledWith(
        1,
        shimPath,
        ['create-chat'],
        expect.objectContaining({
          cwd: 'C:/repo',
          shell: true,
        }),
      );
    } finally {
      process.env.PATH = originalPath;
    }
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
