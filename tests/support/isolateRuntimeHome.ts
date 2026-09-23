import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { cleanupTempDirWithRetries } from '../tempCleanup.js';

// No unit/HTTP suite may inherit a developer's personal catalog or session roots.
const root = mkdtempSync(join(tmpdir(), 'cats-isolated-test-home-'));
const keys = ['HOME', 'USERPROFILE', 'CATS_RUNTIME_DIR'] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
Object.assign(process.env, { HOME: root, USERPROFILE: root, CATS_RUNTIME_DIR: join(root, '.cats', 'runtime') });
afterAll(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  cleanupTempDirWithRetries(root);
});
