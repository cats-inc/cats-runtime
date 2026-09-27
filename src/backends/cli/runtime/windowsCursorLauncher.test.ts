import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWindowsCursorLauncher } from './windowsCursorLauncher.js';

/** The shim the Cursor installer writes, reproduced from a real `cursor-agent.cmd`. */
const CURSOR_SHIM = [
  '@echo off',
  'setlocal enabledelayedexpansion',
  'set "CURSOR_INVOKED_AS=%~nx0"',
  '',
  'REM Get the directory of this script',
  'set "SCRIPT_DIR=%~dp0"',
  'REM Remove trailing backslash',
  'if "%SCRIPT_DIR:~-1%"=="\\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"',
  '',
  '%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\\cursor-agent.ps1" %*',
  '',
].join('\r\n');

describe('windows cursor launcher resolution', () => {
  let installDir: string;
  let originalCompileCache: string | undefined;
  let originalLocalAppData: string | undefined;

  function addVersion(name: string): string {
    const versionDir = join(installDir, 'versions', name);
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(join(versionDir, 'node.exe'), '');
    writeFileSync(join(versionDir, 'index.js'), '');
    return versionDir;
  }

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'cats-cursor-launcher-test-'));
    writeFileSync(join(installDir, 'cursor-agent.cmd'), CURSOR_SHIM);
    writeFileSync(join(installDir, 'cursor-agent.ps1'), '# launcher');
    originalCompileCache = process.env.NODE_COMPILE_CACHE;
    originalLocalAppData = process.env.LOCALAPPDATA;
    delete process.env.NODE_COMPILE_CACHE;
    process.env.LOCALAPPDATA = 'C:\\Users\\kenne\\AppData\\Local';
  });

  afterEach(() => {
    rmSync(installDir, { recursive: true, force: true });
    if (originalCompileCache === undefined) delete process.env.NODE_COMPILE_CACHE;
    else process.env.NODE_COMPILE_CACHE = originalCompileCache;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
  });

  it('resolves the launcher to node and index.js in the version directory', () => {
    const versionDir = addVersion('2026.09.26-dd393fe');

    expect(resolveWindowsCursorLauncher(join(installDir, 'cursor-agent.cmd'))).toEqual({
      command: join(versionDir, 'node.exe'),
      args: [join(versionDir, 'index.js')],
      env: {
        CURSOR_INVOKED_AS: 'cursor-agent.cmd',
        NODE_COMPILE_CACHE: join('C:\\Users\\kenne\\AppData\\Local', 'cursor-compile-cache'),
      },
    });
  });

  it('resolves an extensionless configured path the way PATHEXT would', () => {
    const versionDir = addVersion('2026.09.26-dd393fe');

    expect(resolveWindowsCursorLauncher(join(installDir, 'cursor-agent'))?.command)
      .toBe(join(versionDir, 'node.exe'));
  });

  it('picks the newest version by date, then by build timestamp', () => {
    addVersion('2026.9.3-aaaaaaa');
    addVersion('2026.09.26-dd393fe');
    const newest = addVersion('2026.09.26-18-04-11-0123abc');
    addVersion('not-a-version');

    expect(resolveWindowsCursorLauncher(join(installDir, 'cursor-agent.cmd'))?.args)
      .toEqual([join(newest, 'index.js')]);
  });

  it('prefers a node.exe beside the launcher, as the script does', () => {
    addVersion('2026.09.26-dd393fe');
    writeFileSync(join(installDir, 'node.exe'), '');
    writeFileSync(join(installDir, 'index.js'), '');

    expect(resolveWindowsCursorLauncher(join(installDir, 'cursor-agent.cmd'))?.command)
      .toBe(join(installDir, 'node.exe'));
  });

  it('leaves a compile cache the environment already configures', () => {
    process.env.NODE_COMPILE_CACHE = 'D:\\cache';
    addVersion('2026.09.26-dd393fe');

    expect(resolveWindowsCursorLauncher(join(installDir, 'cursor-agent.cmd'))?.env)
      .toEqual({ CURSOR_INVOKED_AS: 'cursor-agent.cmd' });
  });

  it('keeps the launcher when no version directory is complete', () => {
    const versionDir = join(installDir, 'versions', '2026.09.26-dd393fe');
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(join(versionDir, 'index.js'), '');

    expect(resolveWindowsCursorLauncher(join(installDir, 'cursor-agent.cmd'))).toBeNull();
  });

  it('declines when the script the shim names is missing', () => {
    addVersion('2026.09.26-dd393fe');
    rmSync(join(installDir, 'cursor-agent.ps1'));

    expect(resolveWindowsCursorLauncher(join(installDir, 'cursor-agent.cmd'))).toBeNull();
  });

  it('declines for a batch file that is not the Cursor launcher', () => {
    addVersion('2026.09.26-dd393fe');
    writeFileSync(join(installDir, 'cursor-agent.cmd'), '@echo off\r\nsome-other-tool.exe %*\r\n');

    expect(resolveWindowsCursorLauncher(join(installDir, 'cursor-agent.cmd'))).toBeNull();
    expect(resolveWindowsCursorLauncher(join(installDir, 'absent'))).toBeNull();
  });
});
