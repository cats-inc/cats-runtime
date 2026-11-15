#!/usr/bin/env node

// Projects Grok Build's own model cache (`~/.grok/models_cache.json`, rewritten by `grok models`)
// to the public model fields a catalog refresh compares: id, name, description, context windows
// and per-model reasoning efforts. Starts no CLI. Each cache entry also holds an API key, endpoint,
// headers and the account identity; only the allowlisted fields below are copied, so none of those
// can reach the output.
//
//   node project-grok-models-cache.mjs [--cache <file>] [--observed-on YYYY-MM-DD] [--output <file>]
//
// The cache's own `default: true` on an effort is kept as `rawDefault`; it is the CLI's starting
// value, not picker evidence of a Cats default (see the Grok reference).

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const text = (value) => (typeof value === 'string' && value.trim() ? value : undefined);
const count = (value) => (Number.isInteger(value) && value > 0 ? value : undefined);

function projectEffort(effort) {
  if (!effort || typeof effort !== 'object' || !text(effort.value)) {
    throw new Error('A reasoning effort without a value cannot be projected.');
  }
  return {
    value: effort.value,
    label: text(effort.label),
    description: text(effort.description),
    rawDefault: effort.default === true,
  };
}

/** One cache entry's `info` object to its public fields, in the cache's own effort order. */
export function projectModel(key, info) {
  if (!info || typeof info !== 'object') throw new Error(`Cache entry ${key} has no info object.`);
  const id = text(info.id) ?? text(info.model) ?? key;
  const windows = Array.isArray(info.context_windows) ? info.context_windows.filter((w) => count(w)) : undefined;
  return {
    id,
    label: text(info.name),
    description: text(info.description),
    hidden: info.hidden === true ? true : undefined,
    contextWindow: count(info.context_window),
    contextWindows: windows?.length ? windows : undefined,
    efforts: (Array.isArray(info.reasoning_efforts) ? info.reasoning_efforts : []).map(projectEffort),
  };
}

/** The whole cache document to a fixture body; `models` keeps the cache's key order. */
export function projectGrokModelsCache(cache, { observedOn } = {}) {
  if (!cache || typeof cache !== 'object' || !cache.models || typeof cache.models !== 'object') {
    throw new Error('Not a Grok models cache: the models object is missing.');
  }
  const entries = Array.isArray(cache.models)
    ? cache.models.map((entry, index) => [String(index), entry])
    : Object.entries(cache.models);
  return {
    observedOn,
    sourceClass: 'CLI-owned-account-cache',
    version: text(cache.grok_version),
    fetchedAt: text(cache.fetched_at),
    source: '~/.grok/models_cache.json after grok models; identity, auth, keys, headers and endpoints omitted.',
    models: entries.map(([key, entry]) => projectModel(key, entry?.info ?? entry)),
  };
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      cache: { type: 'string', default: join(homedir(), '.grok', 'models_cache.json') },
      'observed-on': { type: 'string' },
      output: { type: 'string' },
    },
  });
  const observedOn = values['observed-on'] ?? new Date().toISOString().slice(0, 10);
  const projection = projectGrokModelsCache(JSON.parse(readFileSync(values.cache, 'utf8')), { observedOn });
  const body = `${JSON.stringify(projection, null, 2)}\n`;
  if (values.output) writeFileSync(values.output, body, 'utf8');
  else process.stdout.write(body);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
