import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupStalePythonTempDirs, runPythonJsonScript } from './pythonScripts.js';

const cleanupRoots = new Set<string>();

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cats-runtime-python-cleanup-'));
  cleanupRoots.add(root);
  return root;
}

function createDir(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  for (const root of cleanupRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  cleanupRoots.clear();
});

describe('cleanupStalePythonTempDirs', () => {
  it('removes legacy and dead-pid temp dirs but preserves live-pid dirs', async () => {
    const root = makeRoot();
    const legacyDir = createDir(root, 'cats-runtime-python-legacy');
    const deadPidDir = createDir(root, 'cats-runtime-python-999999-dead');
    const currentPidDir = createDir(root, `cats-runtime-python-${process.pid}-keep`);
    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
      stdio: 'ignore',
    });
    const livePidDir = createDir(root, `cats-runtime-python-${live.pid}-keep`);

    try {
      await cleanupStalePythonTempDirs(root, process.pid);

      expect(existsSync(legacyDir)).toBe(false);
      expect(existsSync(deadPidDir)).toBe(false);
      expect(existsSync(currentPidDir)).toBe(true);
      expect(existsSync(livePidDir)).toBe(true);
    } finally {
      live.kill('SIGKILL');
    }
  });
});

describe('runPythonJsonScript', () => {
  it('probes Windows Python launchers without shell mode', async () => {
    const previous = {
      PATH: process.env.PATH,
      PYENV_ROOT: process.env.PYENV_ROOT,
      PYENV_HOME: process.env.PYENV_HOME,
      PYENV: process.env.PYENV,
      PYENV_VERSION: process.env.PYENV_VERSION,
    };
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const runner = vi.fn(async (command: string, args: string[], options) => {
      if (args[0] === '-c') {
        return {
          code: 0,
          stdout: 'C:\\Python312\\python.exe\n',
          stderr: '',
        };
      }

      return {
        code: 0,
        stdout: '{"sessions":[]}',
        stderr: '',
      };
    });

    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      process.env.PATH = '';
      delete process.env.PYENV_ROOT;
      delete process.env.PYENV_HOME;
      delete process.env.PYENV;
      delete process.env.PYENV_VERSION;

      await expect(runPythonJsonScript<{ sessions: unknown[] }>({
        runtime: {
          mode: 'native',
          toRuntimePath: (path) => path,
          toHostPath: (path) => path,
          buildShellInvocation: () => ({ command: 'bash', args: ['-lc', 'ignored'] }),
        },
        runner,
        script: 'import json; print(json.dumps({"sessions": []}))',
        args: [],
        commandLabel: 'Python test command',
        parseLabel: 'Python test payload',
      })).resolves.toEqual({ sessions: [] });

      const probeCalls = runner.mock.calls.filter(([, args]) => args[0] === '-c');
      expect(probeCalls.length).toBeGreaterThan(0);
      expect(probeCalls.every(([, , options]) => options?.shell !== true)).toBe(true);
      expect(probeCalls.every(([, , options]) => options?.windowsHide === true)).toBe(true);
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor);
      }
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
