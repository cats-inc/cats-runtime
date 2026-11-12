import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('Desktop Runtime bundle', () => {
  it('loads the real image codecs and Node builtins before CLI startup', () => {
    execFileSync(process.execPath, ['scripts/bundle-runtime.mjs'], {
      cwd: root, timeout: 30_000, windowsHide: true, stdio: 'pipe',
    });
    const help = execFileSync(process.execPath, ['build/runtime-bundle/index.js', '--help'], {
      cwd: root, timeout: 15_000, windowsHide: true, encoding: 'utf8',
    });
    expect(help).toContain('Usage: cats-runtime [options]');
  }, 50_000);

  it('starts with only the externals Cats Desktop ships beside the bundle', () => {
    // Desktop's bundle layout carries playwright-core and yaml, not Runtime's optional packages.
    execFileSync(process.execPath, ['scripts/bundle-runtime.mjs'], {
      cwd: root, timeout: 30_000, windowsHide: true, stdio: 'pipe',
    });
    const layout = mkdtempSync(path.join(tmpdir(), 'cats-runtime-bundle-layout-'));
    try {
      // As Desktop lays it out: shared/cats-runtime/{package.json, build/runtime/index.js, node_modules}.
      cpSync(path.join(root, 'package.json'), path.join(layout, 'package.json'));
      cpSync(path.join(root, 'build/runtime-bundle/index.js'), path.join(layout, 'build/runtime/index.js'));
      for (const name of ['playwright-core', 'yaml']) {
        cpSync(path.join(root, 'node_modules', name), path.join(layout, 'node_modules', name), { recursive: true });
      }
      const help = execFileSync(process.execPath, ['build/runtime/index.js', '--help'], {
        cwd: layout, timeout: 15_000, windowsHide: true, encoding: 'utf8',
      });
      expect(help).toContain('Usage: cats-runtime [options]');
    } finally {
      rmSync(layout, { recursive: true, force: true });
    }
  }, 60_000);
});
