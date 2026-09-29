// Collect the original notices of dependencies actually consumed by esbuild.
// Imported by bundle-runtime.mjs; no network access or dependency installation.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isNotice = (name) => /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(name);

// jpeg-js's package LICENSE omits the decoder's Apache license and Adobe's
// encoder notice. Verify the reviewed source bytes before extracting headers.
// A dependency update must re-review this recipe, not silently reuse old text.
async function jpegNotices(directory, metadata) {
  if (metadata.version !== '0.4.4') throw new Error('Review jpeg-js file-level licenses for this version');
  const notices = [];
  for (const [file, expected, boundary] of [
    ['lib/decoder.js', 'a3f175fd6f62d142aad94d3bd90f3a30be4e076baf9b6a6fa31c8e84d9d4aa9f', 'var JpegImage ='],
    ['lib/encoder.js', '00bde8df2517eca556669ab6fc27b414e9ba3fc52a0a71e1e37ec7c5f19c3d34', 'var btoa ='],
  ]) {
    const bytes = await readFile(join(directory, file));
    if (digest(bytes) !== expected) throw new Error(`Review jpeg-js file-level licenses: changed ${file}`);
    const source = bytes.toString('utf8');
    const end = source.indexOf(boundary);
    if (end < 0) throw new Error(`Missing jpeg-js notice boundary: ${file}`);
    const text = source.slice(0, end);
    notices.push({ file: `${file} (original header)`, sha256: digest(Buffer.from(text)), text });
  }
  const bytes = await readFile(new URL('./licenses/Apache-2.0.txt', import.meta.url));
  if (digest(bytes) !== 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30') {
    throw new Error('Apache-2.0 license text differs from the reviewed original');
  }
  notices.push({ file: 'Apache-2.0.txt (https://www.apache.org/licenses/LICENSE-2.0.txt)',
    sha256: digest(bytes), text: bytes.toString('utf8') });
  return notices;
}

async function packageForInput(input) {
  let directory = dirname(input);
  while (directory !== dirname(directory)) {
    try {
      const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      // Published packages can have an inner package.json containing only type.
      if (typeof metadata.name === 'string' && typeof metadata.version === 'string') {
        return { directory, metadata };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (basename(directory) === 'node_modules') break;
    directory = dirname(directory);
  }
  throw new Error(`Cannot identify bundled dependency: ${input}`);
}

export async function collectBundleNotices(metafile, root) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const absolute = resolve(root, input);
    if (!absolute.split(sep).includes('node_modules')) continue;
    const dependency = await packageForInput(absolute);
    packages.set(dependency.directory, dependency.metadata);
  }
  const records = [];
  for (const [directory, metadata] of packages) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && isNotice(entry.name))
      .map((entry) => entry.name).sort();
    if (!files.some((file) => /^(?:licen[cs]e|copying)(?:[.-].*)?$/i.test(file))) {
      throw new Error(`Bundled dependency ${metadata.name}@${metadata.version} has no license text`);
    }
    const notices = [];
    for (const file of files) {
      const bytes = await readFile(join(directory, file));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!text.trim()) throw new Error(`Empty bundled notice: ${metadata.name}/${file}`);
      notices.push({ file, sha256: digest(bytes), text });
    }
    if (metadata.name === 'jpeg-js') notices.push(...await jpegNotices(directory, metadata));
    records.push({ name: metadata.name, version: metadata.version,
      license: metadata.name === 'jpeg-js' ? 'BSD-3-Clause AND Apache-2.0' : metadata.license ?? null, notices });
  }
  records.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
  return records;
}

export async function writeBundleNotices({ metafile, root, outfile }) {
  const packages = await collectBundleNotices(metafile, root);
  const text = 'Third-party notices for the bundled Cats Runtime dependencies.\n'
    + 'External packages retain their notices in their own package directories.\n\n'
    + packages.map((pkg) => `${pkg.name}@${pkg.version}\n${'='.repeat(72)}\n`
      + pkg.notices.map((notice) => `${notice.file}\n${notice.text}\n`).join('\n')).join('\n');
  const manifest = { schemaVersion: 1, bundleSha256: digest(await readFile(outfile)),
    noticesSha256: digest(Buffer.from(text)),
    packages: packages.map(({ notices, ...pkg }) => ({ ...pkg,
      notices: notices.map(({ text: _text, ...notice }) => notice) })) };
  await writeFile(join(dirname(outfile), 'THIRD-PARTY-NOTICES.txt'), text);
  await writeFile(join(dirname(outfile), 'THIRD-PARTY-NOTICES.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
