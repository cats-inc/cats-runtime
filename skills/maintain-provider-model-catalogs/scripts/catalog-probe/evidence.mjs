// Turns one probed scope of a snapshot into a committable evidence fixture: the projected rows
// plus the provenance the skill's evidence rules ask for (command, version, time, source class,
// account scope, completeness and what the source can prove). Agents write it under
// docs/research/fixtures/<cli>-<version>/ and cite it from catalog notes.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redactVisibleText } from '../normalize-picker-paste.mjs';

const MEMBERSHIP_MEANING = {
  complete: 'The command lists what the picker offers; an absent row still needs picker confirmation before removal.',
  partial: 'The command is known to omit picker rows; absence here is not evidence of withdrawal.',
  superset: 'Static data that can list more than the picker; it does not prove a row is offered.',
  family: 'Only model families, not the exact parameterized variant.',
};

const ACCOUNT_SCOPE = {
  'machine-readable': "The CLI's existing sign-in on the probing machine. No identity is recorded.",
  'static-artifact': 'Data in the installed package. Not account-resolved.',
};

const STILL_PICKER = 'A model (default) marker, picker descriptions, picker order, and every field not listed under '
  + 'authoritativeFor still need picker evidence.';

function scopeKey({ provider, backend, transport }) {
  return `${provider}/${backend}${transport ? `/${transport}` : ''}`;
}

/** Finds snapshot sources by `provider`, `provider/backend` or the full scope key. */
export function selectSnapshotSources(snapshot, selector) {
  const wanted = selector.split(',').map((part) => part.trim()).filter(Boolean);
  if (wanted.length === 0) throw new Error('--scope needs at least one provider or scope key.');
  return wanted.map((name) => {
    const matches = (snapshot.sources ?? []).filter((source) => {
      const key = scopeKey(source);
      return key === name || `${source.provider}/${source.backend}` === name || source.provider === name;
    });
    if (matches.length !== 1) {
      throw new Error(matches.length === 0
        ? `The snapshot has no scope "${name}". It has: ${(snapshot.sources ?? []).map(scopeKey).join(', ')}.`
        : `"${name}" matches several scopes; use the full key: ${matches.map(scopeKey).join(', ')}.`);
    }
    return matches[0];
  });
}

function redactDeep(value, kinds) {
  if (typeof value === 'string') {
    const { text, redactions } = redactVisibleText(value);
    for (const kind of redactions) kinds.add(kind);
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, kinds));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, kinds)]));
  }
  return value;
}

export function evidenceDirectoryName(source) {
  if (!source.cliVersion) return `${source.provider}-unknown-version`;
  return source.versionKind === 'build' ? `${source.provider}-build-${source.cliVersion}` : `${source.provider}-${source.cliVersion}`;
}

/** Builds the fixture document. `ids` keeps only those rows and fails on any it cannot find. */
export function buildEvidence({ snapshot, source, ids = null }) {
  const key = scopeKey(source);
  if (source.status === 'unavailable' || source.status === 'error') {
    throw new Error(`${key} has no listed rows to record (${source.status}: ${source.reason ?? 'unknown'}).`);
  }
  const membership = source.coverage?.membership ?? 'none';
  if (membership === 'none') {
    throw new Error(`${key} has no read-only model list. Record its picker capture instead.`);
  }
  let rows = source.models ?? [];
  if (ids) {
    const missing = ids.filter((id) => !rows.some((row) => row.id === id));
    if (missing.length) throw new Error(`Not in the ${key} snapshot: ${missing.join(', ')}.`);
    rows = ids.map((id) => rows.find((row) => row.id === id));
  }
  const kinds = new Set();
  const coverage = source.coverage ?? {};
  const document = {
    kind: 'cats-catalog-probe-evidence',
    schemaVersion: 1,
    provider: source.provider,
    backend: source.backend,
    transport: source.transport ?? null,
    command: source.command,
    sourceClass: source.sourceClass,
    cliVersion: source.cliVersion ?? null,
    versionSource: source.versionSource ?? null,
    observedAt: snapshot.createdAt ?? null,
    host: { platform: snapshot.host?.platform ?? null, arch: snapshot.host?.arch ?? null },
    accountScope: ACCOUNT_SCOPE[source.sourceClass] ?? 'Not recorded.',
    status: source.status,
    ...(source.reason ? { reason: source.reason } : {}),
    ...(source.message ? { message: redactDeep(source.message, kinds) } : {}),
    completeness: { membership, meaning: MEMBERSHIP_MEANING[membership] ?? membership },
    authoritativeFor: {
      ids: true,
      label: Boolean(coverage.label),
      efforts: coverage.efforts ?? false,
      effortDefault: Boolean(coverage.effortDefault),
    },
    stillNeedsPicker: STILL_PICKER,
    selection: ids ? { ids } : `all ${rows.length} rows`,
    ...(source.sourceEvidence ? { sourceEvidence: redactDeep(source.sourceEvidence, kinds) } : {}),
    models: redactDeep(rows, kinds),
  };
  document.redaction = {
    method: 'Projected public model fields only; no raw output, account identifier, price, endpoint or login text. '
      + 'String values passed through the skill redaction helper.',
    redactions: [...kinds].sort(),
    reviewBeforeCommit: 'Check names, paths and provider-specific identifiers by hand; the helper catches only common shapes.',
  };
  return document;
}

/** Writes the fixture and refuses to overwrite one unless `force`. Returns its path. */
export function writeEvidence({ document, source, fixturesRoot, name = 'model-list.probe', force = false }) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error(`--name "${name}" must be a plain file stem.`);
  const path = join(fixturesRoot, evidenceDirectoryName(source), `${name}.redacted.json`);
  if (existsSync(path) && !force) throw new Error(`${path} already exists. Pass --force to replace it.`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
  return path;
}
