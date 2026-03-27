import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  bin?: Record<string, string>;
  exports?: {
    '.': {
      import?: string;
      types?: string;
    };
  };
  files?: string[];
}

interface NpmPackDryRunEntry {
  path: string;
  size: number;
}

interface NpmPackDryRunResult {
  name: string;
  version: string;
  files: NpmPackDryRunEntry[];
}

const testsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(testsDir, '..');
const packageJsonPath = join(runtimeRoot, 'package.json');

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest;
}

function runPackDryRun(): NpmPackDryRunResult {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = npmExecPath
    ? [npmExecPath, 'pack', '--json', '--dry-run', '--ignore-scripts']
    : ['pack', '--json', '--dry-run', '--ignore-scripts'];
  const result = spawnSync(
    command,
    args,
    {
      cwd: runtimeRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        npm_config_loglevel: 'silent',
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr
      || result.stdout
      || result.error?.message
      || 'npm pack --dry-run failed',
    );
  }

  const payload = JSON.parse(result.stdout.trim()) as NpmPackDryRunResult[];
  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error(`Unexpected npm pack payload: ${result.stdout}`);
  }

  return payload[0]!;
}

describe('package contract', () => {
  it('keeps executable bin entries and curated publish contents aligned', () => {
    const manifest = readPackageManifest();
    const packed = runPackDryRun();
    const packedPaths = new Set(packed.files.map((entry) => entry.path));

    expect(manifest.bin).toEqual({
      'cats-runtime': './dist/index.js',
      'cats-runtime-mcp': './dist/bin/mcp.js',
    });
    expect(manifest.exports?.['.']).toEqual({
      import: './dist/index.js',
      types: './dist/index.d.ts',
    });
    expect(manifest.files).toEqual([
      'dist',
      'public',
      'skills',
      'config/providers.yaml.example',
      '.env.example',
      'README.md',
      'LICENSE',
    ]);

    expect(packed.name).toBe('cats-runtime');
    expect(packed.version).toBeTruthy();
    expect([...packedPaths]).toEqual(expect.arrayContaining([
      '.env.example',
      'LICENSE',
      'README.md',
      'config/providers.yaml.example',
      'dist/index.js',
      'dist/index.d.ts',
      'dist/bin/mcp.js',
      'dist/bin/verifySkills.js',
      'public/index.html',
      'public/playground.html',
      'public/provider-setup.html',
      'skills/README.md',
      'package.json',
    ]));

    expect([...packedPaths].some((path) => path.startsWith('src/'))).toBe(false);
    expect([...packedPaths].some((path) => path.startsWith('tests/'))).toBe(false);
    expect([...packedPaths].some((path) => path.startsWith('docs/'))).toBe(false);
    expect(packedPaths.has('tsconfig.json')).toBe(false);
    expect(packedPaths.has('vitest.config.ts')).toBe(false);
  }, 20000);
});
