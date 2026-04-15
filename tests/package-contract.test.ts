import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

interface PackageManifest {
  bin?: Record<string, string>;
  exports?: {
    '.': {
      import?: string;
      types?: string;
    };
  };
  files?: string[];
  scripts?: Record<string, string>;
}

interface NpmPackDryRunEntry {
  path: string;
  size: number;
}

interface NpmPackDryRunResult {
  name: string;
  version: string;
  filename?: string;
  files: NpmPackDryRunEntry[];
}

const testsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(testsDir, '..');
const packageJsonPath = join(runtimeRoot, 'package.json');

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest;
}

function runNpmCommand(args: string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const commandArgs = npmExecPath
    ? [npmExecPath, ...args]
    : args;
  const result = spawnSync(
    command,
    commandArgs,
    {
      cwd: options.cwd ?? runtimeRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        ...options.env,
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

function runPack(): { packed: NpmPackDryRunResult; tarballPath: string } {
  const stdout = runNpmCommand(['pack', '--json', '--ignore-scripts']);
  const payload = JSON.parse(stdout.trim()) as NpmPackDryRunResult[];
  if (!Array.isArray(payload) || payload.length !== 1 || !payload[0]?.filename) {
    throw new Error(`Unexpected npm pack payload: ${stdout}`);
  }

  return {
    packed: payload[0],
    tarballPath: join(runtimeRoot, payload[0].filename),
  };
}

function runNodeCommand(args: string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd ?? runtimeRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

describe('package contract', () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop();
      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  beforeAll(() => {
    runBuild();
  }, 90000);

  it('keeps executable bin entries and curated publish contents aligned', () => {
    const manifest = readPackageManifest();
    const packed = runPackDryRun();
    const packedPaths = new Set(packed.files.map((entry) => entry.path));

    expect(manifest.bin).toEqual({
      'cats-runtime': './build/runtime/index.js',
    });
    expect(manifest.exports?.['.']).toEqual({
      import: './build/runtime/index.js',
      types: './build/runtime/index.d.ts',
    });
    expect(manifest.files).toEqual([
      'build/runtime',
      'public',
      'skills',
      'config/management.yaml.example',
      'config/providers.yaml.example',
      'config/curated-model-catalogs.yaml.example',
      '.env.example',
      'README.md',
      'LICENSE',
    ]);
    expect(manifest.scripts?.build).toBe('npm run clean:build && npm run build:ui && node scripts/build-runtime-artifacts.mjs');
    expect(manifest.scripts?.['build:runtime']).toBe('tsc -p tsconfig.json');
    expect(manifest.scripts?.['build:runtime-bundle']).toBe('node scripts/bundle-runtime.mjs');

    expect(packed.name).toBe('cats-runtime');
    expect(packed.version).toBeTruthy();
    expect([...packedPaths]).toEqual(expect.arrayContaining([
      '.env.example',
      'LICENSE',
      'README.md',
      'config/management.yaml.example',
      'config/curated-model-catalogs.yaml.example',
      'config/providers.yaml.example',
      'build/runtime/index.js',
      'build/runtime/index.d.ts',
      'build/runtime/bin/verifySkills.js',
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

  it('cleans stale build artifacts before rebuilds and packaging', () => {
    const stalePath = join(runtimeRoot, 'build', 'runtime', 'stale', 'old-artifact.txt');
    mkdirSync(dirname(stalePath), { recursive: true });
    writeFileSync(stalePath, 'stale\n', 'utf8');
    expect(existsSync(stalePath)).toBe(true);

    runBuild();

    expect(existsSync(stalePath)).toBe(false);

    const packed = runPackDryRun();
    const packedPaths = new Set(packed.files.map((entry) => entry.path));
    expect(packedPaths.has('build/runtime/stale/old-artifact.txt')).toBe(false);
  }, 90000);

  it('smokes the installed runtime entrypoint plus bundled helper scripts from a local tarball', () => {
    const installRoot = mkdtempSync(join(tmpdir(), 'cats-runtime-pack-install-'));
    cleanupPaths.push(installRoot);
    const npmCache = join(installRoot, '.npm-cache');
    const consumerDir = join(installRoot, 'consumer');
    mkdirSync(consumerDir, { recursive: true });
    writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
      name: 'cats-runtime-pack-smoke',
      private: true,
    }, null, 2), 'utf8');

    const { tarballPath } = runPack();
    cleanupPaths.push(tarballPath);

    runNpmCommand(['install', '--no-package-lock', '--ignore-scripts', tarballPath], {
      cwd: consumerDir,
      env: {
        npm_config_cache: npmCache,
      },
    });

    const installedRoot = join(consumerDir, 'node_modules', 'cats-runtime');

    const runtimeHelp = runNodeCommand([join(installedRoot, 'build', 'runtime', 'index.js'), '--help'], {
      cwd: consumerDir,
    });
    expect(runtimeHelp.status).toBe(0);
    expect(runtimeHelp.stdout).toContain('Usage: cats-runtime [options]');
    expect(runtimeHelp.stdout).toContain('cats-runtime mcp [options]');

    const runtimeMcpInspect = runNodeCommand([
      join(installedRoot, 'build', 'runtime', 'index.js'),
      'mcp',
      '--inspect-proxy',
    ], {
      cwd: consumerDir,
      env: {
        CATS_RUNTIME_MCP_PROXY_URL: 'http://127.0.0.1:9/mcp',
        CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS: '25',
      },
    });
    expect(runtimeMcpInspect.status).toBe(1);
    expect(runtimeMcpInspect.stderr).toContain('cats-runtime MCP proxy preflight failed:');
    expect(JSON.parse(runtimeMcpInspect.stdout)).toEqual({
      target: {
        url: 'http://127.0.0.1:9/mcp',
        authorizationConfigured: false,
        timeoutMs: 25,
      },
      probe: {
        status: 'error',
        reason: 'upstream_unavailable',
        message: 'Primary cats-runtime MCP endpoint is unavailable at http://127.0.0.1:9/mcp. Start cats-runtime and retry.',
      },
    });

    const mcpInspect = runNodeCommand([join(installedRoot, 'build', 'runtime', 'bin', 'mcp.js'), '--inspect-proxy'], {
      cwd: consumerDir,
      env: {
        CATS_RUNTIME_MCP_PROXY_URL: 'http://127.0.0.1:9/mcp',
        CATS_RUNTIME_MCP_PROXY_TIMEOUT_MS: '25',
      },
    });
    expect(mcpInspect.status).toBe(1);
    expect(mcpInspect.stderr).toContain('cats-runtime MCP proxy preflight failed:');
    expect(JSON.parse(mcpInspect.stdout)).toEqual({
      target: {
        url: 'http://127.0.0.1:9/mcp',
        authorizationConfigured: false,
        timeoutMs: 25,
      },
      probe: {
        status: 'error',
        reason: 'upstream_unavailable',
        message: 'Primary cats-runtime MCP endpoint is unavailable at http://127.0.0.1:9/mcp. Start cats-runtime and retry.',
      },
    });

    const workspaceDir = join(installRoot, 'workspace');
    mkdirSync(join(workspaceDir, 'src'), { recursive: true });
    writeFileSync(join(workspaceDir, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');

    const workspaceAudit = runNodeCommand([
      join(installedRoot, 'build', 'runtime', 'bin', 'workspaceSubstrate.js'),
      '--operation',
      'audit',
      '--workspace-path',
      workspaceDir,
      '--profile',
      'standard',
      '--agent',
      'codex',
    ], {
      cwd: consumerDir,
    });
    expect(workspaceAudit.status).toBe(0);
    expect(JSON.parse(workspaceAudit.stdout)).toEqual(expect.objectContaining({
      operation: 'audit-workspace',
      status: 'missing',
      actions: expect.arrayContaining([
        expect.objectContaining({
          type: 'create',
          path: 'AGENTS.md',
        }),
      ]),
    }));
  }, 120000);
});
