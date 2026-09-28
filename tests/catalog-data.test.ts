import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCatalogSnapshot, readLocalCatalogProjection, readCatalogCandidate, catalogSnapshotPath,
} from '../src/catalogs/resolver.js';
import { parseCatalogDocument } from '../src/catalogs/schema.js';
import { CatalogStore } from '../src/catalogs/store.js';
import type { CatalogDocument, CatalogPaths, CatalogScope } from '../src/catalogs/types.js';
import { createRuntimeTestPaths } from './support/runtimeTestPaths.js';
import { cleanupTempDirWithRetries } from './tempCleanup.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) cleanupTempDirWithRetries(root); });

function pi(id = 'fixture-original', effort = 'medium'): CatalogScope {
  return { provider: 'pi', backend: 'cli', selection_mode: 'shortlist', models: [{
    id, label: `Visible ${id}`, execution: { provider: 'subscription', model: id,
      fixed_controls: { 'pi.thinking': effort } },
  }] };
}

function doc(...catalogs: CatalogScope[]): CatalogDocument { return { schema_version: 2, catalogs }; }

function fixture(): { paths: CatalogPaths; override: string; factory: string } {
  const root = mkdtempSync(join(tmpdir(), 'cats-catalog-data-'));
  roots.push(root);
  const runtime = createRuntimeTestPaths(root);
  const packageRoot = join(root, 'installation');
  mkdirSync(join(packageRoot, 'config'), { recursive: true });
  mkdirSync(runtime.configDir, { recursive: true });
  const factory = join(packageRoot, 'config', 'curated-model-catalogs.yaml.example');
  writeFileSync(factory, JSON.stringify(doc(pi(), { provider: 'claude', backend: 'api', transport: 'anthropic', selection_mode: 'discovery', models: [] })));
  return { paths: { packageRoot, runtimeRoot: runtime.runtimeDir }, override: runtime.curatedModelCatalogPath, factory };
}

describe('catalog schema and local replacements', () => {
  it('replaces an entire scope, including removal and empty, without changing other scopes', () => {
    const { paths, override } = fixture();
    const baseline = readCatalogCandidate(paths);
    const patched = pi('never-known-in-code', 'high');
    writeFileSync(override, JSON.stringify(doc(patched)));
    const next = readCatalogCandidate(paths);
    expect(next.document.catalogs[0]).toEqual(patched);
    expect(next.document.catalogs[1]).toEqual(baseline.document.catalogs[1]);
    expect(next.origins).toEqual({ 'pi/cli/': 'override', 'claude/api/anthropic': 'factory' });
    expect(next.catalogRevision).not.toBe(baseline.catalogRevision);
    writeFileSync(override, JSON.stringify(doc({ ...patched, models: [] })));
    expect(readCatalogCandidate(paths).document.catalogs[0].models).toEqual([]);
    writeFileSync(override, JSON.stringify(doc()));
    expect(readCatalogCandidate(paths).catalogRevision).toBe(baseline.catalogRevision);
    rmSync(override);
    expect(readCatalogCandidate(paths).catalogRevision).toBe(baseline.catalogRevision);
  });

  it('keeps CLI, ACP, and API scope identities distinct and content revisions deterministic', () => {
    const factory = JSON.stringify(doc(pi()));
    const api: CatalogScope = { provider: 'pi', backend: 'api', transport: 'openai', selection_mode: 'discovery', models: [] };
    const result = createCatalogSnapshot(factory, JSON.stringify(doc(api)));
    expect(result.document.catalogs).toHaveLength(2);
    expect(createCatalogSnapshot(JSON.stringify(doc(pi()), null, 2), JSON.stringify(doc(api))).catalogRevision)
      .toBe(result.catalogRevision);
    expect(Object.isFrozen(result.document.catalogs[0].models[0].execution)).toBe(true);
  });

  it.each([
    ['duplicate scope', () => doc(pi(), pi())],
    ['duplicate model', () => doc({ ...pi(), models: [pi().models[0], pi().models[0]] })],
    ['multiple defaults', () => doc({ ...pi(), models: [
      { ...pi('one').models[0], default: true }, { ...pi('two').models[0], default: true },
    ] })],
    ['unknown binding', () => doc({ ...pi(), models: [{ id: 'x', label: 'x', execution: { model: 'x', fixed_controls: { 'shell.args': '--anything' } } }] })],
    ['wrong scope binding', () => doc({ ...pi(), provider: 'codex' })],
    ['too many shortlist entries', () => doc({ ...pi(), models: Array.from({ length: 7 }, (_, i) => pi(String(i)).models[0]) })],
    ['unsupported schema', () => ({ schema_version: 1, catalogs: [] })],
    ['array masquerading as policy', () => ({ schema_version: 2, catalogs: [{ ...pi(), selection_mode: ['shortlist'] }] })],
    ['array masquerading as backend', () => ({ schema_version: 2, catalogs: [{ ...pi(), backend: ['cli'], transport: 'x' }] })],
    ['unknown executable property', () => doc({ ...pi(), models: [{ ...pi().models[0], execution: { ...pi().models[0].execution, command: 'anything' } }] })],
  ])('rejects the whole candidate: %s', (_name, candidate) => {
    expect(() => parseCatalogDocument(JSON.stringify(candidate()))).toThrow();
  });

  it('rejects duplicate YAML keys and preserves explicit disabled inherited controls', () => {
    expect(() => parseCatalogDocument('schema_version: 2\nschema_version: 2\ncatalogs: []')).toThrow();
    const scope = { ...pi(), shared_controls: [{ key: 'pi.thinking', label: 'Thinking', kind: 'enum' as const,
      scope: 'both' as const, values: [{ value: 'low', label: 'Low' }], default: 'invalid' }] };
    expect(() => parseCatalogDocument(JSON.stringify(doc(scope)))).toThrow();
  });

  it('requires complete model variants and validates even unrestricted presets', () => {
    const scope: CatalogScope = { provider: 'antigravity', backend: 'cli', selection_mode: 'full', models: [{
      id: 'fixture', label: 'Fixture', execution: { model: 'fixture-low' }, controls: [{
        key: 'antigravity.effort', label: 'Effort', kind: 'enum', scope: 'both',
        values: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
      }],
    }] };
    expect(() => parseCatalogDocument(JSON.stringify(doc(scope)))).toThrow(/variants/);
    scope.models[0].execution.variants = [{ when: { 'antigravity.effort': 'low' }, model: 'fixture-low' }];
    expect(() => parseCatalogDocument(JSON.stringify(doc(scope)))).toThrow(/cover/);
    scope.models[0].execution.variants.push({ when: { 'antigravity.effort': 'high' }, model: 'fixture-high' });
    expect(() => parseCatalogDocument(JSON.stringify(doc(scope)))).not.toThrow();
    const presetScope = pi();
    presetScope.presets = [{ id: 'preset', label: 'Preset', availability: 'supported', applicableEntryIds: [], controlDefaults: { 'pi.thinking': 'high' } }];
    expect(() => parseCatalogDocument(JSON.stringify(doc(presetScope)))).toThrow(/not editable/);
  });
});

describe('catalog basis', () => {
  const parse = (scope: CatalogScope) => parseCatalogDocument(JSON.stringify(doc(scope)));
  const withBasis = (scope: CatalogScope, basis: unknown) => ({ ...scope, basis }) as CatalogScope;
  const prefixed: CatalogScope = { provider: 'opencode', backend: 'cli', selection_mode: 'shortlist', models: [
    { id: 'go/model-a', label: 'Model A', execution: { model: 'go/model-a' } },
    { id: 'go/model-b', label: 'Model B', execution: { model: 'go/model-b' } },
  ] };
  const bare: CatalogScope = { provider: 'copilot', backend: 'cli', selection_mode: 'full', models: [
    { id: 'model-c', label: 'Model C', execution: { model: 'model-c' } },
  ] };

  it('accepts a channel that every entry runs through, a plan, or both', () => {
    expect(parse(withBasis(pi(), { channel: { id: 'subscription', label: 'subscription' } })).catalogs[0].basis)
      .toEqual({ channel: { id: 'subscription', label: 'subscription' } });
    expect(parse(withBasis(prefixed, { channel: { id: 'go', label: 'go' }, plan: { label: 'Fixture Plan' } })).catalogs[0].basis)
      .toEqual({ channel: { id: 'go', label: 'go' }, plan: { label: 'Fixture Plan' } });
    expect(parse(withBasis(bare, { plan: { label: 'Fixture Plan' } })).catalogs[0].basis).toEqual({ plan: { label: 'Fixture Plan' } });
    expect(parse(pi()).catalogs[0].basis).toBeUndefined();
  });

  it('rejects a channel that disagrees with an entry, missing fields and empty labels', () => {
    expect(() => parse(withBasis(pi(), { channel: { id: 'other', label: 'other' } })))
      .toThrow(/channel 'other' does not match 'fixture-original', which runs through 'subscription'/);
    const mixed = { ...prefixed, models: [...prefixed.models,
      { id: 'zen/model-d', label: 'Model D', execution: { model: 'zen/model-d' } }] } as CatalogScope;
    expect(() => parse(withBasis(mixed, { channel: { id: 'go', label: 'go' } }))).toThrow(/does not match 'zen\/model-d'/);
    expect(() => parse(withBasis(bare, { channel: { id: 'model-c', label: 'model-c' } }))).toThrow(/'model-c' has no executable channel/);
    expect(() => parse(withBasis(pi(), {}))).toThrow(/needs a channel or a plan/);
    expect(() => parse(withBasis(pi(), { plan: { label: ' ' } }))).toThrow(/plan\.label must be a nonempty/);
    expect(() => parse(withBasis(pi(), { channel: { id: 'subscription' } }))).toThrow(/channel\.label must be a nonempty/);
    expect(() => parse(withBasis(pi(), { plan: { label: 'Plan' }, route: 'x' }))).toThrow(/unknown field 'route'/);
  });
});

describe('activation and read-only projections', () => {
  it('rejects invalid reload atomically, uses last accepted on restart, and checks the displayed revision', () => {
    const { paths, override } = fixture();
    const store = new CatalogStore(paths);
    const original = store.current()!;
    const acceptedFile = readFileSync(catalogSnapshotPath(paths), 'utf8');
    writeFileSync(override, '{ broken:');
    expect(() => store.reload(original.catalogRevision)).toThrow();
    expect(store.current()).toBe(original);
    expect(readFileSync(catalogSnapshotPath(paths), 'utf8')).toBe(acceptedFile);
    expect(new CatalogStore(paths).status().source).toBe('last_accepted');
    writeFileSync(override, JSON.stringify(doc(pi('new-id'))));
    expect(() => store.reload('old-revision')).toThrow(/Catalog changed/);
    const result = store.reload(original.catalogRevision);
    expect(result.affectedScopes).toEqual(['pi/cli/']);
    expect(store.current()?.document.catalogs[0].models[0].id).toBe('new-id');
  });

  it('shows an offline candidate without advancing the Runtime accepted snapshot or creating config', () => {
    const { paths, override } = fixture();
    const projection = readLocalCatalogProjection(paths);
    expect(projection.source).toBe('local_candidate');
    expect(existsSync(override)).toBe(false);
    expect(existsSync(catalogSnapshotPath(paths))).toBe(false);
    const store = new CatalogStore(paths);
    const before = readFileSync(catalogSnapshotPath(paths), 'utf8');
    writeFileSync(override, JSON.stringify(doc(pi('offline-new'))));
    expect(readLocalCatalogProjection(paths).snapshot?.catalogRevision).not.toBe(store.current()?.catalogRevision);
    expect(readFileSync(catalogSnapshotPath(paths), 'utf8')).toBe(before);
  });

  it('does not reuse accepted data from another config path or another factory version', () => {
    const { paths, override, factory } = fixture();
    new CatalogStore(paths);
    writeFileSync(override, 'invalid');
    const alternate = { ...paths, configPath: join(paths.runtimeRoot, 'other', 'providers.yaml'), overridePath: override };
    expect(readLocalCatalogProjection(alternate).source).toBe('unavailable');
    writeFileSync(factory, JSON.stringify(doc(pi('upgraded-factory'))));
    expect(new CatalogStore(paths).status().source).toBe('unavailable');
    expect(readLocalCatalogProjection(paths).source).toBe('unavailable');
    rmSync(override);
    expect(readCatalogCandidate(paths).document.catalogs[0].models[0].id).toBe('upgraded-factory');
  });

  it('keeps local replacements through a factory upgrade while unpatched scopes adopt the new data', () => {
    const { paths, override, factory } = fixture();
    const local = pi('local-only', 'high');
    writeFileSync(override, JSON.stringify(doc(local)));
    new CatalogStore(paths);
    const other: CatalogScope = { provider: 'claude', backend: 'api', transport: 'anthropic', selection_mode: 'discovery',
      models: [{ id: 'factory-new', label: 'Factory new', execution: { model: 'factory-new' } }] };
    writeFileSync(factory, JSON.stringify(doc(pi('upgraded-pi'), other)));
    const upgraded = new CatalogStore(paths);
    expect(upgraded.current()?.document.catalogs).toEqual([local, other]);
    rmSync(override);
    upgraded.reload(upgraded.status().catalogRevision);
    expect(upgraded.current()?.document.catalogs[0].models[0].id).toBe('upgraded-pi');
  });

  it('treats corrupt factory assets as package errors even with an accepted snapshot', () => {
    const { paths, factory } = fixture();
    new CatalogStore(paths);
    writeFileSync(factory, 'invalid');
    expect(() => new CatalogStore(paths)).toThrow(/packaged factory/);
    expect(() => readLocalCatalogProjection(paths)).toThrow(/packaged factory/);
  });

  it('treats an unreadable override as a rejection, and exposes persistence failures without activating', () => {
    const { paths, override } = fixture();
    const store = new CatalogStore(paths);
    const original = store.current()!;
    mkdirSync(override);
    expect(() => store.reload(original.catalogRevision)).toThrow();
    expect(store.current()).toBe(original);
    expect(store.status().diagnostics).not.toHaveLength(0);
    rmSync(override, { recursive: true });
    const acceptedPath = catalogSnapshotPath(paths);
    rmSync(acceptedPath);
    mkdirSync(acceptedPath);
    writeFileSync(override, JSON.stringify(doc(pi('new'))));
    expect(() => store.reload(original.catalogRevision)).toThrow();
    expect(store.current()).toBe(original);
    expect(store.status().diagnostics).not.toHaveLength(0);
  });
});
