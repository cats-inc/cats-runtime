import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { WindowsNodeShimTarget } from './windowsNodeShim.js';

/** Bypass Codex's second, non-hidden spawn in the standard npm launcher. */
export function resolveWindowsCodexLauncher(
  shim: WindowsNodeShimTarget,
  arch: string = process.arch,
): { command: string; env: NodeJS.ProcessEnv } | null {
  if (shim.args.length !== 1 || !['x64', 'arm64'].includes(arch)) return null;
  try {
    const script = realpathSync(shim.args[0]);
    const packageRoot = dirname(dirname(script));
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    if (manifest.name !== '@openai/codex'
      || resolve(packageRoot, manifest.bin?.codex ?? '') !== script
      || !/[/\\]bin[/\\]codex\.js$/u.test(script)) return null;

    const launcher = readFileSync(script, 'utf8');
    // Older layouts and customized launchers keep their normal execution path.
    if (!launcher.includes('CODEX_MANAGED_PACKAGE_ROOT')
      || !launcher.includes('CODEX_MANAGED_BY_NPM')
      || !/spawn\(binaryPath,\s*process\.argv\.slice\(2\)/u.test(launcher)) return null;

    // This resolver handles npm ownership only. Other package managers have
    // different ownership metadata and must keep their own launchers.
    for (let dir = packageRoot; ; dir = dirname(dir)) {
      if (isFile(join(dir, '.modules.yaml'))
        || isFile(join(dir, 'node_modules', '.modules.yaml'))
        || isFile(join(dir, '@openai', 'codex.json'))
        || ['.bun', '.pnpm'].includes(dir.split(/[/\\]/u).at(-1) ?? '')) return null;
      if (dir === dirname(dir)) break;
    }

    let vendorRoot: string;
    try {
      const platformPackage = createRequire(script).resolve(`@openai/codex-win32-${arch}/package.json`);
      vendorRoot = join(dirname(platformPackage), 'vendor');
    } catch {
      vendorRoot = join(packageRoot, 'vendor');
    }
    const triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
    const command = join(vendorRoot, triple, 'bin', 'codex.exe');
    if (!isFile(command)) return null;
    return {
      command,
      env: {
        CODEX_MANAGED_PACKAGE_ROOT: packageRoot,
        CODEX_MANAGED_BY_NPM: '1',
        CODEX_MANAGED_BY_BUN: undefined,
        CODEX_MANAGED_BY_PNPM: undefined,
        CODEX_MANAGED_BY_VITE_PLUS: undefined,
      },
    };
  } catch {
    return null;
  }
}

function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}
