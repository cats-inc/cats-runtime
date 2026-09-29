import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
// This build helper intentionally runs as ESM without a TypeScript wrapper.
// @ts-expect-error JavaScript build helper has no declaration file.
import { collectBundleNotices, writeBundleNotices } from '../scripts/bundle-license-notices.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cats-bundle-licenses-'));
  roots.push(root);
  async function seed(file: string, text: string) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  await seed('entry.js', "import { value } from '@example/included'; console.log(value);");
  await seed('node_modules/@example/included/package.json', JSON.stringify({
    name: '@example/included', version: '1.2.3', license: 'MIT', main: 'lib/index.js',
  }));
  await seed('node_modules/@example/included/lib/package.json', '{"type":"commonjs"}');
  await seed('node_modules/@example/included/lib/index.js', 'exports.value = 42;');
  await seed('node_modules/@example/included/LICENSE', 'Copyright (c) Example upstream\nOriginal permission text\n');
  await seed('node_modules/@example/included/NOTICE.txt', 'Additional upstream attribution\n');
  await seed('node_modules/unused/package.json', '{"name":"unused","version":"9.0.0"}');
  return { root, seed };
}

describe('bundled dependency notices', () => {
  it('retains jpeg-js file-level copyrights and full Apache terms, and rejects unreviewed source changes', async () => {
    const { root } = await fixture();
    const dependency = join(root, 'node_modules/jpeg-js');
    await cp(new URL('../node_modules/jpeg-js/', import.meta.url), dependency, { recursive: true });
    const metafile = { inputs: { 'node_modules/jpeg-js/lib/decoder.js': {}, 'node_modules/jpeg-js/lib/encoder.js': {} } };
    const [pkg] = await collectBundleNotices(metafile, root);
    expect(pkg.license).toBe('BSD-3-Clause AND Apache-2.0');
    const texts = pkg.notices.map((notice: { text: string }) => notice.text).join('\n');
    expect(texts).toContain('Copyright 2011 notmasteryet');
    expect(texts).toContain('Copyright (c) 2008, Adobe Systems Incorporated');
    expect(texts).toContain('Andreas Ritter');
    expect(texts).toContain(await readFile(new URL('../scripts/licenses/Apache-2.0.txt', import.meta.url), 'utf8'));
    await writeFile(join(dependency, 'lib/decoder.js'), 'changed upstream source');
    await expect(collectBundleNotices(metafile, root)).rejects.toThrow('Review jpeg-js file-level licenses');
  });

  it('uses the actual esbuild dependency graph and preserves upstream notices', async () => {
    const { root } = await fixture();
    const outfile = join(root, 'out/index.js');
    const result = await build({ absWorkingDir: root, entryPoints: ['entry.js'], outfile,
      bundle: true, platform: 'node', metafile: true });
    const manifest = await writeBundleNotices({ root, outfile, metafile: result.metafile });
    expect(manifest.packages.map((pkg: { name: string }) => pkg.name)).toEqual(['@example/included']);
    const text = await readFile(join(root, 'out/THIRD-PARTY-NOTICES.txt'), 'utf8');
    expect(text).toContain(await readFile(join(root, 'node_modules/@example/included/LICENSE'), 'utf8'));
    expect(text).toContain('Additional upstream attribution');
    expect(manifest.bundleSha256).toBe(createHash('sha256').update(await readFile(outfile)).digest('hex'));
    expect(manifest.noticesSha256).toBe(createHash('sha256').update(text).digest('hex'));
    const again = await writeBundleNotices({ root, outfile, metafile: result.metafile });
    expect(again).toEqual(manifest);
  });

  it('rejects a bundled dependency with only a license label or empty license text', async () => {
    const { root, seed } = await fixture();
    const metafile = { inputs: { 'node_modules/@example/included/lib/index.js': {} } };
    const license = join(root, 'node_modules/@example/included/LICENSE');
    await rm(license);
    await expect(collectBundleNotices(metafile, root)).rejects.toThrow('no license text');
    await seed('node_modules/@example/included/LICENSE', '  \n');
    await expect(collectBundleNotices(metafile, root)).rejects.toThrow('Empty bundled notice');
  });
});
