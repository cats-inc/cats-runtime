import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

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

function runNpmCommand(args: string[]): string {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const commandArgs = npmExecPath
    ? [npmExecPath, ...args]
    : args;
  const result = spawnSync(
    command,
    commandArgs,
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
      || `npm ${args.join(' ')} failed`,
    );
  }

  return result.stdout;
}

function runBuild(): void {
  runNpmCommand(['run', 'build']);
}

function runPackDryRun(): NpmPackDryRunResult {
  const stdout = runNpmCommand(['pack', '--json', '--dry-run', '--ignore-scripts']);

  const payload = JSON.parse(stdout.trim()) as NpmPackDryRunResult[];
  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error(`Unexpected npm pack payload: ${stdout}`);
  }

  return payload[0]!;
}

describe('package contract', () => {
  beforeAll(() => {
    runBuild();
  }, 40000);

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

  it('cleans stale dist artifacts before rebuilds and packaging', () => {
    const stalePath = join(runtimeRoot, 'dist', 'stale', 'old-artifact.txt');
    mkdirSync(dirname(stalePath), { recursive: true });
    writeFileSync(stalePath, 'stale\n', 'utf8');
    expect(existsSync(stalePath)).toBe(true);

    runBuild();

    expect(existsSync(stalePath)).toBe(false);

    const packed = runPackDryRun();
    const packedPaths = new Set(packed.files.map((entry) => entry.path));
    expect(packedPaths.has('dist/stale/old-artifact.txt')).toBe(false);
  }, 40000);
});
