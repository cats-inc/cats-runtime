import { execFileSync } from 'node:child_process';
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
});
