// Keep this Node test out of Vitest's *.test.* auto-discovery.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { frame, listCopilotModels, projectModels, readFrames } from '../scripts/list-copilot-models.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/list-copilot-models.mjs');
const SECRET = 'SECRET-ACCOUNT-POLICY';

// A fake `copilot --headless --stdio`: FAKE_MODE picks which handshake models.list needs.
const FAKE = `
const mode = process.env.FAKE_MODE;
if (!process.argv.includes('--headless') || !process.argv.includes('--no-auto-update')) process.exit(9);
let buffer = Buffer.alloc(0);
let ready = mode === 'direct';
const reply = (message) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n');
  process.stdout.write(body);
};
const models = [
  { id: 'auto', name: 'Auto', billing: { discountPercent: 10 }, policy: { state: '${SECRET}' } },
  { id: 'example-large', name: 'Example Large', supportedReasoningEfforts: ['low', 'high'],
    billing: { tokenPrices: { contextMax: 1000, longContext: { contextMax: 4000 } } },
    account: '${SECRET}' },
  { id: 'example-env', name: process.env.COPILOT_LEAK ? 'leaked' : 'clean' },
];
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf('\\r\\n\\r\\n');
    if (end < 0) return;
    const length = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    if (mode === 'silent') continue;
    if (message.method === 'models.list') {
      if (mode === 'error') reply({ id: message.id, error: { code: -32000, message: 'not signed in' } });
      else if (!ready) reply({ id: message.id, error: { code: -32601, message: 'Method not found' } });
      else reply({ id: message.id, result: { models } });
    } else if (message.method === 'connect') {
      if (mode === 'ping') reply({ id: message.id, error: { code: -32601, message: 'Method not found' } });
      else { ready = true; reply({ id: message.id, result: {} }); }
    } else if (message.method === 'ping') {
      ready = true;
      reply({ id: message.id, result: { message: 'pong' } });
    }
  }
});
`;

async function withFake(run) {
  const root = mkdtempSync(join(tmpdir(), 'copilot-models-test-'));
  try {
    const loader = join(root, 'npm-loader.js');
    writeFileSync(loader, FAKE);
    return await run(loader, root);
  } finally {
    // The killed fake can hold its working directory briefly on Windows.
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

test('frames round-trip and partial frames wait for more bytes', () => {
  const both = Buffer.concat([frame({ id: 1 }), frame({ id: 2, text: 'é' })]);
  const partial = readFrames(both.subarray(0, both.length - 3));
  assert.deepEqual(partial.messages, [{ id: 1 }]);
  assert.deepEqual(readFrames(Buffer.concat([partial.rest, both.subarray(both.length - 3)])).messages, [{ id: 2, text: 'é' }]);
  assert.throws(() => readFrames(Buffer.from('X-Other: 1\r\n\r\n{}')), /no Content-Length/);
});

test('projects only ids, names, efforts, context sizes and discounts', () => {
  const models = projectModels({ models: [{ id: 'm', name: 'M', policy: { state: SECRET },
    billing: { tokenPrices: { contextMax: 1, longContext: { contextMax: 2 }, inputPrice: 3 } } }] });
  assert.deepEqual(models, [{ id: 'm', name: 'M', supportedReasoningEfforts: null, contextMax: 1, longContextMax: 2 }]);
  assert.throws(() => projectModels({ nothing: true }), /no model array/);
});

for (const mode of ['direct', 'connect', 'ping']) {
  test(`reads models.list through the ${mode} path without leaking COPILOT_* or account data`, () => withFake(async (loader, root) => {
    const result = await listCopilotModels({ loader, timeoutMs: 10000, cwd: root,
      env: { ...process.env, FAKE_MODE: mode, COPILOT_LEAK: '1' } });
    assert.equal(result.phase, mode);
    assert.equal(result.count, 3);
    assert.deepEqual(result.models[0], { id: 'auto', name: 'Auto', supportedReasoningEfforts: null,
      contextMax: null, longContextMax: null, discountPercent: 10 });
    assert.deepEqual(result.models[1], { id: 'example-large', name: 'Example Large',
      supportedReasoningEfforts: ['low', 'high'], contextMax: 1000, longContextMax: 4000 });
    assert.equal(result.models[2].name, 'clean');
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
  }));
}

test('reports an RPC error and a silent CLI as failures', () => withFake(async (loader, root) => {
  await assert.rejects(listCopilotModels({ loader, timeoutMs: 10000, cwd: root,
    env: { ...process.env, FAKE_MODE: 'error' } }), /models.list failed: not signed in/);
  await assert.rejects(listCopilotModels({ loader, timeoutMs: 1000, cwd: root,
    env: { ...process.env, FAKE_MODE: 'silent' } }), /No models.list result within 1000 ms/);
}));

test('the command line prints the projection and requires --loader', () => withFake((loader, root) => {
  const ok = spawnSync(process.execPath, [SCRIPT, '--loader', loader, '--timeout-ms', '10000'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, FAKE_MODE: 'direct' } });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).count, 3);
  assert.doesNotMatch(ok.stdout, new RegExp(SECRET));
  const missing = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /--loader <npm-loader.js>/);
}));
