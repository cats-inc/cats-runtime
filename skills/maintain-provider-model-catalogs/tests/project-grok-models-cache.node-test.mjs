// Keep this Node test out of Vitest's *.test.* auto-discovery.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectGrokModelsCache } from '../scripts/project-grok-models-cache.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/project-grok-models-cache.mjs');

// Synthetic cache: the real file keys each model by id and stores credentials beside `info`.
const CACHE = {
  fetched_at: '2026-01-02T03:04:05Z',
  grok_version: '9.9.9',
  auth_method: 'oauth',
  origin: 'https://example.invalid/v1/models',
  identity: { email: 'someone@example.invalid', team: 'team-123' },
  etag: 'W/"abc"',
  models: {
    'alpha-2': {
      api_key: 'sk-synthetic-secret',
      env_key: 'SYNTHETIC_KEY',
      api_base_url: 'https://example.invalid/v1',
      info: {
        id: 'alpha-2',
        model: 'alpha-2',
        name: 'Alpha 2',
        description: 'Synthetic frontier model',
        base_url: 'https://example.invalid/v1',
        extra_headers: { Authorization: 'Bearer synthetic' },
        context_window: 256000,
        context_windows: [256000, 500000],
        reasoning_efforts: [
          { id: 'high', value: 'high', label: 'High', description: 'Thorough.', default: true },
          { id: 'low', value: 'low', label: 'Low', description: 'Fast.', default: false },
        ],
      },
    },
    'beta-1': {
      api_key: 'sk-another-secret',
      info: { id: 'beta-1', name: 'Beta 1', description: null, context_window: 128000, hidden: true },
    },
  },
};

test('projects public model fields in cache order and drops credentials', () => {
  const projection = projectGrokModelsCache(CACHE, { observedOn: '2026-01-02' });
  assert.equal(projection.version, '9.9.9');
  assert.deepEqual(projection.models.map((model) => model.id), ['alpha-2', 'beta-1']);
  assert.deepEqual(projection.models[0], {
    id: 'alpha-2',
    label: 'Alpha 2',
    description: 'Synthetic frontier model',
    hidden: undefined,
    contextWindow: 256000,
    contextWindows: [256000, 500000],
    efforts: [
      { value: 'high', label: 'High', description: 'Thorough.', rawDefault: true },
      { value: 'low', label: 'Low', description: 'Fast.', rawDefault: false },
    ],
  });
  assert.equal(projection.models[1].hidden, true);
  assert.equal(projection.models[1].description, undefined);
  assert.deepEqual(projection.models[1].efforts, []);
  const text = JSON.stringify(projection);
  for (const secret of ['sk-', 'Bearer', 'example.invalid', 'someone@', 'team-123', 'SYNTHETIC_KEY', 'oauth']) {
    assert.equal(text.includes(secret), false, `${secret} leaked`);
  }
});

test('rejects a document that is not a models cache', () => {
  assert.throws(() => projectGrokModelsCache({ grok_version: '1' }), /models object is missing/);
  assert.throws(
    () => projectGrokModelsCache({ models: { x: { info: { reasoning_efforts: [{ label: 'High' }] } } } }),
    /without a value/,
  );
});

test('CLI writes the projection to --output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'grok-cache-test-'));
  try {
    const cachePath = join(dir, 'models_cache.json');
    const outputPath = join(dir, 'projection.json');
    writeFileSync(cachePath, JSON.stringify(CACHE));
    const result = spawnSync(process.execPath, [SCRIPT, '--cache', cachePath, '--observed-on', '2026-01-02', '--output', outputPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const written = JSON.parse(readFileSync(outputPath, 'utf8'));
    assert.equal(written.observedOn, '2026-01-02');
    assert.equal(written.models.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
