import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { convertLegacyCatalog, type LegacyMigrationScope } from '../src/catalogs/conversion.js';
import { catalogSnapshotPath, readLocalCatalogProjection } from '../src/catalogs/resolver.js';
import { CatalogStore } from '../src/catalogs/store.js';
import type { CatalogPaths } from '../src/catalogs/types.js';
import { cleanupTempDirWithRetries } from './tempCleanup.js';

// Inject I/O failures portably; Windows permission bits cannot simulate a read-only directory.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), renameSync: vi.fn(actual.renameSync) };
});
const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const legacy = fs.readFileSync('docs/research/fixtures/catalog-schema1/factory-before-cutover.json', 'utf8');
const mapping = JSON.parse(fs.readFileSync('config/catalog-schema1-migration.json', 'utf8')) as LegacyMigrationScope[];
const roots: string[] = [];

afterEach(() => {
  vi.mocked(fs.writeFileSync).mockReset();
  vi.mocked(fs.renameSync).mockReset();
  for (const root of roots.splice(0)) cleanupTempDirWithRetries(root);
});

function fixture(source: string | undefined = legacy) {
  const root = fs.mkdtempSync(join(tmpdir(), 'cats-catalog-upgrade-'));
  roots.push(root);
  const runtimeRoot = join(root, 'runtime');
  const overridePath = join(runtimeRoot, 'config', 'curated-model-catalogs.yaml');
  fs.mkdirSync(dirname(overridePath), { recursive: true });
  if (source !== undefined) fs.writeFileSync(overridePath, source);
  const paths: CatalogPaths = { packageRoot: process.cwd(), runtimeRoot, overridePath };
  const backups = () => fs.readdirSync(dirname(overridePath)).filter(name => name.endsWith('.bak'));
  return { paths, overridePath, backups };
}

describe('catalog upgrades at writable Runtime activation', () => {
  it('backs up an existing full profile, preserves its choices, and upgrades only once across reload and restart', () => {
    const { paths, overridePath, backups } = fixture();
    const store = new CatalogStore(paths);
    const status = store.status();
    expect(status).toMatchObject({ available: true, source: 'files', diagnostics: [],
      upgrade: { state: 'completed', fromSchema: 1, toSchema: 2 } });
    if (status.upgrade.state !== 'completed') throw new Error('Expected upgrade');
    expect(fs.readFileSync(status.upgrade.backupPath, 'utf8')).toBe(legacy);
    const converted = fs.readFileSync(overridePath, 'utf8');
    const document = parse(converted);
    expect(document).toEqual(convertLegacyCatalog(legacy, mapping));
    expect(document.catalogs).toHaveLength(16);
    expect(document.catalogs.reduce((count: number, scope: { models: unknown[] }) => count + scope.models.length, 0)).toBe(87);
    expect(fs.existsSync(catalogSnapshotPath(paths))).toBe(true);
    store.reload(status.catalogRevision);
    const restarted = new CatalogStore(paths);
    expect(restarted.status()).toMatchObject({ available: true, catalogRevision: status.catalogRevision,
      upgrade: { state: 'not_needed' } });
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(converted);
    expect(backups()).toHaveLength(1);
  });

  it('keeps read-only projections and nonpersistent stores free of upgrade writes', () => {
    const { paths, overridePath, backups } = fixture();
    expect(readLocalCatalogProjection(paths).source).toBe('unavailable');
    expect(new CatalogStore(paths, false).status().available).toBe(false);
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(legacy);
    expect(fs.existsSync(catalogSnapshotPath(paths))).toBe(false);
    expect(backups()).toEqual([]);
  });

  it.each(['missing', 'current'] as const)('does not seed or rewrite a %s override', (kind) => {
    const source = stringify({ schema_version: 2, catalogs: [] });
    const { paths, overridePath, backups } = fixture(source);
    if (kind === 'missing') fs.rmSync(overridePath);
    expect(new CatalogStore(paths).status()).toMatchObject({ available: true, upgrade: { state: 'not_needed' } });
    expect(backups()).toEqual([]);
    if (kind === 'missing') expect(fs.existsSync(overridePath)).toBe(false);
    else expect(fs.readFileSync(overridePath, 'utf8')).toBe(source);
  });

  it.each([
    ['unknown model', () => { const value = JSON.parse(legacy); value.catalogs[0].models[0].name = 'unreviewed-model'; return JSON.stringify(value); }],
    ['unknown field', () => { const value = JSON.parse(legacy); value.catalogs[0].unrecognized = true; return JSON.stringify(value); }],
    ['future schema', () => JSON.stringify({ schema_version: 3, catalogs: [] })],
    ['duplicate key', () => 'schema_version: 1\nschema_version: 1\ncatalogs: []'],
  ])('retains the original and reports %s before creating a backup', (_name, source) => {
    const original = source();
    const { paths, overridePath, backups } = fixture(original);
    const store = new CatalogStore(paths);
    expect(store.status()).toMatchObject({ available: false, source: 'unavailable',
      upgrade: { state: 'blocked' } });
    expect(store.status().diagnostics[0]).toMatch(/Catalog upgrade blocked/);
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(original);
    expect(backups()).toEqual([]);
    // An explicit retry validates and upgrades a corrected source without restarting the Runtime.
    fs.writeFileSync(overridePath, legacy);
    store.reload(null);
    expect(store.status()).toMatchObject({ available: true, diagnostics: [], upgrade: { state: 'completed' } });
    expect(backups()).toHaveLength(1);
  });

  it('keeps an accepted snapshot when an unknown legacy file replaces the current override', () => {
    const { paths, overridePath } = fixture();
    const accepted = new CatalogStore(paths).status().catalogRevision;
    const unknown = JSON.parse(legacy);
    unknown.catalogs[0].models[0].name = 'unreviewed-model';
    const original = JSON.stringify(unknown);
    fs.writeFileSync(overridePath, original);
    expect(new CatalogStore(paths).status()).toMatchObject({ available: true, source: 'last_accepted',
      catalogRevision: accepted, upgrade: { state: 'blocked' } });
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(original);
  });

  it('does not steal an existing apply lock, and can retry after its owner releases it', () => {
    const { paths, overridePath, backups } = fixture();
    const lock = `${overridePath}.apply-lock`;
    fs.writeFileSync(lock, 'test-owned-lock');
    const store = new CatalogStore(paths);
    expect(store.status()).toMatchObject({ available: false, upgrade: { state: 'blocked' } });
    expect(store.status().diagnostics[0]).toMatch(/interrupted write holds the apply lock/);
    expect(fs.readFileSync(lock, 'utf8')).toBe('test-owned-lock');
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(legacy);
    expect(backups()).toEqual([]);
    fs.rmSync(lock);
    store.reload(null);
    expect(store.status().available).toBe(true);
  });

  it.each(['backup', 'temporary file', 'rename'])('retains old bytes on %s failure and cleans only its own temporary files', (stage) => {
    const { paths, overridePath, backups } = fixture();
    vi.mocked(fs.writeFileSync).mockImplementation((file, ...args) => {
      if (stage === 'backup' && String(file).endsWith('.bak')
        || stage === 'temporary file' && String(file).endsWith('.tmp')) throw new Error(`Simulated ${stage} failure`);
      return actualFs.writeFileSync(file, ...args);
    });
    if (stage === 'rename') vi.mocked(fs.renameSync).mockImplementation(() => { throw new Error('Simulated rename failure'); });
    const store = new CatalogStore(paths);
    expect(store.status()).toMatchObject({ available: false, upgrade: { state: 'blocked' } });
    expect(store.status().diagnostics[0]).toContain(`Simulated ${stage} failure`);
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(legacy);
    expect(fs.readdirSync(dirname(overridePath)).filter(name => /\.tmp$|\.apply-lock$/.test(name))).toEqual([]);
    for (const backup of backups()) expect(fs.readFileSync(join(dirname(overridePath), backup), 'utf8')).toBe(legacy);
  });

  it('retains the committed conversion and original backup if later snapshot persistence fails', () => {
    const { paths, overridePath, backups } = fixture();
    vi.mocked(fs.writeFileSync).mockImplementation((file, ...args) => {
      if (String(file).startsWith(`${catalogSnapshotPath(paths)}.`)) throw new Error('Snapshot disk unavailable');
      return actualFs.writeFileSync(file, ...args);
    });
    const store = new CatalogStore(paths);
    expect(store.status()).toMatchObject({ available: false, upgrade: { state: 'completed' } });
    expect(store.status().diagnostics[0]).toBe('Snapshot disk unavailable');
    expect(parse(fs.readFileSync(overridePath, 'utf8')).schema_version).toBe(2);
    expect(backups()).toHaveLength(1);
    expect(fs.readFileSync(join(dirname(overridePath), backups()[0]), 'utf8')).toBe(legacy);
    vi.mocked(fs.writeFileSync).mockReset();
    expect(new CatalogStore(paths).status()).toMatchObject({ available: true, upgrade: { state: 'not_needed' } });
    expect(backups()).toHaveLength(1);
  });

  it('does not overwrite a concurrent edit between validation and replacement', () => {
    const { paths, overridePath } = fixture();
    const edited = `${legacy}\n`;
    vi.mocked(fs.writeFileSync).mockImplementation((file, ...args) => {
      actualFs.writeFileSync(file, ...args);
      if (String(file).endsWith('.tmp')) actualFs.writeFileSync(overridePath, edited);
    });
    const store = new CatalogStore(paths);
    expect(store.status()).toMatchObject({ available: false, upgrade: { state: 'blocked' } });
    expect(store.status().diagnostics[0]).toContain('Override changed during apply');
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(edited);
  });

  it('accepts a valid schema-2 file already applied by a concurrent writer without replacing it', () => {
    const { paths, overridePath, backups } = fixture();
    const converted = convertLegacyCatalog(legacy, mapping);
    converted.catalogs[0].models[0].label = 'Concurrent writer label';
    const edited = stringify(converted);
    vi.mocked(fs.writeFileSync).mockImplementation((file, ...args) => {
      actualFs.writeFileSync(file, ...args);
      if (String(file).endsWith('.apply-lock')) actualFs.writeFileSync(overridePath, edited);
    });
    const store = new CatalogStore(paths);
    expect(store.status()).toMatchObject({ available: true, upgrade: { state: 'not_needed' } });
    expect(fs.readFileSync(overridePath, 'utf8')).toBe(edited);
    expect(backups()).toEqual([]);
  });
});
