import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildProcessSpawnConfig } from './runtime.js';

const controls = [
  ['claude', 'DISABLE_AUTOUPDATER', '1'],
  ['opencode', 'OPENCODE_DISABLE_AUTOUPDATE', 'true'],
  ['muse', 'MUSE_NO_AUTO_UPDATE', '1'],
] as const;

describe('provider process update controls', () => {
  it.each(controls)('passes %s updater control to a child without changing the parent', (provider, key, value) => {
    const previous = process.env[key];
    const config = buildProcessSpawnConfig({
      path: process.execPath, runner: 'direct', runtime: { mode: 'native' },
    }, provider, ['-e', 'process.stdout.write(process.env[process.argv[1]] || "missing")', key], process.cwd());
    const child = spawnSync(config.command, config.args, {
      env: { ...process.env, [key]: 'user-value', ...config.env },
      encoding: 'utf8', windowsHide: true, shell: false,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stdout).toBe(value);
    expect(process.env[key]).toBe(previous);
  });

  it.each(['wsl', 'docker'] as const)('carries controls into the %s process environment', (mode) => {
    for (const [provider, key, value] of controls) {
      const config = buildProcessSpawnConfig({
        path: provider, runner: 'direct', runtime: { mode },
      }, provider, ['--help'], '/workspace');
      const payloadKey = mode === 'wsl' ? 'CATS_RUNTIME_WSL_EXEC_B64' : 'CATS_RUNTIME_DOCKER_EXEC_B64';
      const payload = JSON.parse(Buffer.from(config.env![payloadKey], 'base64').toString('utf8'));
      expect(payload.env).toEqual({ [key]: value });
      expect(payload.command).toBe(provider);
      expect(payload.args).toEqual(['--help']);
      expect(config.args.at(-1)).toContain('os.environ.update(payload.get("env", {}))');
    }
  });

  it.each(['native', 'wsl', 'docker'] as const)('disables Junie startup updates once in %s', (mode) => {
    for (const args of [['--help'], ['--skip-update-check', '--help']]) {
      const originalArgs = [...args];
      const config = buildProcessSpawnConfig({
        path: '/fixtures/junie', runner: 'direct', runtime: { mode },
      }, 'junie', args, '/workspace');
      const actualArgs = mode === 'native' ? config.args : JSON.parse(Buffer.from(
        config.env![mode === 'wsl' ? 'CATS_RUNTIME_WSL_EXEC_B64' : 'CATS_RUNTIME_DOCKER_EXEC_B64'], 'base64',
      ).toString('utf8')).args;
      expect(actualArgs).toEqual(['--skip-update-check', '--help']);
      expect(args).toEqual(originalArgs);
    }
  });
});
