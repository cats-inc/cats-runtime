import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import { convertLegacyCatalog, type LegacyMigrationScope } from './conversion.js';
import { CatalogUpgradeError } from './errors.js';
import { applyCatalogPatch } from './patch.js';
import { catalogDigest, readCatalogCandidate, resolveCatalogPaths } from './resolver.js';
import { parseCatalogDocument } from './schema.js';
import type { CatalogPaths } from './types.js';

export type CatalogUpgradeStatus =
  | { state: 'not_needed' }
  | { state: 'completed'; fromSchema: 1; toSchema: 2; backupPath: string;
      sourceDigest: string; candidateDigest: string }
  | { state: 'blocked'; message: string };

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
    const parsed = parseDocument(source, { uniqueKeys: true });
    if (parsed.errors.length) throw new Error(parsed.errors.map(error => error.message).join('; '));
    const raw: unknown = parsed.toJS({ maxAliasCount: 100 });
    const version = raw && typeof raw === 'object' && 'schema_version' in raw ? raw.schema_version : undefined;
    if (version === 2) return { state: 'not_needed' };
    if (version !== 1) throw new Error(`Unsupported catalog schema '${String(version)}'; no automatic migration is defined.`);

    const mapping = JSON.parse(readFileSync(join(resolved.packageRoot, 'config', 'catalog-schema1-migration.json'), 'utf8')) as LegacyMigrationScope[];
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
