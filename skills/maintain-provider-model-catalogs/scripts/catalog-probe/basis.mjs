// Which captured basis of a target the probe compares a live list with (SPEC-045 FR-8). A target
// (provider/backend/transport) can hold several catalog scopes, one per channel, region or plan.
// A refresh names the basis it updates and never edits another, so the comparison has to say
// which basis it used and how that was decided.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MARKER_TOKEN = /^[a-z0-9][a-z0-9._-]*$/;
const MARKER_DIMENSIONS = ['region', 'plan', 'channel'];

export function targetKey({ provider, backend, transport }) {
  return `${provider}/${backend}${transport ? `/${transport}` : ''}`;
}

export function sameTarget(left, right) {
  return left.provider === right.provider
    && left.backend === right.backend
    && (left.transport ?? null) === (right.transport ?? null);
}

/** A scope's key: the target, plus `#<id>` for a basis with an id. */
export function basisKey(scope) {
  return `${targetKey(scope)}${scope.basis?.id ? `#${scope.basis.id}` : ''}`;
}

/** Strips a `#<id>` basis suffix, so a report key also names its target. */
export function targetOfKey(key) {
  return key.split('#')[0];
}

/** The target's scopes in data order; the first is its default basis. */
export function targetScopes(catalogs, target) {
  return (catalogs ?? []).filter((scope) => sameTarget(scope, target));
}

/** The same label Runtime shows: channel, region and plan labels joined with " · ". */
export function basisLabel(scope) {
  const basis = scope?.basis;
  return [basis?.channel?.label, basis?.region?.label, basis?.plan?.label].filter(Boolean).join(' · ');
}

function readTextOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Kimi Code records the sign-in region in `<KIMI_CODE_HOME>/region`, a one-line non-secret token
 * such as `global` or `mainland-cn`. Only that file is read, never the credentials (ADR-038).
 */
export function readKimiRegion(kimiHome, readText = readTextOrNull) {
  const region = readText(join(kimiHome, 'region'))?.trim() ?? '';
  return MARKER_TOKEN.test(region) ? region : null;
}

/**
 * The sign-in markers of one CLI on this machine, read only from CLI output or non-secret files.
 * Kimi is the only source so far; every other provider reports none.
 */
export function detectSignInMarker(provider, { env = process.env, home = homedir(), readText = readTextOrNull } = {}) {
  if (provider === 'kimi') {
    const region = readKimiRegion(env.KIMI_CODE_HOME?.trim() || join(home, '.kimi-code'), readText);
    return region ? { region } : null;
  }
  return null;
}

function markerMatches(scope, marker, dimensions) {
  return dimensions.every((dimension) => scope.basis?.[dimension]?.id === marker[dimension]);
}

/**
 * Parses `--basis`: `<provider>=<id>` pairs, or a bare `<id>` when exactly one provider is
 * selected. `first` names the target's first basis, which may have no id.
 */
export function parseBasisOption(value, providers) {
  if (!value) return new Map();
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  const requested = new Map();
  for (const part of parts) {
    const at = part.indexOf('=');
    if (at < 0) {
      if (parts.length !== 1 || providers.length !== 1) {
        throw new Error('--basis <id> needs exactly one selected provider; otherwise use --basis <provider>=<id>.');
      }
      requested.set(providers[0], part);
      continue;
    }
    const provider = part.slice(0, at).trim();
    const id = part.slice(at + 1).trim();
    if (!provider || !id) throw new Error(`--basis "${part}" needs <provider>=<id>.`);
    if (!providers.includes(provider)) throw new Error(`--basis names ${provider}, which this run does not include.`);
    requested.set(provider, id);
  }
  return requested;
}

function findRequested(scopes, id) {
  return scopes.find((scope) => scope.basis?.id === id) ?? (id === 'first' ? scopes[0] : undefined);
}

/** Fails before any CLI starts when a requested basis is not in the catalog. */
export function assertRequestedBases(requested, catalogs, sources) {
  for (const [provider, id] of requested) {
    const targets = sources.filter((source) => source.provider === provider);
    for (const target of targets) {
      const scopes = targetScopes(catalogs, target);
      if (!findRequested(scopes, id)) {
        const known = scopes.map((scope) => scope.basis?.id ?? 'first').join(', ') || 'none';
        throw new Error(`${targetKey(target)} has no basis "${id}". Known: ${known}.`);
      }
    }
  }
}

/**
 * Chooses the basis to compare: a requested id, then the one basis the sign-in marker matches,
 * then the first. Returns the scope (or null) and a description of the choice:
 * - how: `requested`, `detected`, `first` or `only`;
 * - confirmed: false when another basis on the same channel could be the signed-in one, or when
 *   the marker names a region, plan or channel that no captured basis covers;
 * - mismatch: the marker values no captured basis covers, when the catalog records that kind.
 * Bases on another channel are never candidates: the probe lists the chosen scope's channel.
 */
export function chooseBasis(scopes, { requested, marker } = {}) {
  if (scopes.length === 0) return { scope: null, basis: null };
  const describe = (scope, how, extra = {}) => ({
    scope,
    basis: {
      id: scope.basis?.id ?? null,
      index: scopes.indexOf(scope),
      count: scopes.length,
      label: basisLabel(scope),
      how,
      confirmed: true,
      ...(marker ? { marker } : {}),
      ...extra,
    },
  });
  if (requested !== undefined) {
    const scope = findRequested(scopes, requested);
    if (!scope) return { scope: null, basis: { id: requested, how: 'requested', missing: true, count: scopes.length } };
    return describe(scope, 'requested', { requested });
  }
  const dimensions = MARKER_DIMENSIONS.filter((dimension) => marker?.[dimension]);
  if (dimensions.length) {
    const matches = scopes.filter((scope) => markerMatches(scope, marker, dimensions));
    if (matches.length === 1) return describe(matches[0], 'detected');
    // The catalog records this kind of basis, but none for this sign-in: a basis not captured.
    const recorded = dimensions.filter((dimension) => scopes.some((scope) => scope.basis?.[dimension]?.id));
    if (matches.length === 0 && recorded.length) {
      const mismatch = Object.fromEntries(recorded.map((dimension) => [dimension, marker[dimension]]));
      return describe(scopes[0], scopes.length === 1 ? 'only' : 'first', { confirmed: false, mismatch });
    }
  }
  const first = scopes[0];
  const sameChannel = scopes.filter((scope) => (scope.basis?.channel?.id ?? null) === (first.basis?.channel?.id ?? null));
  return describe(first, scopes.length === 1 ? 'only' : 'first', { confirmed: sameChannel.length === 1 });
}
