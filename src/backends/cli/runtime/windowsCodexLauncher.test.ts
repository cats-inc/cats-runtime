import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWindowsCodexLauncher } from './windowsCodexLauncher.js';
import { buildProcessSpawnConfig } from './runtime.js';

describe('Windows Codex npm launcher', () => {
  let root: string;
  let packageRoot: string;
  let script: string;
  let binary: string;
  const put = (path: string, value = '') => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cats-codex-launch-'));
    packageRoot = join(root, 'node_modules', '@openai', 'codex');
    script = join(packageRoot, 'bin', 'codex.js');
    put(join(packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex', bin: { codex: 'bin/codex.js' } }));
    put(script, 'const env = { CODEX_MANAGED_PACKAGE_ROOT, CODEX_MANAGED_BY_NPM }; spawn(binaryPath, process.argv.slice(2), { env });');
    const platformRoot = join(packageRoot, 'node_modules', '@openai', 'codex-win32-x64');
    put(join(platformRoot, 'package.json'), '{"name":"@openai/codex"}');
    binary = join(platformRoot, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
    put(binary);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const target = () => ({ command: process.execPath, args: [script] });

  it('resolves the optional platform dependency and mirrors npm ownership', () => {
    expect(resolveWindowsCodexLauncher(target(), 'x64')).toEqual({
      command: binary,
      env: {
        CODEX_MANAGED_PACKAGE_ROOT: packageRoot, CODEX_MANAGED_BY_NPM: '1',
        CODEX_MANAGED_BY_BUN: undefined, CODEX_MANAGED_BY_PNPM: undefined, CODEX_MANAGED_BY_VITE_PLUS: undefined,
      },
    });
  });

  it('resolves bundled ARM64 payloads when no optional package resolves', () => {
    const arm = join(packageRoot, 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe');
    put(arm);
    expect(resolveWindowsCodexLauncher(target(), 'arm64')?.command).toBe(arm);
  });

  it('retains the launcher for incomplete installs and unknown architectures', () => {
    expect(resolveWindowsCodexLauncher(target(), 'ia32')).toBeNull();
    rmSync(binary);
    expect(resolveWindowsCodexLauncher(target(), 'x64')).toBeNull();
  });

  it('does not reinterpret unrelated packages or customized launchers', () => {
    put(join(packageRoot, 'package.json'), '{"name":"local-wrapper","bin":{"codex":"bin/codex.js"}}');
    expect(resolveWindowsCodexLauncher(target(), 'x64')).toBeNull();
    put(join(packageRoot, 'package.json'), '{"name":"@openai/codex","bin":{"codex":"bin/codex.js"}}');
    put(script, 'console.log("custom wrapper")');
    expect(resolveWindowsCodexLauncher(target(), 'x64')).toBeNull();
  });

  it('leaves pnpm ownership to its launcher', () => {
    put(join(root, 'node_modules', '.modules.yaml'), 'layoutVersion: 5');
    expect(resolveWindowsCodexLauncher(target(), 'x64')).toBeNull();
  });

  it('routes auto npm commands directly and preserves all arguments', () => {
    if (process.platform !== 'win32' || process.arch !== 'x64') return;
    const shim = join(root, 'codex.cmd');
    put(shim, '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*');
    put(join(root, 'node.exe'));
    const args = ['app-server', '-c', 'model="a model"'];
    const config = { path: shim, runner: 'auto' as const, runtime: { mode: 'native' as const } };
    expect(buildProcessSpawnConfig(config, 'codex', args, root)).toMatchObject({
      command: binary, args, shell: false, cwd: root,
    });
    expect(buildProcessSpawnConfig(config, 'claude', args, root).command).toBe(join(root, 'node.exe'));
    expect(buildProcessSpawnConfig({ ...config, runner: 'direct' }, 'codex', args, root).command).toBe(shim);
  });
});
