import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  locateJunieJvm,
  parseJunieModelIds,
  resolveJunieHome,
} from '../scripts/junie-model-ids.mjs';

test('parses model and alias lines into setting IDs and picker names', () => {
  const parsed = parseJunieModelIds([
    'model\tGEMINI_3_7_FLASH\tgemini-3.7-flash\tGemini 3.7 Flash',
    'model\tGPT6_SOL\tgpt-6-sol\tGPT-6-SOL',
    'model\tUNNAMED\tunnamed-id\t',
    'alias\tgpt',
    'alias\tgrok',
    '',
  ].join('\r\n'));

  assert.deepEqual(parsed, {
    models: [
      { enumName: 'GEMINI_3_7_FLASH', settingId: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash' },
      { enumName: 'GPT6_SOL', settingId: 'gpt-6-sol', displayName: 'GPT-6-SOL' },
      { enumName: 'UNNAMED', settingId: 'unnamed-id', displayName: null },
    ],
    aliases: ['gpt', 'grok'],
  });
});

test('rejects unexpected or empty probe output', () => {
  assert.throws(() => parseJunieModelIds('Exception in thread "main"'), /Unexpected probe line/);
  assert.throws(() => parseJunieModelIds('alias\tgpt\n'), /no models/);
});

test('resolves the current version and finds its JAR and bundled java', () => {
  const root = mkdtempSync(join(tmpdir(), 'junie-model-ids-test-'));
  try {
    writeFileSync(join(root, 'current'), '3419.7\r\n');
    const home = resolveJunieHome(root);
    assert.equal(home, join(root, 'versions', '3419.7', 'junie'));

    mkdirSync(join(home, 'app'), { recursive: true });
    mkdirSync(join(home, 'runtime', 'bin'), { recursive: true });
    writeFileSync(join(home, 'app', 'junie-release-3419.7.jar'), '');
    writeFileSync(join(home, 'runtime', 'bin', 'java'), '');
    assert.deepEqual(locateJunieJvm(home), {
      jar: join(home, 'app', 'junie-release-3419.7.jar'),
      java: join(home, 'runtime', 'bin', 'java'),
    });

    writeFileSync(join(root, 'current'), '../elsewhere\n');
    assert.throws(() => resolveJunieHome(root), /Unusable Junie version/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
