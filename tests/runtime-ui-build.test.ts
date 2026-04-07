import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const runtimeRoot = process.cwd();
const sourcePagesDir = join(runtimeRoot, 'src', 'http', 'ui', 'pages');
const publicDir = join(runtimeRoot, 'public');
const runtimePageFilenames = [
  'index.html',
  'playground.html',
  'provider-setup.html',
];

function readUtf8(path: string): string {
  return readFileSync(path, 'utf8');
}

function listDirtyPublicArtifacts(): string[] {
  const result = spawnSync(
    'git',
    [
      'diff',
      '--name-only',
      '--',
      ...runtimePageFilenames.map((filename) => `public/${filename}`),
    ],
    {
      cwd: runtimeRoot,
      encoding: 'utf8',
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr
      || result.stdout
      || result.error?.message
      || 'git diff for runtime UI artifacts failed.',
    );
  }

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

describe('runtime UI build artifacts', () => {
  it('keeps emitted public html aligned with source pages after build', () => {
    for (const pageFilename of runtimePageFilenames) {
      expect(readUtf8(join(publicDir, pageFilename))).toBe(
        readUtf8(join(sourcePagesDir, pageFilename)),
      );
    }

    expect(listDirtyPublicArtifacts()).toEqual([]);
  });
});
