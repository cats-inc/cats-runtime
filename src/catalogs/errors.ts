export class CatalogRevisionConflict extends Error {
  readonly code = 'catalog_revision_conflict';
}

/** No accepted data exists; retrying a read cannot repair the configuration. */
export class CatalogUnavailableError extends Error {
  readonly code = 'catalog_unavailable';

  constructor() {
    super('Provider catalog configuration needs attention. Inspect /providers/catalogs, apply a valid catalog, and reload.');
    this.name = 'CatalogUnavailableError';
  }
}

export class CatalogUpgradeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`Catalog upgrade blocked: ${message}`, options);
    this.name = 'CatalogUpgradeError';
  }
}
