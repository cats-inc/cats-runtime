import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = join(scriptsDir, '..');
const runtimeBuildDir = join(runtimeRoot, 'build', 'runtime');
const legacyDistDir = join(runtimeRoot, 'dist');

function removeBuildDir(targetPath) {
  rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

removeBuildDir(runtimeBuildDir);
removeBuildDir(legacyDistDir);
