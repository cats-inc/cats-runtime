import { describe, expect, it } from 'vitest';
import {
  buildProcessSpawnConfig,
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

  it('passes native auto command arguments through without shell interpolation on POSIX', () => {
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

    expect(spawnConfig.command).toBe('kiro-cli');
    expect(spawnConfig.args).toEqual([
      'chat',
      '--no-interactive',
      'Review ${summary}\n- **user** (stakeholder)',
    ]);
    expect(spawnConfig.cwd).toBe('/Users/kenne/repo');
    expect(spawnConfig.shell).toBe(process.platform === 'win32');
  });
});
