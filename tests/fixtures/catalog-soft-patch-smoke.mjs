// Runs against an already installed tarball. No source imports or rebuilds.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [packageRoot, runtimeRoot] = process.argv.slice(2);
const fromPackage = path => import(pathToFileURL(join(packageRoot, path)).href);
const { catalogCapabilities, readLocalCatalogProjection } = await fromPackage('build/runtime/catalogs/index.js');
const { ProviderModelCatalogService } = await fromPackage('build/runtime/core/models/providerModelCatalog.js');
const { resolveProviderSelection } = await fromPackage('build/runtime/core/models/providerSelectionResolution.js');
const { PiProvider } = await fromPackage('build/runtime/backends/cli/providers/pi.js');
assert.deepEqual(catalogCapabilities, { schemaVersion: 2, bindingVersion: 1, localOverrides: true });
const paths = { packageRoot, runtimeRoot };
const configPath = join(runtimeRoot, 'config', 'providers.yaml');
const overridePath = join(runtimeRoot, 'config', 'curated-model-catalogs.yaml');
const candidatePath = join(runtimeRoot, 'candidate.json');
function hashes(directory) {
  const result = {};
  function walk(path, prefix = '') {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(path, entry.name), `${prefix}${entry.name}/`);
      else result[`${prefix}${entry.name}`] = createHash('sha256').update(readFileSync(join(path, entry.name))).digest('hex');
    }
  }
  walk(directory);
  return result;
}
const originalHashes = { build: hashes(join(packageRoot, 'build')), config: hashes(join(packageRoot, 'config')) };
const baseline = readLocalCatalogProjection(paths);
assert.equal(baseline.source, 'local_candidate');
assert.ok(baseline.snapshot);
assert.equal(existsSync(runtimeRoot), false, 'read-only module must not create a profile');
mkdirSync(join(runtimeRoot, 'config'), { recursive: true });
const service = new ProviderModelCatalogService({
  dataDir: join(runtimeRoot, 'data'), configPath,
  providerDefaultTargets: { pi: { backend: 'cli', instance: 'fixture' } },
  providerDefaultInstances: {},
  providerInstances: { pi: { fixture: { id: 'fixture', providerName: 'pi',
    commandConfig: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } } } } },
  providerCommands: {}, remoteProviderCatalog: { api: {}, local: {}, agent: {} },
}, { catalogPaths: paths });
const initial = service.getImmediateAdvancedKnowledge('pi');
const patch = { schema_version: 2, catalogs: [{
  provider: 'pi', backend: 'cli', selection_mode: 'shortlist', models: [{
    id: 'Future.Unknown-ID', label: 'Future model [test-subscription]',
    execution: { model: 'Opaque.CaseSensitive', provider: 'test-subscription', fixed_controls: { 'pi.thinking': 'medium' } },
  }],
}] };
function cli(command, extra = []) {
  const result = spawnSync(process.execPath, [join(packageRoot, 'build/runtime/bin/catalogs.js'), command,
    '--package-root', packageRoot, '--runtime-root', runtimeRoot, '--file', candidatePath, ...extra],
  { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
writeFileSync(candidatePath, JSON.stringify(patch));
const preview = cli('preview');
assert.equal(preview.expectedDigest, null);
cli('apply', ['--expected-digest', 'absent']);
service.reloadCatalogs(initial.catalog.catalogRevision);
const current = service.getImmediateAdvancedKnowledge('pi');
assert.notEqual(current.catalog.catalogRevision, initial.catalog.catalogRevision);
assert.deepEqual(current.catalog.entries.map(row => row.label), ['Future model [test-subscription]']);
const chosen = resolveProviderSelection(current, current.catalog.defaultSelection);
assert.deepEqual(new PiProvider().buildSpawnArgs({ cwd: runtimeRoot, model: chosen.execution.model,
  modelProvider: chosen.execution.provider, modelControls: chosen.resolution.controls }),
['--mode', 'rpc', '--provider', 'test-subscription', '--model', 'Opaque.CaseSensitive', '--thinking', 'medium']);
assert.throws(() => resolveProviderSelection(current, { ...current.catalog.defaultSelection,
  catalogRevision: initial.catalog.catalogRevision }), /Catalog changed/);
const local = readLocalCatalogProjection(paths);
assert.equal(local.snapshot.catalogRevision, current.catalog.catalogRevision);
assert.deepEqual(local.snapshot.document.catalogs.filter(s => s.provider !== 'pi'),
  baseline.snapshot.document.catalogs.filter(s => s.provider !== 'pi'));

// Empty scope, validated rollback, bad candidate and deletion, all on the same build.
writeFileSync(candidatePath, JSON.stringify({ ...patch, catalogs: [{ ...patch.catalogs[0], models: [] }] }));
const emptyPreview = cli('preview');
const emptyApply = cli('apply', ['--expected-digest', emptyPreview.expectedDigest]);
assert.ok(emptyApply.backupPath);
service.reloadCatalogs(current.catalog.catalogRevision);
assert.deepEqual(service.getImmediateAdvancedKnowledge('pi').catalog.entries, []);
writeFileSync(candidatePath, readFileSync(emptyApply.backupPath));
const rollback = cli('preview');
cli('apply', ['--expected-digest', rollback.expectedDigest]);
service.reloadCatalogs(service.getImmediateAdvancedKnowledge('pi').catalog.catalogRevision);
assert.equal(service.getImmediateAdvancedKnowledge('pi').catalog.catalogRevision, current.catalog.catalogRevision);
writeFileSync(overridePath, '{invalid');
assert.throws(() => service.reloadCatalogs(current.catalog.catalogRevision));
assert.equal(service.getImmediateAdvancedKnowledge('pi').catalog.catalogRevision, current.catalog.catalogRevision);
assert.equal(readLocalCatalogProjection(paths).source, 'last_accepted');
rmSync(overridePath);
service.reloadCatalogs(current.catalog.catalogRevision);
assert.equal(service.getImmediateAdvancedKnowledge('pi').catalog.catalogRevision, initial.catalog.catalogRevision);
assert.deepEqual({ build: hashes(join(packageRoot, 'build')), config: hashes(join(packageRoot, 'config')) }, originalHashes);
console.log(JSON.stringify({ installedVersion: JSON.parse(readFileSync(join(packageRoot, 'package.json'))).version,
  factoryDigest: baseline.snapshot.factoryDigest, verified: 'fixed installed build; data-only unknown ID, binding, empty, rollback, invalid, remove' }));
