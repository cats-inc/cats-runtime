#!/usr/bin/env node

// Projects Muse Code's own account model cache (`<museHome>/model-catalog/<provider>__<profile>.json`,
// written by the CLI after sign-in) to the public model fields a catalog refresh compares. Starts
// no CLI. Use it when MSP `model/list` answers from `bundledCatalog` although the account is signed
// in (muse-bin 1.4.20 did so with an empty list). Costs, roles and capability flags are left out.
//
//   node project-muse-model-cache.mjs --cache <file> [--observed-on YYYY-MM-DD] [--output <file>]
//
// The cache's `is_default` becomes `rawIsDefault`: it has pointed at a -contributor row, so it is
// never a Cats default (see the Muse reference). `visibility: hidden` rows are kept and marked;
// the /model picker shows only the visible ones.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const text = (value) => (typeof value === 'string' && value.trim() ? value : undefined);
const count = (value) => (Number.isInteger(value) && value > 0 ? value : undefined);

function projectVariants(variants) {
  if (!Array.isArray(variants)) return undefined;
  return variants.map((variant) => {
    if (!text(variant?.tier)) throw new Error('A reasoning effort variant without a tier cannot be projected.');
    return { tier: variant.tier, description: text(variant.description) };
  });
}

export function projectMuseModelCache(cache, { observedOn } = {}) {
  if (!cache || typeof cache !== 'object' || !Array.isArray(cache.rows)) {
    throw new Error('Not a Muse model cache: the rows array is missing.');
  }
  return {
    observedOn,
    sourceClass: 'CLI-owned-account-cache',
    cacheSchemaVersion: cache.schema_version,
    cacheSource: text(cache.source),
    providerId: text(cache.provider_id),
    source: '<museHome>/model-catalog cache written by the signed-in CLI; credentials, costs and profile identifiers omitted.',
    models: cache.rows.map((row) => {
      if (!text(row?.model_id)) throw new Error('A Muse cache row has no model_id.');
      return {
        id: row.model_id,
        label: text(row.display_label),
        visibility: text(row.visibility),
        releaseDate: text(row.release_date),
        description: text(row.description),
        contextLimit: count(row.context_limit),
        outputLimit: count(row.output_limit),
        rawIsDefault: row.is_default === true,
        efforts: projectVariants(row.reasoning_effort_variants),
      };
    }),
  };
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { cache: { type: 'string' }, 'observed-on': { type: 'string' }, output: { type: 'string' } },
  });
  if (!values.cache) throw new Error('Pass --cache <museHome>/model-catalog/<provider>__<profile>.json.');
  const observedOn = values['observed-on'] ?? new Date().toISOString().slice(0, 10);
  const projection = projectMuseModelCache(JSON.parse(readFileSync(values.cache, 'utf8')), { observedOn });
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
