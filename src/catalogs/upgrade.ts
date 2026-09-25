import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parse, parseDocument, stringify } from 'yaml';
import { convertLegacyCatalog, type LegacyMigrationScope } from './conversion.js';
import { CatalogUpgradeError } from './errors.js';
import { isUnmodifiedFactorySnapshot } from './legacyFactorySnapshots.js';
import { applyCatalogPatch } from './patch.js';
import { catalogDigest, readCatalogCandidate, resolveCatalogPaths, stableCatalogJson } from './resolver.js';
import { parseCatalogDocument } from './schema.js';
import type { CatalogPaths } from './types.js';

export type CatalogUpgradeStatus =
  | { state: 'not_needed' }
  | { state: 'completed'; fromSchema: 1; toSchema: 2; backupPath: string;
      sourceDigest: string; candidateDigest: string }
  | { state: 'retired'; reason: 'factory_snapshot' | 'converted_factory_snapshot';
      backupPath: string; sourceDigest: string }
  | { state: 'blocked'; message: string };

function readMigrationMapping(packageRoot: string): LegacyMigrationScope[] {
  return JSON.parse(readFileSync(join(packageRoot, 'config', 'catalog-schema1-migration.json'), 'utf8')) as LegacyMigrationScope[];
}

/**
 * True when a schema-2 override is still exactly the automatic conversion of an app-seeded
 * factory snapshot kept in one of its upgrade backups. Any later edit makes this false.
 */
function isConvertedFactorySnapshot(overridePath: string, source: string, mapping: () => LegacyMigrationScope[]): boolean {
  const directory = dirname(overridePath);
  const prefix = `${basename(overridePath)}.`;
  let current: string | undefined;
  for (const name of readdirSync(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith('.bak')) continue;
    let backup: string;
    try { backup = readFileSync(join(directory, name), 'utf8'); } catch { continue; }
    if (!isUnmodifiedFactorySnapshot(backup, directory)) continue;
    try {
      current ??= stableCatalogJson(parse(source));
      if (stableCatalogJson(parse(stringify(convertLegacyCatalog(backup, mapping())))) === current) return true;
    } catch { /* A backup the current converter rejects cannot explain this file. */ }
  }
  return false;
}

/**
 * Backs up the override byte for byte, then removes it so every scope adopts the factory.
 * Uses the same apply lock as patches; a concurrent edit keeps the file and blocks.
 */
function retireFactorySnapshot(overridePath: string, source: string,
  reason: 'factory_snapshot' | 'converted_factory_snapshot'): CatalogUpgradeStatus {
  const lock = `${overridePath}.apply-lock`;
  writeFileSync(lock, String(process.pid), { flag: 'wx' });
  try {
    let current: string;
    try { current = readFileSync(overridePath, 'utf8'); }
    catch (error) {
      // Another cooperating writer already retired it.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'not_needed' };
      throw error;
    }
    if (current !== source) throw new Error('The catalog override changed during retirement; the file was kept. Reload to retry.');
    const backupPath = `${overridePath}.${new Date().toISOString().replace(/[:.]/g, '-')}.${randomUUID()}.bak`;
    writeFileSync(backupPath, source, { flag: 'wx', flush: true });
    rmSync(overridePath);
    return { state: 'retired', reason, backupPath, sourceDigest: catalogDigest(source) };
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Writable Runtime activation only. Read-only projections never call this. */
export function upgradeCatalogOverride(paths: CatalogPaths): CatalogUpgradeStatus {
  const resolved = resolveCatalogPaths(paths);
  try {
    let source: string;
    try { source = readFileSync(resolved.overridePath, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'not_needed' };
      throw error;
    }
    // An unmodified factory copy seeded by an older Desktop is not operator intent. Retire it
    // before conversion would pin every scope, or fail on mappings it never needed.
    if (isUnmodifiedFactorySnapshot(source, dirname(resolved.overridePath))) {
      return retireFactorySnapshot(resolved.overridePath, source, 'factory_snapshot');
    }
    const parsed = parseDocument(source, { uniqueKeys: true });
    if (parsed.errors.length) throw new Error(parsed.errors.map(error => error.message).join('; '));
    const raw: unknown = parsed.toJS({ maxAliasCount: 100 });
    const version = raw && typeof raw === 'object' && 'schema_version' in raw ? raw.schema_version : undefined;
    if (version === 2) {
      // Repairs profiles that an earlier Runtime already converted from such a snapshot.
      return isConvertedFactorySnapshot(resolved.overridePath, source, () => readMigrationMapping(resolved.packageRoot))
        ? retireFactorySnapshot(resolved.overridePath, source, 'converted_factory_snapshot')
        : { state: 'not_needed' };
    }
    if (version !== 1) throw new Error(`Unsupported catalog schema '${String(version)}'; no automatic migration is defined.`);

    const mapping = readMigrationMapping(resolved.packageRoot);
    const candidate = stringify(convertLegacyCatalog(source, mapping), { lineWidth: 120 });
    const sourceDigest = catalogDigest(source);
    try {
      // Apply validates the full effective catalog, locks, backs up, rechecks
      // the source digest and atomically renames. It never guesses model tokens.
      const applied = applyCatalogPatch(resolved, candidate, sourceDigest);
      return { state: 'completed', fromSchema: 1, toSchema: 2,
        backupPath: applied.backupPath!, sourceDigest, candidateDigest: applied.candidateDigest };
    } catch (error) {
      // Another cooperating writer may already have completed the upgrade.
      // Accept only its validated current-format file; never overwrite it.
      try {
        parseCatalogDocument(readFileSync(resolved.overridePath, 'utf8'));
        readCatalogCandidate(resolved);
        return { state: 'not_needed' };
      } catch { /* The old or invalid file remains: surface the original failure. */ }
      throw error;
    }
  } catch (error) {
    const message = (error as NodeJS.ErrnoException).code === 'EEXIST'
      ? 'Another catalog writer or an interrupted write holds the apply lock. Retry reload after the writer completes; do not force-remove an unverified lock.'
      : error instanceof Error ? error.message : String(error);
    throw new CatalogUpgradeError(message, { cause: error });
  }
}
