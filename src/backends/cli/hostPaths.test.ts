import { describe, expect, it } from 'vitest';
import {
  normalizeHostFilesystemPath,
  resolveHostFilesystemPath,
} from './hostPaths.js';

describe('host filesystem path resolution', () => {
  it('expands home-relative native paths on Unix-like hosts', () => {
    expect(resolveHostFilesystemPath('~/.codex/sessions', {
      platform: 'linux',
      homeDir: '/home/tester',
      cwd: '/workspace/cats-runtime',
    })).toBe('/home/tester/.codex/sessions');
  });

  it('lowercases native Windows paths when normalizing discovery keys', () => {
    expect(normalizeHostFilesystemPath('C:\\Users\\Tester\\.codex\\sessions\\', {
      platform: 'win32',
      cwd: 'C:\\workspace\\cats-runtime',
    })).toBe('c:\\users\\tester\\.codex\\sessions');
  });

  it('preserves WSL UNC path casing when normalizing on Windows', () => {
    expect(normalizeHostFilesystemPath('\\\\wsl$\\Ubuntu\\home\\Tester\\.codex\\sessions\\', {
      platform: 'win32',
      runtime: { mode: 'wsl', distro: 'Ubuntu' },
      cwd: 'C:\\workspace\\cats-runtime',
    })).toBe('\\\\wsl$\\Ubuntu\\home\\Tester\\.codex\\sessions');
  });

  it('rejects home-relative WSL paths on Windows because they are guest-relative', () => {
    expect(() => resolveHostFilesystemPath('~/.codex/sessions', {
      platform: 'win32',
      runtime: { mode: 'wsl', distro: 'Ubuntu' },
      homeDir: 'C:\\Users\\tester',
      cwd: 'C:\\workspace\\cats-runtime',
    })).toThrow(/host-accessible path/);
  });

  it('rejects Linux-style absolute WSL paths on Windows because the host cannot resolve them', () => {
    expect(() => resolveHostFilesystemPath('/home/tester/.codex/sessions', {
      platform: 'win32',
      runtime: { mode: 'wsl', distro: 'Ubuntu' },
      cwd: 'C:\\workspace\\cats-runtime',
    })).toThrow(/host-accessible path/);
  });

  it('rejects home-relative Docker paths on Windows because they are container-relative', () => {
    expect(() => resolveHostFilesystemPath('~/.codex/sessions', {
      platform: 'win32',
      runtime: { mode: 'docker' },
      homeDir: 'C:\\Users\\tester',
      cwd: 'C:\\workspace\\cats-runtime',
    })).toThrow(/host-accessible path/);
  });

  it('rejects Linux-style absolute Docker paths on Windows because they refer to the container', () => {
    expect(() => resolveHostFilesystemPath('/home/tester/.codex/sessions', {
      platform: 'win32',
      runtime: { mode: 'docker' },
      cwd: 'C:\\workspace\\cats-runtime',
    })).toThrow(/host-accessible path/);
  });
});
