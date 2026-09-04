import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWindowsNodeShim } from './windowsNodeShim.js';

/** The shim npm writes today, reproduced from a real `codex.cmd`. */
function npmShimContents(scriptRelativePath: string): string {
  return [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    '',
    'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% '
      + `& "%_prog%"  "%dp0%\\${scriptRelativePath}" %*`,
  ].join('\r\n');
}

describe('windows node shim resolution', () => {
  let binDir: string;
  let scriptPath: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'cats-shim-test-'));
    mkdirSync(join(binDir, 'node_modules', 'pkg', 'bin'), { recursive: true });
    scriptPath = join(binDir, 'node_modules', 'pkg', 'bin', 'cli.js');
    writeFileSync(scriptPath, '#!/usr/bin/env node\n');
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
    process.env.PATH = originalPath;
  });

  it('resolves an npm shim to the node script it would have run', () => {
    const shimPath = join(binDir, 'tool.cmd');
    writeFileSync(shimPath, npmShimContents('node_modules\\pkg\\bin\\cli.js'));
    writeFileSync(join(binDir, 'node.exe'), '');

    const target = resolveWindowsNodeShim(shimPath);

    expect(target).toEqual({
      command: join(binDir, 'node.exe'),
      args: [scriptPath],
    });
  });

  it('resolves an extensionless configured path to its shim sibling', () => {
    // A provider is usually configured as `...\.npm-global\codex`, with no
    // extension -- the resolution cmd.exe would have done through PATHEXT.
    writeFileSync(join(binDir, 'tool.cmd'), npmShimContents('node_modules\\pkg\\bin\\cli.js'));
    writeFileSync(join(binDir, 'node.exe'), '');

    const target = resolveWindowsNodeShim(join(binDir, 'tool'));

    expect(target?.args).toEqual([scriptPath]);
  });

  it('prefers a node.exe beside the shim over one on PATH, as the shim does', () => {
    const pathDir = mkdtempSync(join(tmpdir(), 'cats-shim-path-'));
    writeFileSync(join(pathDir, 'node.exe'), '');
    process.env.PATH = pathDir;
    try {
      writeFileSync(join(binDir, 'tool.cmd'), npmShimContents('node_modules\\pkg\\bin\\cli.js'));
      writeFileSync(join(binDir, 'node.exe'), '');

      expect(resolveWindowsNodeShim(join(binDir, 'tool.cmd'))?.command)
        .toBe(join(binDir, 'node.exe'));
    } finally {
      rmSync(pathDir, { recursive: true, force: true });
    }
  });

  it('falls back to a node.exe on PATH when the shim has no sibling', () => {
    const pathDir = mkdtempSync(join(tmpdir(), 'cats-shim-path-'));
    writeFileSync(join(pathDir, 'node.exe'), '');
    process.env.PATH = pathDir;
    try {
      writeFileSync(join(binDir, 'tool.cmd'), npmShimContents('node_modules\\pkg\\bin\\cli.js'));

      expect(resolveWindowsNodeShim(join(binDir, 'tool.cmd'))?.command)
        .toBe(join(pathDir, 'node.exe'));
    } finally {
      rmSync(pathDir, { recursive: true, force: true });
    }
  });

  it('declines when node cannot be resolved, so the caller keeps the cmd proxy', () => {
    process.env.PATH = '';
    writeFileSync(join(binDir, 'tool.cmd'), npmShimContents('node_modules\\pkg\\bin\\cli.js'));

    expect(resolveWindowsNodeShim(join(binDir, 'tool.cmd'))).toBeNull();
  });

  it('declines when the script the shim names is missing', () => {
    writeFileSync(join(binDir, 'tool.cmd'), npmShimContents('node_modules\\pkg\\bin\\gone.js'));
    writeFileSync(join(binDir, 'node.exe'), '');

    expect(resolveWindowsNodeShim(join(binDir, 'tool.cmd'))).toBeNull();
  });

  it('declines for a batch file that is not an npm node shim', () => {
    writeFileSync(join(binDir, 'tool.cmd'), '@echo off\r\nsome-other-tool.exe %*\r\n');
    writeFileSync(join(binDir, 'node.exe'), '');

    expect(resolveWindowsNodeShim(join(binDir, 'tool.cmd'))).toBeNull();
  });

  it('declines for a real executable and for a path that does not exist', () => {
    expect(resolveWindowsNodeShim(join(binDir, 'tool.exe'))).toBeNull();
    expect(resolveWindowsNodeShim(join(binDir, 'absent'))).toBeNull();
  });
});
