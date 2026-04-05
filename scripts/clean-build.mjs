import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = join(scriptsDir, '..');
const runtimeBuildDir = join(runtimeRoot, 'build', 'runtime');
const legacyDistDir = join(runtimeRoot, 'dist');

rmSync(runtimeBuildDir, {
  recursive: true,
  force: true,
});

rmSync(legacyDistDir, {
  recursive: true,
  force: true,
});
