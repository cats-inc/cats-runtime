import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(testsDir, '..');

function readScript(...segments: string[]): string {
  return readFileSync(join(runtimeRoot, ...segments), 'utf8');
}

describe('pack/install helpers', () => {
  it('delimits the Windows tarball name variable in the delete prompt', () => {
    const script = readScript('scripts', 'windows', 'Pack-Install.ps1');

    expect(script).toMatch(
      /Read-Host\s+"`nDelete\s+(?:\$\{tgzName\}|\$\(\$tgzName\))\?\s+\(Y\/n\)"/,
    );
    expect(script).not.toContain('Read-Host "`nDelete $tgzName? (Y/n)"');
  });
});
