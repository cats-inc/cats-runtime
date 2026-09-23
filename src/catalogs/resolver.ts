import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { CATALOG_BINDINGS, CATALOG_BINDING_VERSION } from './bindings.js';
import { catalogScopeKey, parseCatalogDocument, validateCatalogDocument } from './schema.js';
import type { CatalogDocument, CatalogPaths, CatalogProjection, CatalogScope, CatalogSnapshot } from './types.js';

export function catalogDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableCatalogJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCatalogJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, v]) => `${JSON.stringify(key)}:${stableCatalogJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function freezeCatalog<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) freezeCatalog(nested);
  }
  return value;
}

export function resolveCatalogPaths(paths: CatalogPaths): Required<CatalogPaths> {
  for (const [key, path] of Object.entries(paths)) {
    if (path !== undefined && !isAbsolute(path)) throw new Error(`Catalog ${key} must be absolute`);
  }
  const runtimeRoot = resolve(paths.runtimeRoot);
  const packageRoot = resolve(paths.packageRoot);
  const configPath = resolve(paths.configPath ?? join(runtimeRoot, 'config', 'providers.yaml'));
  return {
    runtimeRoot, packageRoot, configPath,
    overridePath: resolve(paths.overridePath ?? join(dirname(configPath), 'curated-model-catalogs.yaml')),
    factoryPath: resolve(paths.factoryPath ?? join(packageRoot, 'config', 'curated-model-catalogs.yaml.example')),
  };
}

export function mergeCatalogDocuments(factory: CatalogDocument, override?: CatalogDocument): CatalogDocument {
  const scopes = new Map(factory.catalogs.map(scope => [catalogScopeKey(scope), scope]));
  for (const scope of override?.catalogs ?? []) scopes.set(catalogScopeKey(scope), scope);
  return validateCatalogDocument({ schema_version: 2, catalogs: [...scopes.values()] });
}

export class CatalogFactoryError extends Error {}

export function readCatalogFactory(paths: CatalogPaths): { source: string; document: CatalogDocument } {
  const resolved = resolveCatalogPaths(paths);
  try {
    const source = readFileSync(resolved.factoryPath, 'utf8');
    return { source, document: parseCatalogDocument(source) };
  } catch (error) {
    throw new CatalogFactoryError(`Invalid or missing packaged factory catalog: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function createCatalogSnapshot(factorySource: string, overrideSource?: string): CatalogSnapshot {
  const factory = parseCatalogDocument(factorySource);
  const override = overrideSource === undefined ? undefined : parseCatalogDocument(overrideSource);
  const document = mergeCatalogDocuments(factory, override);
  const overrideKeys = new Set(override?.catalogs.map(catalogScopeKey));
  return freezeCatalog({
    schemaVersion: 2,
    catalogRevision: catalogDigest(stableCatalogJson(document)),
    factoryDigest: catalogDigest(factorySource),
    overrideDigest: overrideSource === undefined ? null : catalogDigest(overrideSource),
    origins: Object.fromEntries(document.catalogs.map(scope => [
      catalogScopeKey(scope), overrideKeys.has(catalogScopeKey(scope)) ? 'override' : 'factory',
    ])),
    document,
  });
}

export function readCatalogCandidate(paths: CatalogPaths): CatalogSnapshot {
  const resolved = resolveCatalogPaths(paths);
  const factory = readCatalogFactory(resolved);
  let override: string | undefined;
  try { override = readFileSync(resolved.overridePath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return createCatalogSnapshot(factory.source, override);
}

export function catalogSnapshotPath(paths: CatalogPaths): string {
  const resolved = resolveCatalogPaths(paths);
  const identity = catalogDigest(stableCatalogJson({ config: resolved.configPath, override: resolved.overridePath }));
  return join(resolved.runtimeRoot, 'data', 'provider-model-catalog', `accepted-${identity}.json`);
}

export function catalogSnapshotIdentity(paths: CatalogPaths, factoryDigest: string): string {
  const resolved = resolveCatalogPaths(paths);
  return catalogDigest(stableCatalogJson({
    runtimeRoot: resolved.runtimeRoot, configPath: resolved.configPath,
    overridePath: resolved.overridePath, factoryDigest, schema: 2,
    bindings: CATALOG_BINDINGS, bindingVersion: CATALOG_BINDING_VERSION,
  }));
}

export function readAcceptedCatalog(paths: CatalogPaths, factoryDigest: string): CatalogSnapshot | undefined {
  try {
    const saved = JSON.parse(readFileSync(catalogSnapshotPath(paths), 'utf8'));
    if (saved.identity !== catalogSnapshotIdentity(paths, factoryDigest)) return undefined;
    const snapshot = saved.snapshot as CatalogSnapshot;
    const document = validateCatalogDocument(snapshot.document);
    if (snapshot.schemaVersion !== 2 || snapshot.factoryDigest !== factoryDigest
      || snapshot.catalogRevision !== catalogDigest(stableCatalogJson(document))) return undefined;
    const keys = document.catalogs.map(catalogScopeKey);
    if (!snapshot.origins || Object.keys(snapshot.origins).length !== keys.length
      || keys.some(key => !['factory', 'override'].includes(snapshot.origins[key]))) return undefined;
    return freezeCatalog(structuredClone(snapshot));
  } catch {
    return undefined;
  }
}

/** Read-only: neither activates the candidate nor persists a snapshot. */
export function readLocalCatalogProjection(paths: CatalogPaths): CatalogProjection {
  const factory = readCatalogFactory(paths); // A broken package is never a local-patch fallback.
  try {
    return { source: 'local_candidate', snapshot: readCatalogCandidate(paths), diagnostics: [] };
  } catch (error) {
    const snapshot = readAcceptedCatalog(paths, catalogDigest(factory.source));
    return {
      source: snapshot ? 'last_accepted' : 'unavailable',
      ...(snapshot ? { snapshot } : {}),
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export function findCatalogScope(
  snapshot: CatalogSnapshot | undefined,
  target: { providerName: string; backend: CatalogScope['backend']; remoteInstance?: { transport: string } },
): CatalogScope | undefined {
  const key = catalogScopeKey({ provider: target.providerName, backend: target.backend,
    ...(target.backend !== 'cli' ? { transport: target.remoteInstance?.transport } : {}) });
  return snapshot?.document.catalogs.find(scope => catalogScopeKey(scope) === key);
}
