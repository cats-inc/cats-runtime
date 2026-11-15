// Keep this Node test out of Vitest's *.test.* auto-discovery.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectMuseModelCache } from '../scripts/project-muse-model-cache.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/project-muse-model-cache.mjs');

// Synthetic cache in the shape muse-bin 1.4.20 writes; profile and cost fields must not survive.
const CACHE = {
  schema_version: 3,
  provider_id: 'example',
  profile_id: 'private-profile',
  source: 'provider_catalog',
  rows: [
    {
      model_id: 'alpha-1.0', display_label: 'alpha-1.0', provider_id: 'example', profile_id: 'private-profile',
      visibility: 'visible', release_date: '2026-01-02', display_order: null, is_current: true, is_default: false,
      roles: [], context_limit: 1000, output_limit: 100, description: 'Synthetic', cost: { input: 1, output: 2 },
      reasoning_effort_variants: [{ tier: 'low', description: null }, { tier: 'high', description: 'Deep.' }],
      supports_video: false,
    },
    {
      model_id: 'alpha-1.0-contributor', display_label: 'alpha-1.0-contributor', visibility: 'hidden',
      is_default: true, context_limit: null, output_limit: null, cost: { input: 0 }, reasoning_effort_variants: null,
    },
  ],
};

test('projects public fields in cache order and drops profile and cost', () => {
  const projection = projectMuseModelCache(CACHE, { observedOn: '2026-01-03' });
  assert.equal(projection.cacheSource, 'provider_catalog');
  assert.deepEqual(projection.models[0], {
    id: 'alpha-1.0', label: 'alpha-1.0', visibility: 'visible', releaseDate: '2026-01-02',
    description: 'Synthetic', contextLimit: 1000, outputLimit: 100, rawIsDefault: false,
    efforts: [{ tier: 'low', description: undefined }, { tier: 'high', description: 'Deep.' }],
  });
  assert.equal(projection.models[1].rawIsDefault, true);
  assert.equal(projection.models[1].efforts, undefined);
  const text = JSON.stringify(projection);
  for (const leaked of ['private-profile', '"cost"', '"roles"', '"input"', 'supports_video']) {
    assert.equal(text.includes(leaked), false, `${leaked} leaked`);
  }
});

test('rejects a document that is not a Muse model cache', () => {
  assert.throws(() => projectMuseModelCache({ models: [] }), /rows array is missing/);
  assert.throws(() => projectMuseModelCache({ rows: [{ display_label: 'x' }] }), /no model_id/);
});

test('CLI writes the projection to --output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'muse-cache-test-'));
  try {
    const cachePath = join(dir, 'example__p.json');
    const outputPath = join(dir, 'projection.json');
    writeFileSync(cachePath, JSON.stringify(CACHE));
    const result = spawnSync(process.execPath, [SCRIPT, '--cache', cachePath, '--observed-on', '2026-01-03', '--output', outputPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(outputPath, 'utf8')).models.length, 2);
    const missing = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
