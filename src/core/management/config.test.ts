import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import { loadManagementConfig, resolveManagementConfigPath } from './config.js';

describe('loadManagementConfig', () => {
  const dirs: string[] = [];

  function createRuntimeRoot(yaml?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'cats-mgmt-cfg-'));
    const configDir = join(dir, 'config');
    mkdirSync(configDir, { recursive: true });
    dirs.push(dir);
    if (yaml !== undefined) {
      writeFileSync(join(configDir, 'management.yaml'), yaml);
    }
    return dir;
  }

  function createTestEnv(runtimeRoot?: string): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...(runtimeRoot ? { CATS_RUNTIME_DIR: runtimeRoot } : { CATS_RUNTIME_DIR: '' }),
    };
  }

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('parses a valid config', () => {
    const runtimeRoot = createRuntimeRoot(`
version: 1
adapters:
  review:
    default: github
    instances:
      github:
        transport: cli
        command: gh
        timeout_ms: 15000
  deployment:
    default: zeabur
    instances:
      zeabur:
        transport: cli
        command: zeabur
`);
    const config = loadManagementConfig(undefined, createTestEnv(runtimeRoot));
    expect(config).toBeDefined();
    expect(config!.version).toBe(1);
    expect(config!.adapters.review.default).toBe('github');
    expect(config!.adapters.review.instances.github.command).toBe('gh');
    expect(config!.adapters.review.instances.github.timeout_ms).toBe(15000);
    expect(config!.adapters.deployment.default).toBe('zeabur');
    expect(config!.adapters.deployment.instances.zeabur.transport).toBe('cli');
  });

  it('returns undefined when file does not exist', () => {
    const config = loadManagementConfig(undefined, createTestEnv(createRuntimeRoot()));
    expect(config).toBeUndefined();
  });

  it('falls back to the bundled management config example when the runtime config file is absent', () => {
    const runtimeRoot = createRuntimeRoot();
    const packageRoot = mkdtempSync(join(tmpdir(), 'cats-mgmt-package-'));
    dirs.push(packageRoot);
    mkdirSync(join(packageRoot, 'config'), { recursive: true });
    writeFileSync(join(packageRoot, 'config', 'management.yaml.example'), `
version: 1
adapters:
  review:
    default: github
    instances:
      github:
        command: gh-enterprise
`, 'utf8');

    const config = loadManagementConfig(undefined, {
      ...createTestEnv(runtimeRoot),
      CATS_RUNTIME_PACKAGE_ROOT: packageRoot,
    });

    expect(config).toBeDefined();
    expect(config!.adapters.review.instances.github.command).toBe('gh-enterprise');
  });

  it('throws on unsupported version', () => {
    const runtimeRoot = createRuntimeRoot('version: 99\nadapters: {}');
    expect(() => loadManagementConfig(undefined, createTestEnv(runtimeRoot))).toThrow(
      'Unsupported management config version',
    );
  });

  it('returns empty adapters for missing adapters key', () => {
    const runtimeRoot = createRuntimeRoot('version: 1');
    const config = loadManagementConfig(undefined, createTestEnv(runtimeRoot));
    expect(config).toBeDefined();
    expect(Object.keys(config!.adapters)).toHaveLength(0);
  });

  it('defaults transport to cli when not specified', () => {
    const runtimeRoot = createRuntimeRoot(`
version: 1
adapters:
  review:
    default: github
    instances:
      github:
        command: gh
`);
    const config = loadManagementConfig(undefined, createTestEnv(runtimeRoot));
    expect(config!.adapters.review.instances.github.transport).toBe('cli');
  });

  it('defaults management config under ~/.cats/runtime/config', () => {
    expect(resolveManagementConfigPath(undefined, {
      HOME: '/home/tester',
      USERPROFILE: '',
    })).toBe(join('/home/tester', '.cats', 'runtime', 'config', 'management.yaml'));
  });
});
