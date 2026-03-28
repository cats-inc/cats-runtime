import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupStalePythonTempDirs } from './pythonScripts.js';

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
