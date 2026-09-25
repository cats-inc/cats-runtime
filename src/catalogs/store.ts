import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  catalogDigest, catalogSnapshotIdentity, catalogSnapshotPath, readAcceptedCatalog,
  readCatalogCandidate, readCatalogFactory, resolveCatalogPaths, stableCatalogJson,
} from './resolver.js';
import { catalogScopeKey } from './schema.js';
import type { CatalogPaths, CatalogSnapshot } from './types.js';
import { CatalogRevisionConflict, CatalogUpgradeError } from './errors.js';
import { upgradeCatalogOverride, type CatalogUpgradeStatus } from './upgrade.js';

export interface CatalogStatus {
  available: boolean;
  catalogRevision: string | null;
  activationId: string;
  source: 'files' | 'last_accepted' | 'unavailable';
  diagnostics: string[];
  factoryDigest: string;
  overrideDigest: string | null;
  origins: CatalogSnapshot['origins'];
  upgrade: CatalogUpgradeStatus;
}

/** Runtime-owned activation. Hosts import the resolver instead of constructing this store. */
export class CatalogStore {
  private snapshot?: CatalogSnapshot;
  private activationId = randomUUID();
  private diagnostics: string[] = [];
  private source: CatalogStatus['source'] = 'unavailable';
  private upgrade: CatalogUpgradeStatus = { state: 'not_needed' };
  readonly paths: Required<CatalogPaths>;
  private readonly factoryDigest: string;

  constructor(paths: CatalogPaths, private readonly persist = true) {
    this.paths = resolveCatalogPaths(paths);
    this.factoryDigest = catalogDigest(readCatalogFactory(paths).source);
    try {
      this.activate(this.readCandidate());
    } catch (error) {
      this.diagnostics = [error instanceof Error ? error.message : String(error)];
      this.snapshot = readAcceptedCatalog(paths, this.factoryDigest);
      this.source = this.snapshot ? 'last_accepted' : 'unavailable';
    }
  }

  current(): CatalogSnapshot | undefined { return this.snapshot; }

  status(): CatalogStatus {
    return {
      available: Boolean(this.snapshot), catalogRevision: this.snapshot?.catalogRevision ?? null,
      activationId: this.activationId, source: this.source, diagnostics: [...this.diagnostics],
      factoryDigest: this.snapshot?.factoryDigest ?? this.factoryDigest, overrideDigest: this.snapshot?.overrideDigest ?? null,
      origins: { ...this.snapshot?.origins },
      upgrade: { ...this.upgrade },
    };
  }

  reload(expectedRevision: string | null): { catalogRevision: string; activationId: string; affectedScopes: string[] } {
    if (expectedRevision !== (this.snapshot?.catalogRevision ?? null)) {
      throw new CatalogRevisionConflict('Catalog changed; read the current catalog before reloading.');
    }
    let candidate: CatalogSnapshot;
    try { candidate = this.readCandidate(); }
    catch (error) {
      this.diagnostics = [error instanceof Error ? error.message : String(error)];
      throw error;
    }
    const previous = new Map(this.snapshot?.document.catalogs.map(scope => [catalogScopeKey(scope), stableCatalogJson(scope)]));
    const next = new Map(candidate.document.catalogs.map(scope => [catalogScopeKey(scope), stableCatalogJson(scope)]));
    const affectedScopes = [...new Set([...previous.keys(), ...next.keys()])]
      .filter(key => previous.get(key) !== next.get(key));
    try { this.activate(candidate); }
    catch (error) {
      this.diagnostics = [error instanceof Error ? error.message : String(error)];
      throw error;
    }
    return { catalogRevision: candidate.catalogRevision, activationId: this.activationId, affectedScopes };
  }

  private activate(candidate: CatalogSnapshot): void {
    if (this.persist) {
      const path = catalogSnapshotPath(this.paths);
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temp, JSON.stringify({ identity: catalogSnapshotIdentity(this.paths, candidate.factoryDigest), snapshot: candidate }), { encoding: 'utf8', flag: 'wx' });
        renameSync(temp, path);
      } finally { rmSync(temp, { force: true }); }
    }
    this.snapshot = candidate;
    this.activationId = randomUUID();
    this.diagnostics = [];
    this.source = 'files';
  }

  private readCandidate(): CatalogSnapshot {
    if (this.persist) {
      try {
        const upgrade = upgradeCatalogOverride(this.paths);
        // A completed or retired result stays visible for this process after later no-op reloads.
        if (upgrade.state !== 'not_needed' || (this.upgrade.state !== 'completed' && this.upgrade.state !== 'retired')) {
          this.upgrade = upgrade;
        }
      } catch (error) {
        if (error instanceof CatalogUpgradeError) this.upgrade = { state: 'blocked', message: error.message };
        throw error;
      }
    }
    return readCatalogCandidate(this.paths);
  }
}
