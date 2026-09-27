// Keep this Node test out of Vitest's *.test.* auto-discovery.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractPiModels } from '../scripts/extract-pi-models.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/extract-pi-models.mjs');

// A minimal fake install: pi-coding-agent with a nested pi-ai whose level rule mirrors Pi 0.87.1.
function writeFakePi(root, { hoisted = false } = {}) {
  const pkg = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent');
  const ai = hoisted ? join(root, 'node_modules', '@earendil-works', 'pi-ai')
    : join(pkg, 'node_modules', '@earendil-works', 'pi-ai');
  const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  put(join(pkg, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: '9.9.9' }));
  put(join(pkg, 'dist', 'core', 'defaults.js'), 'export const DEFAULT_THINKING_LEVEL = "medium";\n');
  put(join(ai, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-ai', version: '9.9.8' }));
  put(join(ai, 'dist', 'models.generated.js'), `export const MODELS = {
  "example-channel": {
    "model-a": { id: "model-a", name: "Model A", reasoning: true, input: ["text"], contextWindow: 1000, maxTokens: 100,
      thinkingLevelMap: { xhigh: "xhigh", minimal: "low" } },
    "model-b": { id: "model-b", name: "Model B", reasoning: true, input: ["text", "image"], contextWindow: 2000, maxTokens: 200,
      thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" } },
    "model-c": { id: "model-c", name: "Model C", reasoning: false, input: ["text"], contextWindow: 3000, maxTokens: 300 },
  },
  "other-channel": { "model-z": { id: "model-z", name: "Z", reasoning: true, input: ["text"] } },
};\n`);
  put(join(ai, 'dist', 'models.js'), `const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export function getSupportedThinkingLevels(model) {
  if (!model.reasoning) return ["off"];
  return LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}\n`);
  return pkg;
}

function withScratch(run) {
  const root = mkdtempSync(join(tmpdir(), 'pi-models-test-'));
  return Promise.resolve(run(root)).finally(() => rmSync(root, { recursive: true, force: true }));
}

test('extracts one channel with Pi-computed thinking levels, limits and source hashes', () => withScratch(async (root) => {
  const result = await extractPiModels({ packageDir: writeFakePi(root), provider: 'example-channel' });
  assert.equal(result.piVersion, '9.9.9');
  assert.equal(result.piAiVersion, '9.9.8');
  assert.equal(result.defaultThinkingLevel, 'medium');
  assert.deepEqual(result.models.map((model) => [model.id, model.thinkingLevels.join(',')]), [
    ['model-a', 'off,minimal,low,medium,high,xhigh'],
    ['model-b', 'minimal,low,medium,high,xhigh,max'],
    ['model-c', 'off'],
  ]);
  assert.deepEqual(result.models[1], { id: 'model-b', name: 'Model B', input: ['text', 'image'], reasoning: true,
    thinkingLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    thinkingLevelMap: { off: null, xhigh: 'xhigh', max: 'max' }, contextWindow: 2000, maxTokens: 200 });
  assert.equal(Object.keys(result.sources).length, 5);
  assert.ok(Object.values(result.sources).every((hash) => /^[0-9a-f]{64}$/.test(hash)));
  assert.equal(result.store, undefined);
}));

test('finds a hoisted pi-ai and compares a model store by id', () => withScratch(async (root) => {
  const store = join(root, 'models-store.json');
  writeFileSync(store, JSON.stringify({ 'example-channel': { checkedAt: 0, models: [
    { id: 'model-a' }, { id: 'model-new' }, { id: 'model-c' },
  ] } }));
  const result = await extractPiModels({ packageDir: writeFakePi(root, { hoisted: true }), provider: 'example-channel', storePath: store });
  assert.deepEqual(result.store, { checkedAt: '1970-01-01T00:00:00.000Z', count: 3, sameIdsAndOrder: false,
    onlyInStore: ['model-new'], onlyInRegistry: ['model-b'] });
}));

test('rejects an unknown provider and a missing package', () => withScratch(async (root) => {
  await assert.rejects(extractPiModels({ packageDir: writeFakePi(root), provider: 'missing' }),
    /Provider 'missing' is not in the Pi registry\. Known: example-channel, other-channel/);
  await assert.rejects(extractPiModels({ packageDir: join(root, 'nowhere') }), /No @earendil-works\/pi-ai/);
}));

test('the command line prints JSON and requires --package', () => withScratch((root) => {
  const pkg = writeFakePi(root);
  const ok = spawnSync(process.execPath, [SCRIPT, '--package', pkg, '--provider', 'example-channel'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).count, 3);
  const missing = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /--package <pi-coding-agent dir>/);
}));
