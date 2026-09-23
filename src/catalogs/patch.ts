import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { catalogDigest, createCatalogSnapshot, readCatalogFactory, resolveCatalogPaths } from './resolver.js';
import { CatalogRevisionConflict } from './store.js';
import type { CatalogPaths, CatalogSnapshot } from './types.js';

function readOverride(path: string): string | undefined {
  try { return readFileSync(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

export function previewCatalogPatch(paths: CatalogPaths, candidate: string): {
  expectedDigest: string | null; candidateDigest: string; snapshot: CatalogSnapshot;
} {
  const resolved = resolveCatalogPaths(paths);
  const current = readOverride(resolved.overridePath);
  return {
    expectedDigest: current === undefined ? null : catalogDigest(current),
    candidateDigest: catalogDigest(candidate),
    snapshot: createCatalogSnapshot(readCatalogFactory(paths).source, candidate),
  };
}

/** Explicit mutation boundary. Callers must verify the selected installation capability first. */
export function applyCatalogPatch(paths: CatalogPaths, candidate: string, expectedDigest: string | null): {
  backupPath: string | null; candidateDigest: string; catalogRevision: string;
} {
  const resolved = resolveCatalogPaths(paths);
  const preview = previewCatalogPatch(paths, candidate);
  if (expectedDigest !== preview.expectedDigest) throw new CatalogRevisionConflict('Override changed since preview; preview again.');
  mkdirSync(dirname(resolved.overridePath), { recursive: true });
  const lock = `${resolved.overridePath}.apply-lock`;
  // Cooperating writers serialize; the digest is checked again immediately before replacement.
  writeFileSync(lock, String(process.pid), { flag: 'wx' });
  const temp = `${resolved.overridePath}.${randomUUID()}.tmp`;
  let backupPath: string | null = null;
  try {
    const current = readOverride(resolved.overridePath);
    if ((current === undefined ? null : catalogDigest(current)) !== expectedDigest) {
      throw new CatalogRevisionConflict('Override changed since preview; preview again.');
    }
    if (current !== undefined) {
      backupPath = `${resolved.overridePath}.${new Date().toISOString().replace(/[:.]/g, '-')}.${randomUUID()}.bak`;
      writeFileSync(backupPath, current, { flag: 'wx' });
    }
    writeFileSync(temp, candidate, { flag: 'wx' });
    const latest = readOverride(resolved.overridePath);
    if ((latest === undefined ? null : catalogDigest(latest)) !== expectedDigest) {
      throw new CatalogRevisionConflict('Override changed during apply; original file retained.');
    }
    renameSync(temp, resolved.overridePath);
    return { backupPath, candidateDigest: preview.candidateDigest, catalogRevision: preview.snapshot.catalogRevision };
  } finally {
    rmSync(temp, { force: true });
    rmSync(lock, { force: true });
  }
}
