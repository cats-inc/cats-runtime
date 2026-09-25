import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ProviderModelCatalogService } from '../src/core/models/providerModelCatalog.js';
import { resolveProviderSelection } from '../src/core/models/providerSelectionResolution.js';
import { buildProviderAdvancedKnowledge } from '../src/core/models/providerAdvancedKnowledge.js';
import { createCatalogSnapshot, readCatalogFactory } from '../src/catalogs/resolver.js';
import { convertLegacyCatalog, type LegacyMigrationScope } from '../src/catalogs/conversion.js';
import { applyCatalogPatch, previewCatalogPatch } from '../src/catalogs/patch.js';
import type { CatalogScope } from '../src/catalogs/types.js';
import type { ProviderTargetDescriptor } from '../src/core/providerCatalog.js';
import { PiProvider } from '../src/backends/cli/providers/pi.js';
import { GooseProvider } from '../src/backends/cli/providers/goose.js';
import { createRuntimeTestEnv, createRuntimeTestPaths, ensureRuntimeTestDirs } from './support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from './tempCleanup.js';

const packageRoot = resolve('.');
const factory = readCatalogFactory({ packageRoot, runtimeRoot: resolve('tmp/unused-readonly-profile') });
const snapshot = createCatalogSnapshot(factory.source);
function target(scope: CatalogScope): ProviderTargetDescriptor {
  return { providerName: scope.provider, backend: scope.backend, instanceId: 'fixture', defaultTarget: true,
    ...(scope.backend !== 'cli' ? { remoteInstance: { id: 'fixture', providerName: scope.provider,
      backend: scope.backend, transport: scope.transport } } : {}) } as ProviderTargetDescriptor;
}
function knowledge(scope: CatalogScope) {
  const current = createCatalogSnapshot(JSON.stringify({ schema_version: 2, catalogs: [scope] }));
  return buildProviderAdvancedKnowledge(target(scope), {
    provider: scope.provider, backend: scope.backend, instance: 'fixture', source: 'static', cache: null,
    catalogRevision: current.catalogRevision, defaultModel: scope.models.find(m => m.default)?.id ?? null,
    models: scope.models.map(({ id, label, default: isDefault }) => ({ id, label, default: isDefault })), warnings: [],
  }, { snapshot: current });
}

describe('factory and executable catalog projections', () => {
  it.each(snapshot.document.catalogs)('projects every entry and explicit binding in $provider/$backend/$transport', scope => {
    const k = knowledge(scope);
    expect(k.catalog.entries.map(e => e.label)).toEqual(scope.models.map(e => e.label));
    for (const model of scope.models) {
      const selected = resolveProviderSelection(k, { entryId: model.id, entryMode: 'explicit', catalogRevision: k.catalog.catalogRevision });
      expect(selected.resolution.controls).toMatchObject(model.execution.fixed_controls ?? {});
      expect(selected.execution.model).toBe(model.execution.variants?.[0]?.model ?? model.execution.model);
      expect(selected.execution.provider).toBe(model.execution.variants?.[0]?.provider ?? model.execution.provider);
      expect(selected.resolution.catalogRevision).toBe(k.catalog.catalogRevision);
      for (const variant of model.execution.variants ?? []) {
        expect(resolveProviderSelection(k, { entryId: model.id, entryMode: 'explicit', controls: variant.when }).execution.model).toBe(variant.model);
      }
      expect(k.catalog.entries.find(e => e.id === model.id)?.default).toBe(model.default);
    }
  });

  it('preserves model-specific descriptions, defaults, and no-default Muse menus', () => {
    const grok = knowledge(snapshot.document.catalogs.find(s => s.provider === 'grok')!);
    const high = (id: string) => grok.catalog.entries.find(e => e.id === id)
      ?.controls?.[0].values?.find(v => typeof v === 'object' && v.value === 'high');
    expect(high('grok-4.7')).toMatchObject({ description: 'Thorough reasoning and quality. Recommended.' });
    expect(high('grok-4.7-build-fast')).toMatchObject({ description: 'Thorough reasoning and quality. Recommended.' });
    expect(high('grok-4.6')).toMatchObject({ description: expect.stringContaining('Higher implementation') });
    expect(high('grok-4.5')).toMatchObject({ description: expect.stringContaining('Highest implementation') });
    const muse = knowledge(snapshot.document.catalogs.find(s => s.provider === 'muse')!);
    expect(muse.catalog.entries.map(e => e.controls?.[0].values?.length)).toEqual([6, 6, 5, 5]);
    expect(muse.catalog.entries.every(e => !e.default && !e.controlDefaults)).toBe(true);
    expect(muse.catalog.controls.flatMap(c => c.values ?? []).every(v => typeof v !== 'object' || !v.label.includes('(default)'))).toBe(true);
  });

  it('validates controls against the selected entry and omits request-only session defaults', () => {
    const control = { key: 'ollama.temperature', label: 'Temperature', kind: 'number' as const,
      scope: 'both' as const, minimum: 0, maximum: 2, default: 1 };
    const k = knowledge({ provider: 'ollama', backend: 'local', transport: 'ollama', selection_mode: 'discovery', models: [
      { id: 'wide', label: 'Wide', execution: { model: 'wide' }, controls: [control] },
      { id: 'narrow', label: 'Narrow', execution: { model: 'narrow' }, controls: [{ ...control, maximum: 1 }] },
      { id: 'request', label: 'Request', execution: { model: 'request' }, controls: [{ ...control, scope: 'request' }] },
    ] });
    expect(() => resolveProviderSelection(k, { entryId: 'narrow', entryMode: 'explicit', controls: { 'ollama.temperature': 1.5 } })).toThrow();
    expect(resolveProviderSelection(k, { entryId: 'request', entryMode: 'explicit' }).resolution.controls).toEqual({});
  });

  it('changes UI and actual adapter arguments with a data-only unknown ID and rejects stale revisions', ({ onTestFinished }) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-data-invocation-'));
    onTestFinished(() => cleanupTempDirWithRetries(root));
    const paths = createRuntimeTestPaths(root); ensureRuntimeTestDirs(paths);
    const config = { ...paths, providerDefaultTargets: { pi: { backend: 'cli', instance: 'fixture' } },
      providerDefaultInstances: {}, providerInstances: { pi: { fixture: { id: 'fixture', providerName: 'pi',
        commandConfig: { path: 'pi', runner: 'auto', runtime: { mode: 'native' } } } } },
      providerCommands: {}, remoteProviderCatalog: { api: {}, local: {}, agent: {} } };
    const run = vi.fn(() => { throw new Error('Managed catalog must not probe'); });
    const service = new ProviderModelCatalogService(config as never, { env: createRuntimeTestEnv(root), piModelDiscoveryRunner: { run } });
    const before = service.getImmediateAdvancedKnowledge('pi');
    const original = resolveProviderSelection(before, { entryId: before.catalog.entries[0].id, entryMode: 'explicit' });
    writeFileSync(paths.curatedModelCatalogPath, JSON.stringify({ schema_version: 2, catalogs: [{
      provider: 'pi', backend: 'cli', selection_mode: 'shortlist', models: [{ id: 'only-in-test/Case.Sensitive',
        label: 'A completely new label [subscription]', execution: { model: 'Case.Sensitive', provider: 'subscription-new', fixed_controls: { 'pi.thinking': 'high' } } }],
    }] }));
    service.reloadCatalogs(before.catalog.catalogRevision!);
    const next = service.getImmediateAdvancedKnowledge('pi');
    expect(next.catalog.entries.map(e => e.label)).toEqual(['A completely new label [subscription]']);
    const selected = resolveProviderSelection(next, next.catalog.defaultSelection!);
    expect(new PiProvider().buildSpawnArgs({ cwd: root, model: selected.execution.model,
      modelProvider: selected.execution.provider, modelControls: selected.resolution.controls })).toEqual([
      '--mode', 'rpc', '--provider', 'subscription-new', '--model', 'Case.Sensitive', '--thinking', 'high',
    ]);
    expect(() => resolveProviderSelection(next, { ...next.catalog.defaultSelection!, catalogRevision: before.catalog.catalogRevision })).toThrow(/Catalog changed/);
    expect(original.resolution.controls).toEqual({ 'pi.thinking': 'medium' });
    expect(run).not.toHaveBeenCalled();
    expect(new GooseProvider().buildSpawnArgs({ cwd: root, model: 'Unlisted.Model', modelProvider: 'new-subscription',
      modelControls: { 'goose.thinking_effort': 'off' } }).join(' ')).toContain('Unlisted.Model-none');
  });
});

describe('explicit conversion and safe patch apply', () => {
  it('converts all frozen legacy scopes without a normalizer or dropping scopes', () => {
    const source = readFileSync('tests/fixtures/catalog-schema1/factory-before-cutover.json', 'utf8');
    const mapping = JSON.parse(readFileSync('config/catalog-schema1-migration.json', 'utf8')) as LegacyMigrationScope[];
    const converted = convertLegacyCatalog(source, mapping);
    expect(converted.catalogs).toHaveLength(16);
    for (const scope of converted.catalogs) {
      // Migration preserves the old profile; later factory refreshes must not rewrite its choices.
      const expected = mapping.find(m => m.scope.provider === scope.provider && m.scope.backend === scope.backend)!;
      expect(scope.models.map(m => [m.id, m.label, m.execution])).toEqual(expected.entries.map(({ model: m }) => [m.id, m.label, { ...m.execution, fixed_controls: m.execution.fixed_controls ?? {} }]));
    }
    const changed = JSON.parse(source); changed.catalogs[0].models[0].name = 'unknown';
    expect(() => convertLegacyCatalog(JSON.stringify(changed), mapping)).toThrow(/Unresolved model/);
  });

  it('checks the previous digest, backs up, replaces atomically, and rejects invalid input', ({ onTestFinished }) => {
    const root = mkdtempSync(join(tmpdir(), 'cats-patch-apply-'));
    onTestFinished(() => cleanupTempDirWithRetries(root));
    const paths = { packageRoot, runtimeRoot: root }; const candidate = JSON.stringify({ schema_version: 2, catalogs: [] });
    const preview = previewCatalogPatch(paths, candidate);
    expect(preview.expectedDigest).toBeNull();
    expect(applyCatalogPatch(paths, candidate, null).backupPath).toBeNull();
    const before = previewCatalogPatch(paths, candidate);
    expect(() => applyCatalogPatch(paths, candidate, null)).toThrow(/changed/);
    const result = applyCatalogPatch(paths, candidate, before.expectedDigest);
    expect(readFileSync(result.backupPath!, 'utf8')).toBe(candidate);
    expect(() => applyCatalogPatch(paths, '{}', before.expectedDigest)).toThrow();
    expect(readFileSync(join(root, 'config', 'curated-model-catalogs.yaml'), 'utf8')).toBe(candidate);
  });
});
