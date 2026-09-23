#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { stringify } from 'yaml';
import { readLocalCatalogProjection, resolveCatalogPaths } from '../catalogs/resolver.js';
import { convertLegacyCatalog, type LegacyMigrationScope } from '../catalogs/conversion.js';
import { applyCatalogPatch, previewCatalogPatch } from '../catalogs/patch.js';

const usage = 'cats-runtime-catalog <inspect|validate|preview|apply|convert> --package-root <installed root> --runtime-root <profile root> [--config <providers.yaml>] [--file <candidate>] [--expected-digest <SHA256|absent>] [--output <new file>]';
async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    'package-root': { type: 'string' }, 'runtime-root': { type: 'string' }, config: { type: 'string' },
    file: { type: 'string' }, 'expected-digest': { type: 'string' }, output: { type: 'string' },
    'migration-map': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) { console.log(usage); return; }
  if (!values['package-root'] || !values['runtime-root']) throw new Error(usage);
  const paths = resolveCatalogPaths({ packageRoot: resolve(values['package-root']), runtimeRoot: resolve(values['runtime-root']),
    ...(values.config ? { configPath: resolve(values.config) } : {}) });
  // Inspect the selected installed package, not the shell's default CLI or a home profile.
  const manifest = JSON.parse(readFileSync(join(paths.packageRoot, 'package.json'), 'utf8'));
  const exported = manifest.exports?.['./catalogs'];
  const modulePath = typeof exported === 'string' ? exported : exported?.import;
  if (typeof modulePath !== 'string' || !modulePath.startsWith('./') || modulePath.includes('..')) throw new Error('Selected installation does not expose catalog capabilities; no files changed.');
  const installed = await import(pathToFileURL(join(paths.packageRoot, modulePath)).href);
  if (installed.catalogCapabilities?.schemaVersion !== 2 || installed.catalogCapabilities?.bindingVersion !== 1
    || installed.catalogCapabilities?.localOverrides !== true) throw new Error('Selected installation does not support this catalog schema/binding version; no files changed.');
  const command = positionals[0];
  if (command === 'inspect') { console.log(JSON.stringify(readLocalCatalogProjection(paths), null, 2)); return; }
  if (!values.file) throw new Error('--file is required');
  const source = readFileSync(resolve(values.file), 'utf8');
  if (command === 'convert') {
    if (!values.output) throw new Error('--output must name a new preview file; conversion never replaces the source');
    const mappingPath = values['migration-map'] ? resolve(values['migration-map']) : join(paths.packageRoot, 'config', 'catalog-schema1-migration.json');
    const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as LegacyMigrationScope[];
    const converted = stringify(convertLegacyCatalog(source, mapping), { lineWidth: 120 });
    const preview = previewCatalogPatch(paths, converted);
    writeFileSync(resolve(values.output), converted, { flag: 'wx' });
    console.log(JSON.stringify({ output: resolve(values.output), expectedDigest: preview.expectedDigest,
      candidateDigest: preview.candidateDigest, catalogRevision: preview.snapshot.catalogRevision,
      message: 'All converted scopes replace factory scopes in full. Review the preview before apply.' }, null, 2));
    return;
  }
  if (command === 'validate' || command === 'preview') {
    console.log(JSON.stringify(previewCatalogPatch(paths, source), null, 2)); return;
  }
  if (command === 'apply') {
    if (!values['expected-digest']) throw new Error('--expected-digest from preview is required (use absent for a missing file)');
    console.log(JSON.stringify(applyCatalogPatch(paths, source, values['expected-digest'] === 'absent' ? null : values['expected-digest']), null, 2));
    return;
  }
  throw new Error(usage);
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
