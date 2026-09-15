import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProviderInstallCheckRunner } from './ProviderInstallCheckRunner.js';

describe('Windows npm installation inspection', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'win32')(
    'reads package metadata through a node shim without starting a shell or provider',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'cats-npm-metadata-'));
      tempDirs.push(root);
      const cliDir = join(root, 'node_modules', 'npm', 'bin');
      mkdirSync(cliDir, { recursive: true });
      writeFileSync(join(root, 'npm.cmd'), [
        '@echo off',
        'exit /b 97', // Running the shell shim instead of its node target must fail.
        '"%_prog%" "%dp0%\\node_modules\\npm\\bin\\npm-cli.js" %*',
      ].join('\r\n'));
      writeFileSync(join(cliDir, 'npm-cli.js'), `
        const args = process.argv.slice(2);
        if (JSON.stringify(args) === JSON.stringify(['list', '-g', 'cline', '--depth=0', '--json'])) {
          process.stdout.write(JSON.stringify({ dependencies: { cline: { version: '3.1.0' } } }));
        } else if (JSON.stringify(args) === JSON.stringify(['config', 'get', 'prefix'])) {
          process.stdout.write('isolated-prefix');
        } else {
          process.exitCode = 98;
        }
      `);
      vi.stubEnv('PATH', [root, dirname(process.execPath)].join(delimiter));
      vi.stubEnv('ComSpec', join(root, 'no-shell.exe'));
      vi.stubEnv('HOME', root);
      vi.stubEnv('USERPROFILE', root);
      vi.stubEnv('CATS_RUNTIME_DIR', join(root, 'runtime'));

      expect(await defaultProviderInstallCheckRunner.checkNpmPackage(
        'cline', { mode: 'native' }, 5_000,
      )).toMatchObject({ exists: true, version: '3.1.0', timedOut: false });
      expect(await defaultProviderInstallCheckRunner.getNpmPrefix(
        { mode: 'native' }, 5_000,
      )).toMatchObject({ value: 'isolated-prefix', timedOut: false });
    },
  );

  it.skipIf(process.platform !== 'win32').each([false, true])(
    'inspects bundled npm without a shell and respects an installed prefix override: %s',
    async (hasOverride) => {
      const root = mkdtempSync(join(tmpdir(), 'cats-bundled-npm-'));
      tempDirs.push(root);
      const cliDir = join(root, 'node_modules', 'npm', 'bin');
      const prefix = join(root, 'global prefix');
      mkdirSync(cliDir, { recursive: true });
      writeFileSync(join(root, 'npm.cmd'), String.raw`:: Created by npm, please don't edit manually.
@ECHO OFF
SETLOCAL
SET "NODE_EXE=%~dp0\node.exe"
IF NOT EXIST "%NODE_EXE%" (
  SET "NODE_EXE=node"
)
SET "NPM_PREFIX_JS=%~dp0\node_modules\npm\bin\npm-prefix.js"
SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js"
FOR /F "delims=" %%F IN ('CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"') DO (
  SET "NPM_PREFIX_NPM_CLI_JS=%%F\node_modules\npm\bin\npm-cli.js"
)
IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (
  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"
)
"%NODE_EXE%" "%NPM_CLI_JS%" %*
`);
      writeFileSync(join(cliDir, 'npm-prefix.js'), `process.stdout.write(${JSON.stringify(prefix)});`);
      const writeMetadataScript = (directory: string, version: string) => {
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, 'npm-cli.js'), `
          const expected = ['list', '-g', 'cline', '--depth=0', '--json'];
          if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(98);
          process.stdout.write(JSON.stringify({ dependencies: { cline: { version: '${version}' } } }));
        `);
      };
      writeMetadataScript(cliDir, '3.0.60');
      if (hasOverride) {
        writeMetadataScript(join(prefix, 'node_modules', 'npm', 'bin'), '3.1.0');
      }
      vi.stubEnv('PATH', [root, dirname(process.execPath)].join(delimiter));
      vi.stubEnv('ComSpec', join(root, 'no-shell.exe'));
      vi.stubEnv('HOME', root);
      vi.stubEnv('USERPROFILE', root);
      vi.stubEnv('CATS_RUNTIME_DIR', join(root, 'runtime'));

      expect(await defaultProviderInstallCheckRunner.checkNpmPackage(
        'cline', { mode: 'native' }, 5_000,
      )).toMatchObject({
        exists: true, version: hasOverride ? '3.1.0' : '3.0.60', timedOut: false,
      });
    },
  );

  it.skipIf(process.platform !== 'win32')('does not execute unrecognized npm wrappers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-unknown-npm-'));
    tempDirs.push(root);
    writeFileSync(join(root, 'npm.cmd'), '@echo off\r\nexit /b 99\r\n');
    vi.stubEnv('PATH', root);
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    vi.stubEnv('ComSpec', join(root, 'no-shell.exe'));

    const result = await defaultProviderInstallCheckRunner.checkNpmPackage('cline', { mode: 'native' });
    expect(result).toMatchObject({ exists: false, timedOut: false });
    expect(result.error).toContain('without starting a shell');
  });

  it('resolves a stock Cline install outside PATH without executing it or replacing custom commands', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cats-passive-path-'));
    tempDirs.push(root);
    const windows = process.platform === 'win32';
    const binDir = windows ? join(root, '.npm-global') : join(root, '.npm-global', 'bin');
    mkdirSync(binDir, { recursive: true });
    const commandPath = join(binDir, windows ? 'cline.cmd' : 'cline');
    writeFileSync(commandPath, windows ? '@echo off\r\nexit /b 99\r\n' : '#!/bin/sh\nexit 99\n');
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    vi.stubEnv('APPDATA', join(root, 'roaming'));
    vi.stubEnv('LOCALAPPDATA', join(root, 'local'));
    vi.stubEnv('npm_config_prefix', join(root, '.npm-global'));
    vi.stubEnv('PATH', '');
    vi.stubEnv('CATS_RUNTIME_DIR', join(root, 'runtime'));

    expect(await defaultProviderInstallCheckRunner.lookupCommand('cline', { mode: 'native' }))
      .toMatchObject({ available: true, resolvedPath: commandPath });
    expect(await defaultProviderInstallCheckRunner.lookupCommand('custom-cline', { mode: 'native' }))
      .toMatchObject({ available: false });
  });
});
