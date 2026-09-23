import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { expect, it, onTestFinished } from 'vitest';
import { cleanupTempDirWithRetries } from './tempCleanup.js';

it.each(['missing', 'unsupported'])('refuses apply against %s installed capability before changing any personal bytes', kind => {
  const root = mkdtempSync(join(tmpdir(), 'cats-catalog-capability-'));
  onTestFinished(() => cleanupTempDirWithRetries(root));
  const pkg = join(root, 'old-install'); const profile = join(root, 'profile');
  mkdirSync(pkg); mkdirSync(join(profile, 'config'), { recursive: true });
  const override = join(profile, 'config', 'curated-model-catalogs.yaml');
  const original = 'schema_version: 1\ncatalogs: []\n'; writeFileSync(override, original);
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ type: 'module', ...(kind === 'unsupported' ? { exports: { './catalogs': './catalogs.js' } } : {}) }));
  writeFileSync(join(pkg, 'catalogs.js'), 'export const catalogCapabilities = {schemaVersion:1,bindingVersion:1,localOverrides:true};');
  const result = spawnSync(process.execPath, [resolve('build/runtime/bin/catalogs.js'), 'apply', '--package-root', pkg,
    '--runtime-root', profile, '--file', join(root, 'not-even-read.yaml'), '--expected-digest', 'absent'],
  { encoding: 'utf8', windowsHide: true });
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toMatch(/no files changed/);
  expect(readFileSync(override, 'utf8')).toBe(original);
});
