import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildProcessSpawnConfig,
  buildPowerShellCommandScript,
  buildWindowsCmdProxyCommandLine,
  createRuntimeAdapter,
} from './runtime.js';

describe('runtime adapters', () => {
  it('keeps native POSIX paths unchanged', () => {
    const runtime = createRuntimeAdapter({
      mode: 'native',
    });

    expect(runtime.toRuntimePath('/Users/kenne/repo')).toBe('/Users/kenne/repo');
    expect(runtime.toHostPath('/Users/kenne/repo')).toBe('/Users/kenne/repo');
  });

  it('maps Windows host paths into WSL runtime paths and back', () => {
    const runtime = createRuntimeAdapter({
      mode: 'wsl',
      distro: 'Ubuntu',
    });

    expect(runtime.toRuntimePath('C:\\Users\\kenne\\repo')).toBe('/mnt/c/Users/kenne/repo');
    expect(runtime.toHostPath('/mnt/c/Users/kenne/repo')).toBe('C:/Users/kenne/repo');
  });

  it('builds a WSL spawn config with runtime cwd translation', () => {
    const spawnConfig = buildProcessSpawnConfig(
      {
        path: 'cursor-agent',
        runner: 'direct',
        runtime: {
          mode: 'wsl',
          distro: 'Ubuntu',
        },
      },
      'copilot',
      ['--help'],
      'C:\\Users\\kenne\\repo',
    );

    expect(spawnConfig).toEqual({
      command: 'wsl',
      args: [
        '-d',
        'Ubuntu',
        'bash',
        '-lc',
        [
          'python3 - <<\'PY\'',
          'import base64',
          'import json',
          'import os',
          '',
          'payload = json.loads(base64.b64decode(os.environ["CATS_RUNTIME_WSL_EXEC_B64"]).decode("utf-8"))',
          'if payload.get("ensureCwd"):',
          '    os.makedirs(payload["cwd"], exist_ok=True)',
          'for file in payload.get("tempFiles", []):',
          '    parent = os.path.dirname(file["path"])',
          '    if parent:',
          '        os.makedirs(parent, exist_ok=True)',
          '    with open(file["path"], "w", encoding="utf-8") as handle:',
          '        handle.write(file["content"])',
          'os.chdir(payload["cwd"])',
          'argv = [payload["command"], *payload.get("args", [])]',
          'os.execvp(argv[0], argv)',
          'PY',
        ].join('\n'),
      ],
      shell: false,
      env: {
        CATS_RUNTIME_WSL_EXEC_B64: Buffer.from(JSON.stringify({
          cwd: '/mnt/c/Users/kenne/repo',
          command: 'cursor-agent',
          args: ['--help'],
        }), 'utf8').toString('base64'),
        WSLENV: process.env.WSLENV
          ? process.env.WSLENV.includes('CATS_RUNTIME_WSL_EXEC_B64')
            ? process.env.WSLENV
            : `${process.env.WSLENV}:CATS_RUNTIME_WSL_EXEC_B64`
          : 'CATS_RUNTIME_WSL_EXEC_B64',
      },
    });
  });

  it('passes WSL command arguments through without shell interpolation', () => {
    const spawnConfig = buildProcessSpawnConfig(
      {
        path: 'cursor-agent',
        runner: 'auto',
        runtime: {
          mode: 'wsl',
          distro: 'Ubuntu',
        },
      },
      'cursor',
      ['-p', 'Review ${summary} and keep `literal` text'],
      'C:\\Users\\kenne\\repo',
    );

    expect(spawnConfig.env).toEqual({
      CATS_RUNTIME_WSL_EXEC_B64: Buffer.from(JSON.stringify({
        cwd: '/mnt/c/Users/kenne/repo',
        command: 'cursor-agent',
        args: ['-p', 'Review ${summary} and keep `literal` text'],
      }), 'utf8').toString('base64'),
      WSLENV: process.env.WSLENV
        ? process.env.WSLENV.includes('CATS_RUNTIME_WSL_EXEC_B64')
          ? process.env.WSLENV
          : `${process.env.WSLENV}:CATS_RUNTIME_WSL_EXEC_B64`
        : 'CATS_RUNTIME_WSL_EXEC_B64',
    });
  });

  it('builds a native direct spawn config without path rewriting', () => {
    const spawnConfig = buildProcessSpawnConfig(
      {
        path: '/Users/kenne/.local/bin/cursor-agent',
        runner: 'direct',
        runtime: {
          mode: 'native',
        },
      },
      'cursor',
      ['--help'],
      '/Users/kenne/repo',
    );

    expect(spawnConfig).toEqual({
      command: '/Users/kenne/.local/bin/cursor-agent',
      args: ['--help'],
      shell: false,
      cwd: '/Users/kenne/repo',
    });
  });

  it('passes native auto command arguments through without shell interpolation', () => {
    const spawnConfig = buildProcessSpawnConfig(
      {
        path: 'kiro-cli',
        runner: 'auto',
        runtime: {
          mode: 'native',
        },
      },
      'kiro',
      ['chat', '--no-interactive', 'Review ${summary}\n- **user** (stakeholder)'],
      '/Users/kenne/repo',
    );

    if (process.platform === 'win32') {
      expect(spawnConfig.command.toLowerCase()).toContain('cmd.exe');
      expect(spawnConfig.args).toEqual([
        '/d',
        '/v:off',
        '/s',
        '/c',
        buildWindowsCmdProxyCommandLine('kiro-cli', [
          'chat',
          '--no-interactive',
          'Review ${summary}\n- **user** (stakeholder)',
        ]),
      ]);
      expect(spawnConfig.windowsVerbatimArguments).toBe(true);
      expect(spawnConfig.env).toBeUndefined();
    } else {
      expect(spawnConfig.command).toBe('kiro-cli');
      expect(spawnConfig.args).toEqual([
        'chat',
        '--no-interactive',
        'Review ${summary}\n- **user** (stakeholder)',
      ]);
    }
    expect(spawnConfig.cwd).toBe('/Users/kenne/repo');
    expect(spawnConfig.shell).toBe(false);
  });

  it('wraps the Windows Copilot auto runner in a hidden cmd proxy', () => {
    const spawnConfig = buildProcessSpawnConfig(
      {
        path: 'copilot',
        runner: 'auto',
        runtime: {
          mode: 'native',
        },
      },
      'copilot',
      ['--help'],
      'C:\\Users\\kenne\\repo',
    );

    if (process.platform === 'win32') {
      expect(spawnConfig.command.toLowerCase()).toContain('cmd.exe');
      expect(spawnConfig.args.slice(0, 4)).toEqual([
        '/d',
        '/v:off',
        '/s',
        '/c',
      ]);
      expect(spawnConfig.args[4]).toContain('copilot');
      expect(spawnConfig.args[4]).toContain('"--help"');
      expect(spawnConfig.windowsVerbatimArguments).toBe(true);
      expect(spawnConfig.env).toBeUndefined();
      expect(spawnConfig.shell).toBe(false);
      return;
    }

    expect(spawnConfig.command.toLowerCase()).toContain('copilot');
    expect(spawnConfig.args).toEqual(['--help']);
    expect(spawnConfig.shell).toBe(false);
  });

  it('keeps explicit PowerShell runners on the env-based PowerShell proxy', () => {
    const spawnConfig = buildProcessSpawnConfig(
      {
        path: 'kiro-cli',
        runner: 'pwsh',
        runnerPath: 'pwsh.exe',
        runtime: {
          mode: 'native',
        },
      },
      'kiro',
      ['chat', '--no-interactive', 'Review ${summary}\n- **user** (stakeholder)'],
      'C:\\Users\\kenne\\repo',
    );

    if (process.platform === 'win32') {
      expect(spawnConfig.command.toLowerCase()).toContain('pwsh');
      expect(spawnConfig.args).toEqual([
        '-NoLogo',
        '-NoProfile',
        '-Command',
        buildPowerShellCommandScript(),
      ]);
      expect(spawnConfig.env).toEqual({
        CATS_RUNTIME_PWSH_EXEC_B64: Buffer.from(JSON.stringify({
          command: 'kiro-cli',
          args: [
            'chat',
            '--no-interactive',
            'Review ${summary}\n- **user** (stakeholder)',
          ],
        }), 'utf8').toString('base64'),
      });
      expect(spawnConfig.windowsVerbatimArguments).toBeUndefined();
      return;
    }

    expect(spawnConfig.command).toBe('kiro-cli');
    expect(spawnConfig.args).toEqual([
      'chat',
      '--no-interactive',
      'Review ${summary}\n- **user** (stakeholder)',
    ]);
  });

  it('escapes cmd metacharacters in the Windows command proxy payload', () => {
    const commandLine = buildWindowsCmdProxyCommandLine('C:\\tools\\copilot.cmd', [
      'scan',
      '100%',
      'a^b',
      'c&d',
      'group()',
    ]);

    expect(commandLine).toBe(
      '"'
      + '"C:\\tools\\copilot.cmd"'
      + ' "scan"'
      + ' "100%"'
      + ' "a^^b"'
      + ' "c^&d"'
      + ' "group^(^)"'
      + '"',
    );
  });

  it('round-trips a hidden cmd proxy invocation for Windows shim commands', () => {
    if (process.platform !== 'win32') {
      return;
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'cats-runtime-cmd-proxy-'));
    const shimPath = join(tempDir, 'echo-args.cmd');
    writeFileSync(shimPath, [
      '@echo off',
      'echo argv-start',
      ':loop',
      'if "%~1"=="" goto done',
      'echo [%~1]',
      'shift',
      'goto loop',
      ':done',
      'echo argv-end',
    ].join('\r\n'), 'utf8');

    try {
      const result = spawnSync(
        process.env.ComSpec || 'cmd.exe',
        [
          '/d',
          '/v:off',
          '/s',
          '/c',
          buildWindowsCmdProxyCommandLine(shimPath, ['100%', 'a^b', 'c&d', 'b c']),
        ],
        {
          encoding: 'utf8',
          windowsHide: true,
          windowsVerbatimArguments: true,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('argv-start');
      expect(result.stdout).toContain('[100%]');
      expect(result.stdout).toContain('[a^b]');
      expect(result.stdout).toContain('[c&d]');
      expect(result.stdout).toContain('[b c]');
      expect(result.stdout).toContain('argv-end');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('normalizes backslashes in Docker runtime paths', () => {
    const runtime = createRuntimeAdapter({
      mode: 'docker',
      container: 'cats-cli-dev',
    });

    expect(runtime.toRuntimePath('C:\\Users\\kenne\\repo')).toBe('C:/Users/kenne/repo');
    expect(runtime.toHostPath('/home/user/repo')).toBe('/home/user/repo');
  });

  it('builds a Docker spawn config with base64 payload and PATH prepend', () => {
    const spawnConfig = buildProcessSpawnConfig(
      {
        path: 'claude',
        runner: 'direct',
        runtime: {
          mode: 'docker',
          container: 'cats-cli-dev',
        },
      },
      'claude',
      ['--help'],
      '/workspace/repo',
    );

    const expectedPayload = Buffer.from(JSON.stringify({
      cwd: '/workspace/repo',
      command: 'claude',
      args: ['--help'],
    }), 'utf8').toString('base64');

    expect(spawnConfig.command).toBe('docker');
    expect(spawnConfig.args).toEqual([
      'exec',
      '-i',
      '-e',
      `CATS_RUNTIME_DOCKER_EXEC_B64=${expectedPayload}`,
      'cats-cli-dev',
      'bash',
      '-lc',
      [
        'python3 - <<\'PY\'',
        'import base64',
          'import json',
          'import os',
          '',
          'payload = json.loads(base64.b64decode(os.environ["CATS_RUNTIME_DOCKER_EXEC_B64"]).decode("utf-8"))',
          'os.environ["PATH"] = "/root/.local/bin:" + os.environ.get("PATH", "")',
          'if payload.get("ensureCwd"):',
          '    os.makedirs(payload["cwd"], exist_ok=True)',
          'for file in payload.get("tempFiles", []):',
          '    parent = os.path.dirname(file["path"])',
          '    if parent:',
          '        os.makedirs(parent, exist_ok=True)',
          '    with open(file["path"], "w", encoding="utf-8") as handle:',
          '        handle.write(file["content"])',
          'os.chdir(payload["cwd"])',
          'argv = [payload["command"], *payload.get("args", [])]',
          'os.execvp(argv[0], argv)',
        'PY',
      ].join('\n'),
    ]);
    expect(spawnConfig.shell).toBe(false);
    expect(spawnConfig.env).toEqual({
      CATS_RUNTIME_DOCKER_EXEC_B64: expectedPayload,
    });
  });

  it('rewrites Auggie instruction files into WSL runtime paths', () => {
    const promptDir = mkdtempSync(join(tmpdir(), 'cats-runtime-wsl-auggie-'));
    const promptFile = join(promptDir, 'prompt.txt');
    writeFileSync(promptFile, 'Review the repo', 'utf8');

    try {
      const spawnConfig = buildProcessSpawnConfig(
        {
          path: 'auggie',
          runner: 'direct',
          runtime: {
            mode: 'wsl',
            distro: 'Ubuntu',
          },
        },
        'auggie',
        ['--workspace-root', 'C:\\Users\\kenne\\repo', '--instruction-file', promptFile],
        'C:\\Users\\kenne\\repo',
      );

      expect(spawnConfig.env).toEqual({
        CATS_RUNTIME_WSL_EXEC_B64: Buffer.from(JSON.stringify({
          cwd: '/mnt/c/Users/kenne/repo',
          command: 'auggie',
          args: [
            '--workspace-root',
            '/mnt/c/Users/kenne/repo',
            '--instruction-file',
            promptFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`),
          ],
        }), 'utf8').toString('base64'),
        WSLENV: process.env.WSLENV
          ? process.env.WSLENV.includes('CATS_RUNTIME_WSL_EXEC_B64')
            ? process.env.WSLENV
            : `${process.env.WSLENV}:CATS_RUNTIME_WSL_EXEC_B64`
          : 'CATS_RUNTIME_WSL_EXEC_B64',
      });
    } finally {
      rmSync(promptDir, { recursive: true, force: true });
    }
  });

  it('maps isolated runtime workspaces into a container-local sessions directory for Docker', () => {
    const previousRuntimeDir = process.env.CATS_RUNTIME_DIR;
    process.env.CATS_RUNTIME_DIR = 'C:\\Users\\sammy\\.cats\\runtime';

    try {
      const spawnConfig = buildProcessSpawnConfig(
        {
          path: 'auggie',
          runner: 'direct',
          runtime: {
            mode: 'docker',
            container: 'cats-cli-dev',
          },
        },
        'auggie',
        ['--workspace-root', 'C:\\Users\\sammy\\.cats\\runtime\\sessions\\sess-1'],
        'C:\\Users\\sammy\\.cats\\runtime\\sessions\\sess-1',
      );

      expect(spawnConfig.env).toEqual({
        CATS_RUNTIME_DOCKER_EXEC_B64: Buffer.from(JSON.stringify({
          cwd: '/root/.cats/runtime/sessions/sess-1',
          command: 'auggie',
          args: ['--workspace-root', '/root/.cats/runtime/sessions/sess-1'],
          ensureCwd: true,
        }), 'utf8').toString('base64'),
      });
    } finally {
      if (previousRuntimeDir === undefined) {
        delete process.env.CATS_RUNTIME_DIR;
      } else {
        process.env.CATS_RUNTIME_DIR = previousRuntimeDir;
      }
    }
  });

  it('materializes Auggie instruction files inside the Docker runtime', () => {
    const promptDir = mkdtempSync(join(tmpdir(), 'cats-runtime-docker-auggie-'));
    const promptFile = join(promptDir, 'prompt.txt');
    writeFileSync(promptFile, 'Review the repo', 'utf8');

    try {
      const spawnConfig = buildProcessSpawnConfig(
        {
          path: 'auggie',
          runner: 'direct',
          runtime: {
            mode: 'docker',
            container: 'cats-cli-dev',
          },
        },
        'auggie',
        ['--workspace-root', '/workspace/repo', '--instruction-file', promptFile],
        '/workspace/repo',
      );

      const payload = JSON.parse(
        Buffer.from(spawnConfig.env!.CATS_RUNTIME_DOCKER_EXEC_B64, 'base64').toString('utf8'),
      ) as {
        cwd: string;
        command: string;
        args: string[];
        ensureCwd?: boolean;
        tempFiles?: Array<{ path: string; content: string }>;
      };

      expect(payload.cwd).toBe('/workspace/repo');
      expect(payload.command).toBe('auggie');
      expect(payload.args[0]).toBe('--workspace-root');
      expect(payload.args[1]).toBe('/workspace/repo');
      expect(payload.args[2]).toBe('--instruction-file');
      expect(payload.args[3]).toMatch(/^\/tmp\/cats-runtime\/auggie-instruction-.*\.txt$/);
      expect(payload.tempFiles).toEqual([
        {
          path: payload.args[3]!,
          content: 'Review the repo',
        },
      ]);
    } finally {
      rmSync(promptDir, { recursive: true, force: true });
    }
  });

  it('rewrites Pi system prompt files into WSL runtime paths', () => {
    const promptDir = mkdtempSync(join(tmpdir(), 'cats-runtime-wsl-pi-'));
    const promptFile = join(promptDir, 'system.md');
    writeFileSync(promptFile, 'Pi instructions', 'utf8');

    try {
      const spawnConfig = buildProcessSpawnConfig(
        {
          path: 'pi',
          runner: 'direct',
          runtime: {
            mode: 'wsl',
            distro: 'Ubuntu',
          },
        },
        'pi',
        ['--mode', 'rpc', '--append-system-prompt', promptFile],
        'C:\\Users\\kenne\\repo',
      );

      expect(spawnConfig.env).toEqual({
        CATS_RUNTIME_WSL_EXEC_B64: Buffer.from(JSON.stringify({
          cwd: '/mnt/c/Users/kenne/repo',
          command: 'pi',
          args: [
            '--mode',
            'rpc',
            '--append-system-prompt',
            promptFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`),
          ],
        }), 'utf8').toString('base64'),
        WSLENV: process.env.WSLENV
          ? process.env.WSLENV.includes('CATS_RUNTIME_WSL_EXEC_B64')
            ? process.env.WSLENV
            : `${process.env.WSLENV}:CATS_RUNTIME_WSL_EXEC_B64`
          : 'CATS_RUNTIME_WSL_EXEC_B64',
      });
    } finally {
      rmSync(promptDir, { recursive: true, force: true });
    }
  });

  it('materializes Pi system prompt files inside the Docker runtime', () => {
    const promptDir = mkdtempSync(join(tmpdir(), 'cats-runtime-docker-pi-'));
    const promptFile = join(promptDir, 'system.md');
    writeFileSync(promptFile, 'Pi instructions', 'utf8');

    try {
      const spawnConfig = buildProcessSpawnConfig(
        {
          path: 'pi',
          runner: 'direct',
          runtime: {
            mode: 'docker',
            container: 'cats-cli-dev',
          },
        },
        'pi',
        ['--mode', 'rpc', '--append-system-prompt', promptFile],
        '/workspace/repo',
      );

      const payload = JSON.parse(
        Buffer.from(spawnConfig.env!.CATS_RUNTIME_DOCKER_EXEC_B64, 'base64').toString('utf8'),
      ) as {
        cwd: string;
        command: string;
        args: string[];
        tempFiles?: Array<{ path: string; content: string }>;
      };

      expect(payload.cwd).toBe('/workspace/repo');
      expect(payload.command).toBe('pi');
      expect(payload.args).toEqual([
        '--mode',
        'rpc',
        '--append-system-prompt',
        expect.stringMatching(/^\/tmp\/cats-runtime\/pi-system-prompt-.*\.txt$/),
      ]);
      expect(payload.tempFiles).toEqual([
        {
          path: payload.args[3]!,
          content: 'Pi instructions',
        },
      ]);
    } finally {
      rmSync(promptDir, { recursive: true, force: true });
    }
  });
});
