import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWindowsJunieLauncher } from './windowsJunieLauncher.js';

/** The head and launch line of the shim the Junie installer writes to `junie.bat`. */
const JUNIE_SHIM = [
  '@echo off',
  'setlocal enabledelayedexpansion',
  '',
  ':: JUNIE_MANAGED_SHIM',
  '::',
  ':: Junie CLI Shim for Windows',
  'set "JUNIE_DATA=%USERPROFILE%\\.local\\share\\junie"',
  'if defined JUNIE_DATA_DIR set "JUNIE_DATA=%JUNIE_DATA_DIR%"',
  ':launch',
  '"%JUNIE_EXE%" %*',
  '',
].join('\r\n');

const CWD = 'C:\\Users\\kenne\\repo';

describe('windows junie launcher resolution', () => {
  let root: string;
  let binDir: string;
  let junieData: string;
  const savedEnv: Record<string, string | undefined> = {};

  function addVersion(version: string): string {
    const binaryDir = join(junieData, 'versions', version, 'junie');
    mkdirSync(binaryDir, { recursive: true });
    writeFileSync(join(binaryDir, 'junie.exe'), '');
    return join(binaryDir, 'junie.exe');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cats-junie-launcher-test-'));
    binDir = join(root, '.local', 'bin');
    junieData = join(root, '.local', 'share', 'junie');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(junieData, { recursive: true });
    writeFileSync(join(binDir, 'junie.bat'), JUNIE_SHIM);
    for (const name of ['USERPROFILE', 'JUNIE_DATA_DIR', 'JUNIE_VERSION']) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    process.env.USERPROFILE = root;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('resolves the shim to the binary the current pointer names', () => {
    const binary = addVersion('3419.7');
    writeFileSync(join(junieData, 'current'), '3419.7');

    expect(resolveWindowsJunieLauncher(join(binDir, 'junie.bat'), CWD)).toEqual({
      command: binary,
      env: {
        EJ_RUNNER_PWD: CWD,
        JUNIE_DATA: junieData,
        JUNIE_SHIM_PATH: join(binDir, 'junie.bat'),
      },
    });
  });

  it('resolves an extensionless configured path the way PATHEXT would', () => {
    const binary = addVersion('3419.7');
    writeFileSync(join(junieData, 'current'), '3419.7\r\n');

    expect(resolveWindowsJunieLauncher(join(binDir, 'junie'), CWD)?.command).toBe(binary);
  });

  it('lets JUNIE_VERSION override the pointer, as the shim does', () => {
    addVersion('3419.7');
    const pinned = addVersion('3400.1');
    writeFileSync(join(junieData, 'current'), '3419.7');
    process.env.JUNIE_VERSION = '3400.1';

    expect(resolveWindowsJunieLauncher(join(binDir, 'junie.bat'), CWD)?.command).toBe(pinned);
  });

  it('follows JUNIE_DATA_DIR to a relocated data directory', () => {
    const relocated = join(root, 'elsewhere');
    const binaryDir = join(relocated, 'versions', '3419.7', 'junie');
    mkdirSync(binaryDir, { recursive: true });
    writeFileSync(join(binaryDir, 'junie.exe'), '');
    writeFileSync(join(relocated, 'current'), '3419.7');
    process.env.JUNIE_DATA_DIR = relocated;

    const target = resolveWindowsJunieLauncher(join(binDir, 'junie.bat'), CWD);
    expect(target?.command).toBe(join(binaryDir, 'junie.exe'));
    expect(target?.env.JUNIE_DATA).toBe(relocated);
  });

  it('keeps the shim when the recorded version has no binary', () => {
    writeFileSync(join(junieData, 'current'), '3419.7');

    expect(resolveWindowsJunieLauncher(join(binDir, 'junie.bat'), CWD)).toBeNull();
  });

  it('keeps the shim when no version is recorded or the version escapes versions\\', () => {
    addVersion('3419.7');
    expect(resolveWindowsJunieLauncher(join(binDir, 'junie.bat'), CWD)).toBeNull();

    writeFileSync(join(junieData, 'current'), '..\\3419.7');
    expect(resolveWindowsJunieLauncher(join(binDir, 'junie.bat'), CWD)).toBeNull();
  });

  it('declines for a batch file that is not the Junie shim', () => {
    addVersion('3419.7');
    writeFileSync(join(junieData, 'current'), '3419.7');
    writeFileSync(join(binDir, 'junie.bat'), '@echo off\r\nsome-other-tool.exe %*\r\n');

    expect(resolveWindowsJunieLauncher(join(binDir, 'junie.bat'), CWD)).toBeNull();
    expect(resolveWindowsJunieLauncher(join(binDir, 'absent'), CWD)).toBeNull();
  });
});
