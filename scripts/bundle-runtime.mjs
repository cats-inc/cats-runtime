import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'build', 'runtime', 'index.js')],
  bundle: true,
  outfile: resolve(root, 'build', 'runtime-bundle', 'index.js'),
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [
    // yaml's published CJS build uses dynamic require("process") when bundled to ESM.
    'yaml',
    // Browser automation is optional and large; keep it out of the hot startup bundle.
    'playwright-core',
  ],
});
