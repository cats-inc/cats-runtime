// Keep this Node test out of Vitest's *.test.* auto-discovery.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseVerboseModels, projectOpenCodeModels } from '../scripts/project-opencode-models.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/project-opencode-models.mjs');

// Synthetic `opencode models --verbose --pure` output: ID line, then pretty-printed metadata.
const VERBOSE = [
  'example/alpha-free',
  JSON.stringify({
    id: 'alpha-free',
    name: 'Alpha Free',
    providerID: 'example',
    api: { url: 'https://example.invalid/v1' },
    description: 'Braces in a string: { not an object } and an escaped quote \\" here',
  }, null, 2),
  'example-go/beta',
  JSON.stringify({ id: 'beta', name: 'Beta {preview}', providerID: 'example-go', cost: { input: 1 } }, null, 2),
  '',
].join('\r\n');

test('projects each ID line and its metadata to public fields only', () => {
  assert.deepEqual(parseVerboseModels(VERBOSE), [
    { id: 'example/alpha-free', name: 'Alpha Free', providerID: 'example' },
    { id: 'example-go/beta', name: 'Beta {preview}', providerID: 'example-go' },
  ]);
});

test('reports requested IDs as found or missing, and matches renamed rows by text', () => {
  const projection = projectOpenCodeModels(VERBOSE, {
    ids: ['example-go/beta', 'example-go/alpha-free'],
    match: 'ALPHA',
  });
  assert.equal(projection.total, 2);
  assert.deepEqual(projection.selected, [
    { id: 'example-go/beta', name: 'Beta {preview}', providerID: 'example-go' },
    { id: 'example-go/alpha-free', missing: true },
  ]);
  assert.deepEqual(projection.matching, [
    { id: 'example/alpha-free', name: 'Alpha Free', providerID: 'example' },
  ]);
  assert.deepEqual(projectOpenCodeModels(VERBOSE, { match: 'gamma' }).matching, []);
});

test('rejects output that is not ID-line-plus-object pairs', () => {
  assert.throws(() => parseVerboseModels('example/a\nexample/b\n{}'), /not followed by a metadata object/);
  assert.throws(() => parseVerboseModels('{"name":"orphan"}'), /without a preceding model ID line/);
  assert.throws(() => parseVerboseModels('example/a\n{"name":"cut'), /ends inside/);
});

test('the command reads stdin and prints no metadata beyond id, name and provider', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--ids', 'example/alpha-free'], {
    input: VERBOSE,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.selected, [{ id: 'example/alpha-free', name: 'Alpha Free', providerID: 'example' }]);
  assert.doesNotMatch(result.stdout, /example\.invalid|cost/);
});
