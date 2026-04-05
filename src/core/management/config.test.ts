import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import { loadManagementConfig, resolveManagementConfigPath } from './config.js';

describe('loadManagementConfig', () => {
  const dirs: string[] = [];

  function createTemp(yaml: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'cats-mgmt-cfg-'));
    dirs.push(dir);
    const file = join(dir, 'management.yaml');
    writeFileSync(file, yaml);
    return file;
  }

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('parses a valid config', () => {
    const path = createTemp(`
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
    const config = loadManagementConfig(path);
    expect(config).toBeDefined();
    expect(config!.version).toBe(1);
    expect(config!.adapters.review.default).toBe('github');
    expect(config!.adapters.review.instances.github.command).toBe('gh');
    expect(config!.adapters.review.instances.github.timeout_ms).toBe(15000);
    expect(config!.adapters.deployment.default).toBe('zeabur');
    expect(config!.adapters.deployment.instances.zeabur.transport).toBe('cli');
  });

  it('returns undefined when file does not exist', () => {
    const config = loadManagementConfig('/tmp/nonexistent-cats-mgmt.yaml');
    expect(config).toBeUndefined();
  });

  it('throws on unsupported version', () => {
    const path = createTemp('version: 99\nadapters: {}');
    expect(() => loadManagementConfig(path)).toThrow('Unsupported management config version');
  });

  it('returns empty adapters for missing adapters key', () => {
    const path = createTemp('version: 1');
    const config = loadManagementConfig(path);
    expect(config).toBeDefined();
    expect(Object.keys(config!.adapters)).toHaveLength(0);
  });

  it('defaults transport to cli when not specified', () => {
    const path = createTemp(`
version: 1
adapters:
  review:
    default: github
    instances:
      github:
        command: gh
`);
    const config = loadManagementConfig(path);
    expect(config!.adapters.review.instances.github.transport).toBe('cli');
  });

  it('defaults management config under ~/.cats/runtime/config', () => {
    expect(resolveManagementConfigPath(undefined, undefined, {
      HOME: '/home/tester',
      USERPROFILE: '',
    })).toBe(join('/home/tester', '.cats', 'runtime', 'config', 'management.yaml'));
  });
});
