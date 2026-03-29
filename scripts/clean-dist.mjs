import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = join(scriptsDir, '..');
const distDir = join(runtimeRoot, 'dist');

rmSync(distDir, {
  recursive: true,
  force: true,
});
