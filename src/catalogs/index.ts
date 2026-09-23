// Stable read-only package boundary. Importing this file starts no services or probes.
export * from './types.js';
export * from './schema.js';
export {
  catalogDigest, stableCatalogJson, resolveCatalogPaths, mergeCatalogDocuments,
  readCatalogFactory, readCatalogCandidate, readLocalCatalogProjection, findCatalogScope,
} from './resolver.js';
export { CATALOG_BINDINGS, CATALOG_BINDING_VERSION } from './bindings.js';

export const catalogCapabilities = Object.freeze({ schemaVersion: 2, bindingVersion: 1, localOverrides: true });
