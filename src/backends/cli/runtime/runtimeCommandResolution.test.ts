import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProcessSpawnConfig } from './runtime.js';

/** The shim the muse installer writes, reproduced from a real `muse.cmd`. */
const MUSE_SHIM = [
  '@echo off',
  'setlocal',
  '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0.muse-launcher.ps1" %*',
  'exit /b %ERRORLEVEL%',
].join('\r\n');

const MUSE_VERSION = '1.0.3-R2198.1';

const MUSE_COMMAND_CONFIG = {
  path: 'muse',
  runner: 'auto' as const,
  runtime: { mode: 'native' as const },
};

/**
 * Resolving a provider command that PATH cannot see. The process that launched
 * the runtime may predate the install -- the muse installer writes the User
 * PATH in the registry, which nothing already running picks up -- and a
 * GUI-launched host never had the user's shell PATH at all. Setup already
 * reports the install-knowledge expected path as present in that state; the
 * spawn must reach the same place.
 */
describe('provider command resolution through install knowledge', () => {
  const savedEnv: Record<string, string | undefined> = {};

  function stashEnv(...names: string[]): void {
    for (const name of names) {
      savedEnv[name] = process.env[name];
    }
  }

  let scratchRoot: string;

  beforeEach(() => {
    scratchRoot = mkdtempSync(join(tmpdir(), 'cats-command-resolution-'));
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
      delete savedEnv[name];
    }
    rmSync(scratchRoot, { recursive: true, force: true });
  });

  it('spawns the muse agent binary from %LOCALAPPDATA% when muse is not on PATH', () => {
    if (process.platform !== 'win32') return;

    stashEnv('LOCALAPPDATA', 'PATH', 'Path');
    const installDir = join(scratchRoot, 'Programs', 'muse');
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(installDir, 'muse.cmd'), MUSE_SHIM);
    writeFileSync(join(installDir, '.muse-launcher.ps1'), '# launcher');
    writeFileSync(join(installDir, '.muse-version'), `${MUSE_VERSION}\r\n`);
    writeFileSync(join(installDir, `muse-bin-${MUSE_VERSION}.exe`), '');
    writeFileSync(join(installDir, '.muse-release-info.json'), '{"channel":"muse-stable"}\n');
    process.env.LOCALAPPDATA = scratchRoot;
    // A PATH that can execute nothing muse-shaped. System32 is real, so the
    // lookup exercises the same existence checks it would on a user's machine.
    process.env.PATH = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');

    const spawnConfig = buildProcessSpawnConfig(
      MUSE_COMMAND_CONFIG,
      'muse',
      ['exec', '--json', '--', 'Say hi'],
      'C:\\Users\\kenne\\repo',
    );

    // Straight to the binary: no cmd.exe (no console handoff, no terminal
    // flash), no PowerShell launcher in the stdout path, no ~4s launcher start.
    expect(spawnConfig.command).toBe(join(installDir, `muse-bin-${MUSE_VERSION}.exe`));
    expect(spawnConfig.args).toEqual(['exec', '--json', '--', 'Say hi']);
    expect(spawnConfig.shell).toBe(false);
    expect(spawnConfig.env).toEqual({ MUSE_RELEASE_INFO: '{"channel":"muse-stable"}' });
  });

  it('still reaches a half-installed muse through its launcher', () => {
    if (process.platform !== 'win32') return;

    // Launcher present, binary not yet downloaded. Only the launcher can repair
    // that, so it has to be what gets spawned -- via the expected path, since
    // PATH still cannot see it, and via the cmd proxy, since it is a batch file.
    stashEnv('LOCALAPPDATA', 'PATH', 'Path');
    const installDir = join(scratchRoot, 'Programs', 'muse');
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(installDir, 'muse.cmd'), MUSE_SHIM);
    writeFileSync(join(installDir, '.muse-launcher.ps1'), '# launcher');
    writeFileSync(join(installDir, '.muse-version'), MUSE_VERSION);
    process.env.LOCALAPPDATA = scratchRoot;
    process.env.PATH = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');

    const spawnConfig = buildProcessSpawnConfig(
      MUSE_COMMAND_CONFIG,
      'muse',
      ['--version'],
      'C:\\Users\\kenne\\repo',
    );

    expect(spawnConfig.command.toLowerCase()).toContain('cmd.exe');
    expect(spawnConfig.args[4]).toContain(join(installDir, 'muse.cmd'));
  });

  it('leaves a command PATH can see alone on Windows', () => {
    if (process.platform !== 'win32') return;

    // The install-knowledge fallback is a last resort. A muse that PATH does
    // resolve must keep resolving through PATH, even when %LOCALAPPDATA% also
    // holds one, so an operator's own PATH ordering keeps meaning something.
    stashEnv('LOCALAPPDATA', 'PATH', 'Path');
    const onPath = join(scratchRoot, 'on-path');
    mkdirSync(onPath, { recursive: true });
    writeFileSync(join(onPath, 'muse.exe'), '');
    const installDir = join(scratchRoot, 'Programs', 'muse');
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(installDir, 'muse.cmd'), MUSE_SHIM);
    process.env.LOCALAPPDATA = scratchRoot;
    process.env.PATH = onPath;

    const spawnConfig = buildProcessSpawnConfig(
      MUSE_COMMAND_CONFIG,
      'muse',
      ['--version'],
      'C:\\Users\\kenne\\repo',
    );

    expect(spawnConfig.command).toBe(join(onPath, 'muse.exe'));
  });

  it('spawns a provider from ~/.local/bin when PATH does not include it', () => {
    if (process.platform === 'win32') return;

    stashEnv('HOME', 'USERPROFILE', 'PATH');
    const localBin = join(scratchRoot, '.local', 'bin');
    mkdirSync(localBin, { recursive: true });
    const launcher = join(localBin, 'muse');
    writeFileSync(launcher, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(launcher, 0o755);
    process.env.HOME = scratchRoot;
    process.env.USERPROFILE = scratchRoot;
    process.env.PATH = '/usr/bin:/bin';

    const spawnConfig = buildProcessSpawnConfig(
      MUSE_COMMAND_CONFIG,
      'muse',
      ['exec', '--json', '--', 'Say hi'],
      '/Users/kenne/repo',
    );

    expect(spawnConfig.command).toBe(launcher);
    expect(spawnConfig.args).toEqual(['exec', '--json', '--', 'Say hi']);
    expect(spawnConfig.shell).toBe(false);
  });

  it('keeps a bare command bare when PATH can already see it', () => {
    if (process.platform === 'win32') return;

    stashEnv('HOME', 'USERPROFILE', 'PATH');
    const onPath = join(scratchRoot, 'bin');
    mkdirSync(onPath, { recursive: true });
    writeFileSync(join(onPath, 'muse'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(onPath, 'muse'), 0o755);
    process.env.HOME = scratchRoot;
    process.env.USERPROFILE = scratchRoot;
    process.env.PATH = onPath;

    const spawnConfig = buildProcessSpawnConfig(
      MUSE_COMMAND_CONFIG,
      'muse',
      ['--version'],
      '/Users/kenne/repo',
    );

    // Unchanged from before: the spawn does its own PATH lookup.
    expect(spawnConfig.command).toBe('muse');
  });

  it('never swaps an operator-configured command for the stock binary', () => {
    // The install knowledge describes where the installer puts *its* binary.
    // An operator who pointed the provider at a wrapper that PATH cannot see
    // must get a failure for the wrapper, not the stock binary run in its place.
    stashEnv('HOME', 'USERPROFILE', 'LOCALAPPDATA', 'PATH', 'Path');
    const installDir = process.platform === 'win32'
      ? join(scratchRoot, 'Programs', 'muse')
      : join(scratchRoot, '.local', 'bin');
    mkdirSync(installDir, { recursive: true });
    if (process.platform === 'win32') {
      writeFileSync(join(installDir, 'muse.cmd'), MUSE_SHIM);
      writeFileSync(join(installDir, '.muse-launcher.ps1'), '# launcher');
      writeFileSync(join(installDir, '.muse-version'), MUSE_VERSION);
      writeFileSync(join(installDir, `muse-bin-${MUSE_VERSION}.exe`), '');
    } else {
      writeFileSync(join(installDir, 'muse'), '#!/usr/bin/env bash\nexit 0\n');
      chmodSync(join(installDir, 'muse'), 0o755);
    }
    process.env.HOME = scratchRoot;
    process.env.USERPROFILE = scratchRoot;
    process.env.LOCALAPPDATA = scratchRoot;
    process.env.PATH = process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
      : '/usr/bin:/bin';

    const spawnConfig = buildProcessSpawnConfig(
      { ...MUSE_COMMAND_CONFIG, path: 'my-muse-wrapper' },
      'muse',
      ['--version'],
      process.platform === 'win32' ? 'C:\\Users\\kenne\\repo' : '/Users/kenne/repo',
    );

    if (process.platform === 'win32') {
      expect(spawnConfig.command.toLowerCase()).toContain('cmd.exe');
      expect(spawnConfig.args[4]).toContain('my-muse-wrapper');
      expect(spawnConfig.args[4]).not.toContain('muse-bin-');
    } else {
      expect(spawnConfig.command).toBe('my-muse-wrapper');
    }
  });

  it('does not invent a path for a provider with no install knowledge', () => {
    stashEnv('HOME', 'USERPROFILE', 'LOCALAPPDATA', 'PATH', 'Path');
    process.env.HOME = scratchRoot;
    process.env.USERPROFILE = scratchRoot;
    process.env.LOCALAPPDATA = scratchRoot;
    process.env.PATH = process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
      : '/usr/bin:/bin';

    const spawnConfig = buildProcessSpawnConfig(
      { path: 'not-a-provider-cli', runner: 'auto', runtime: { mode: 'native' } },
      'not-a-provider',
      ['--version'],
      process.platform === 'win32' ? 'C:\\Users\\kenne\\repo' : '/Users/kenne/repo',
    );

    if (process.platform === 'win32') {
      expect(spawnConfig.args[4]).toContain('not-a-provider-cli');
    } else {
      expect(spawnConfig.command).toBe('not-a-provider-cli');
    }
  });
});
