#!/usr/bin/env node

// Projects `opencode models --verbose --pure` output to public id/name/providerID rows. That
// output is not one JSON document: each model is an ID line followed by a JSON metadata object.
// Reads a file or stdin and starts no CLI. Only the three public fields are printed; API URLs,
// costs and other metadata stay out of the projection.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Length of the JSON object starting at `text[start]`, honoring braces inside strings. */
function objectLength(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index - start + 1;
    }
  }
  throw new Error('The verbose output ends inside a model metadata object.');
}

export function parseVerboseModels(text) {
  const rows = [];
  let cursor = 0;
  while (cursor < text.length) {
    const lineEnd = text.indexOf('\n', cursor);
    const line = text.slice(cursor, lineEnd < 0 ? text.length : lineEnd).trim();
    cursor = lineEnd < 0 ? text.length : lineEnd + 1;
    if (!line) continue;
    if (line.startsWith('{')) throw new Error('Found a metadata object without a preceding model ID line.');

    const objectStart = text.indexOf('{', cursor);
    if (objectStart < 0 || text.slice(cursor, objectStart).trim()) {
      throw new Error(`Model ID line "${line}" is not followed by a metadata object.`);
    }
    const length = objectLength(text, objectStart);
    const metadata = JSON.parse(text.slice(objectStart, objectStart + length));
    rows.push({ id: line, name: metadata.name ?? null, providerID: metadata.providerID ?? null });
    cursor = objectStart + length;
  }
  return rows;
}

/**
 * `ids` reports each requested ID as found or `missing: true`; `match` lists every row whose id or
 * name contains the text, case-insensitively, so an absence check covers renamed IDs too.
 */
export function projectOpenCodeModels(text, { ids = [], match } = {}) {
  const rows = parseVerboseModels(text);
  const needle = match?.toLowerCase();
  return {
    total: rows.length,
    ...(ids.length > 0
      ? { selected: ids.map((id) => rows.find((row) => row.id === id) ?? { id, missing: true }) }
      : { models: rows }),
    ...(needle
      ? { matching: rows.filter((row) => `${row.id}\n${row.name ?? ''}`.toLowerCase().includes(needle)) }
      : {}),
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      ids: { type: 'string' },
      match: { type: 'string' },
    },
  });
  const text = readFileSync(values.input ?? 0, 'utf8');
  const ids = (values.ids ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  process.stdout.write(`${JSON.stringify(projectOpenCodeModels(text, { ids, match: values.match }), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
