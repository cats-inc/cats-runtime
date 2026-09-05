import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWindowsMuseLauncher } from './windowsMuseLauncher.js';

/** The shim the muse installer writes today, reproduced from a real `muse.cmd`. */
const MUSE_SHIM = [
  '@echo off',
  'setlocal',
  '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0.muse-launcher.ps1" %*',
  'exit /b %ERRORLEVEL%',
].join('\r\n');

const VERSION = '1.0.3-R2198.1';

describe('windows muse launcher resolution', () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), 'cats-muse-launcher-test-'));
    writeFileSync(join(installDir, 'muse.cmd'), MUSE_SHIM);
    writeFileSync(join(installDir, '.muse-launcher.ps1'), '# launcher');
  });

  afterEach(() => {
    rmSync(installDir, { recursive: true, force: true });
  });

  it('resolves the launcher to the recorded agent binary beside it', () => {
    writeFileSync(join(installDir, '.muse-version'), `${VERSION}\r\n`);
    writeFileSync(join(installDir, `muse-bin-${VERSION}.exe`), '');

    expect(resolveWindowsMuseLauncher(join(installDir, 'muse.cmd'))).toEqual({
      command: join(installDir, `muse-bin-${VERSION}.exe`),
    });
  });

  it('resolves an extensionless configured path the way PATHEXT would', () => {
    writeFileSync(join(installDir, '.muse-version'), VERSION);
    writeFileSync(join(installDir, `muse-bin-${VERSION}.exe`), '');

    expect(resolveWindowsMuseLauncher(join(installDir, 'muse'))?.command)
      .toBe(join(installDir, `muse-bin-${VERSION}.exe`));
  });

  it('hands the binary the release info the launcher would have set', () => {
    writeFileSync(join(installDir, '.muse-version'), VERSION);
    writeFileSync(join(installDir, `muse-bin-${VERSION}.exe`), '');
    const releaseInfo = '{"channel":"muse-stable","version":"1.0.3-R2198.1"}';
    writeFileSync(join(installDir, '.muse-release-info.json'), `${releaseInfo}\n`);

    expect(resolveWindowsMuseLauncher(join(installDir, 'muse.cmd'))).toEqual({
      command: join(installDir, `muse-bin-${VERSION}.exe`),
      env: { MUSE_RELEASE_INFO: releaseInfo },
    });
  });

  it('keeps the launcher when the install is half finished', () => {
    // The installer writes the launcher first and downloads the binary last, so
    // a launcher with no binary behind it is a reachable state. Only the
    // launcher can repair it, so it must stay on the spawn path.
    writeFileSync(join(installDir, '.muse-version'), VERSION);

    expect(resolveWindowsMuseLauncher(join(installDir, 'muse.cmd'))).toBeNull();
  });

  it('keeps the launcher when no version has been recorded', () => {
    writeFileSync(join(installDir, `muse-bin-${VERSION}.exe`), '');

    expect(resolveWindowsMuseLauncher(join(installDir, 'muse.cmd'))).toBeNull();
  });

  it('refuses a version that would escape the install directory', () => {
    writeFileSync(join(installDir, '.muse-version'), '..\\..\\evil');
    writeFileSync(join(installDir, `muse-bin-${VERSION}.exe`), '');

    expect(resolveWindowsMuseLauncher(join(installDir, 'muse.cmd'))).toBeNull();
  });

  it('leaves a batch file that is not the muse launcher alone', () => {
    writeFileSync(join(installDir, 'tool.cmd'), '@echo off\r\nsome-other-tool.exe %*\r\n');
    writeFileSync(join(installDir, '.muse-version'), VERSION);
    writeFileSync(join(installDir, `muse-bin-${VERSION}.exe`), '');

    expect(resolveWindowsMuseLauncher(join(installDir, 'tool.cmd'))).toBeNull();
  });

  it('leaves the npm node shim to its own resolver', () => {
    writeFileSync(
      join(installDir, 'codex.cmd'),
      'endLocal & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    );

    expect(resolveWindowsMuseLauncher(join(installDir, 'codex.cmd'))).toBeNull();
  });

  it('returns null for a command that does not exist', () => {
    expect(resolveWindowsMuseLauncher(join(installDir, 'missing.cmd'))).toBeNull();
    expect(resolveWindowsMuseLauncher(join(installDir, 'missing'))).toBeNull();
  });
});
