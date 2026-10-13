// Keep this Node test out of Vitest's *.test.* auto-discovery. Every input is synthetic; no
// Cursor CLI is started. The preload test runs plain Node against a fake webpack-style bundle.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  analyzeFamily,
  assertSafe,
  buildOutputs,
  CaptureError,
  checkCapture,
  compactFixture,
  EXIT,
  latestVersionDir,
  nodeBinaryName,
  parseCliArgs,
  parseListModels,
  pickerSummary,
  PRELOAD,
  project,
  redact,
  resolveInstall,
  safetyScan,
  stringifyAscii,
  versionSortKey,
} from '../scripts/capture-cursor-parameterized-models.mjs';

const ZWSP = String.fromCharCode(0x200b);
const INSTALL = { version: '2026.10.01-abc1234', versionDir: null };

function enumDef(id, name, values) {
  return { id, name, parameterType: { enumParameter: { values: values.map((v) => (typeof v === 'string' ? { value: v, displayName: v.toUpperCase() } : v)) } } };
}
function boolDef(id, name, trueDisplayName) {
  return { id, name, parameterType: { booleanParameter: { values: [{ value: 'false' }, { value: 'true', displayName: trueDisplayName, increasesModelCost: true }] } } };
}
function variant(name, pairs, extra = {}) {
  const parameterValues = pairs.map(([id, value]) => ({ id, value }));
  return { parameterValues, variantStringRepresentation: name + '[' + pairs.map(([id, value]) => id + '=' + value).join(',') + ']', ...extra };
}

// alpha-1: full 2x2x2 cross product; one legacy slug per effort/fast shared by both contexts.
function alphaFamily() {
  const variants = [];
  for (const context of ['200k', '1m']) {
    for (const effort of ['low', 'high']) {
      for (const fast of ['false', 'true']) {
        variants.push(
          variant('alpha-1', [['context', context], ['effort', effort], ['fast', fast]], {
            legacySlug: 'alpha-1-' + effort + (fast === 'true' ? '-fast' : ''),
            isMaxMode: context === '1m',
            ...(context === '200k' && effort === 'high' && fast === 'false' ? { isDefaultNonMaxConfig: true } : {}),
            ...(context === '1m' && effort === 'high' && fast === 'false' ? { isDefaultMaxConfig: true } : {}),
          }),
        );
      }
    }
  }
  return {
    name: 'alpha-1',
    clientDisplayName: 'Alpha 1',
    defaultOn: true,
    legacySlugs: ['alpha-1-low', 'alpha-1-high'],
    idAliases: [],
    parameterDefinitions: [enumDef('context', 'Context', ['200k', { value: '1m', displayName: '1M', increasesModelCost: true }]), enumDef('effort', 'Effort', ['low', 'high']), boolDef('fast', 'Fast', 'Fast' + ZWSP)],
    variants,
  };
}

// beta-2: thinking=false,effort=max is not offered, so the family is a partial cross product.
function betaFamily() {
  const variants = [];
  for (const thinking of ['false', 'true']) {
    for (const effort of ['low', 'high', 'max']) {
      if (thinking === 'false' && effort === 'max') continue;
      variants.push(
        variant('beta-2', [['thinking', thinking], ['effort', effort]], {
          legacySlug: 'beta-2-' + (thinking === 'true' ? 'thinking-' : '') + effort,
          tooltipData: { markdownContent: 'This model has special data retention policies.' },
          ...(thinking === 'true' && effort === 'high' ? { isDefaultNonMaxConfig: true, isDefaultMaxConfig: true } : {}),
        }),
      );
    }
  }
  return {
    name: 'beta-2',
    clientDisplayName: 'Beta 2',
    legacySlugs: [],
    idAliases: [],
    parameterDefinitions: [boolDef('thinking', 'Thinking'), enumDef('effort', 'Effort', ['low', 'high', 'max'])],
    variants,
  };
}

function fixedFamily(name, label, extra = {}) {
  return {
    name,
    clientDisplayName: label,
    legacySlugs: [],
    idAliases: [],
    parameterDefinitions: [],
    variants: [{ parameterValues: [], variantStringRepresentation: name + '[]', legacySlug: name, isDefaultNonMaxConfig: true, isDefaultMaxConfig: true }],
    ...extra,
  };
}

function syntheticCapture(overrides = {}) {
  const models = [fixedFamily('default', 'Auto', { defaultOn: true, idAliases: ['auto'] }), alphaFamily(), betaFamily(), fixedFamily('gamma-old', 'Gamma Old')];
  return {
    ok: true,
    hookVersion: 1,
    stage: 'rpc-settled',
    serviceResultSummary: { parameterizedModelsFetchStatus: 'loaded', cliParameterizedModelNames: ['default', 'alpha-1', 'beta-2'] },
    droppedSensitiveKeyPaths: [],
    calls: [
      {
        method: 'availableModels',
        status: 'fulfilled',
        startedAtMs: 1000,
        settledAtMs: 1200,
        request: { json: { useModelParameters: true, doNotUseMarkdown: true } },
        response: { typeName: 'aiserver.v1.AvailableModelsResponse', json: { models, composerModelConfig: { defaultModel: 'default', fallbackModels: [] }, ...overrides.response } },
      },
      {
        method: 'getUsableModels',
        status: 'fulfilled',
        response: { typeName: 'agent.v1.GetUsableModelsResponse', json: { models: [{ modelId: 'default', displayModelId: 'auto', displayName: 'Auto', aliases: ['auto'] }, { modelId: 'alpha-1-high', displayModelId: 'alpha-1-high', displayName: 'Alpha 1 1M High' }] } },
      },
      {
        method: 'getDefaultModelForCli',
        status: 'fulfilled',
        response: { typeName: 'agent.v1.GetDefaultModelForCliResponse', json: { model: { modelId: 'default', displayModelId: 'auto', displayName: 'Auto', maxMode: false } } },
      },
    ],
  };
}

const STDOUT = ['Available models', '', 'auto - Auto (default)', 'alpha-1-high - Alpha 1 1M High', 'beta-2-thinking-low - Beta 2 Thinking Low (NO ZDR)', 'mystery-slug - Mystery', '', 'Tip: use --model <id> to switch.'].join('\n');

test('importing the module does not run the capture', () => {
  assert.ok(!process.exitCode);
  assert.match(PRELOAD, /capture-cursor-parameterized-models\.preload\.cjs$/);
});

test('argument parsing requires --output and bounds the timeout', () => {
  assert.throws(() => parseCliArgs([]), (e) => e instanceof CaptureError && e.exitCode === EXIT.usage);
  assert.throws(() => parseCliArgs(['--output', 'x.json', '--timeout-ms', '10']), (e) => e.exitCode === EXIT.usage);
  assert.throws(() => parseCliArgs(['--bogus']), (e) => e.exitCode === EXIT.usage);
  assert.equal(parseCliArgs(['--output', 'x.json']).timeoutMs, 60000);
  assert.equal(parseCliArgs(['--help']).help, true);
});

test('install resolution follows the shim version rule', () => {
  assert.ok(versionSortKey('2026.10.01-e373342') > versionSortKey('2026.9.15-d2fe57e'));
  assert.ok(versionSortKey('2026.10.01-12-00-00-abc') > versionSortKey('2026.10.01-abc'));
  assert.equal(versionSortKey('latest'), null);
  const root = mkdtempSync(join(tmpdir(), 'cursor-pm-install-'));
  try {
    for (const [name, complete] of [['2026.9.15-aaaa111', true], ['2026.10.01-bbbb222', true], ['2026.10.02-cccc333', false], ['notes', true]]) {
      const dir = join(root, 'versions', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.js'), '');
      if (complete) writeFileSync(join(dir, nodeBinaryName()), '');
    }
    const expected = join(root, 'versions', '2026.10.01-bbbb222');
    assert.equal(latestVersionDir(root), expected);
    assert.equal(resolveInstall(root).versionDir, expected);
    assert.equal(resolveInstall(join(expected, 'index.js')).version, '2026.10.01-bbbb222');
    assert.throws(() => resolveInstall(join(root, 'missing')), (e) => e.exitCode === EXIT.usage);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cross-product analysis reports full, partial and parameterless families', () => {
  const alpha = analyzeFamily(alphaFamily());
  assert.equal(alpha.expectedCombinations, 8);
  assert.equal(alpha.isFullCrossProduct, true);
  assert.deepEqual(alpha.valueCounts, { context: 2, effort: 2, fast: 2 });

  const beta = analyzeFamily(betaFamily());
  assert.equal(beta.isFullCrossProduct, false);
  assert.equal(beta.listedVariants, 5);
  assert.deepEqual(beta.missingCombinations, ['beta-2[thinking=false,effort=max]']);

  const fixed = analyzeFamily(fixedFamily('solo', 'Solo'));
  assert.equal(fixed.hasParameters, false);
  assert.equal(fixed.isFullCrossProduct, true);
  assert.deepEqual(fixed.variantStringMismatches, []);

  const odd = betaFamily();
  odd.parameterDefinitions[1].parameterType.enumParameter.values[2].blockedByAdminAllowlist = true;
  odd.variants[0].variantStringRepresentation = 'beta-2[effort=low,thinking=false]';
  odd.variants.push(variant('beta-2', [['effort', 'low']]));
  const oddResult = analyzeFamily(odd);
  assert.equal(oddResult.expectedCombinations, 4);
  assert.deepEqual(oddResult.missingCombinations, []);
  assert.deepEqual(oddResult.variantsOutsideDefinitionValues, ['beta-2[thinking=true,effort=max]']);
  assert.equal(oddResult.variantsWithParameterIdMismatch.length, 1);
  assert.equal(oddResult.variantStringMismatches.length, 1);
});

test('picker summary mirrors the CLI row text', () => {
  const alpha = alphaFamily();
  assert.equal(pickerSummary(alpha, [{ id: 'context', value: '1m' }, { id: 'effort', value: 'high' }, { id: 'fast', value: 'true' }]), '1M HIGH Fast');
  assert.equal(pickerSummary(betaFamily(), [{ id: 'thinking', value: 'false' }, { id: 'effort', value: 'low' }]), 'LOW No Thinking');
  assert.equal(pickerSummary(fixedFamily('solo', 'Solo'), []), '');
});

test('list-models output parsing keeps markers and the tip', () => {
  const esc = String.fromCharCode(27);
  const parsed = parseListModels(esc + '[36mauto' + esc + '[39m - Auto (current, default)\r\nTip: x');
  assert.deepEqual(parsed.rows, [{ id: 'auto', label: 'Auto', current: true, default: true }]);
  assert.equal(parsed.tip, 'Tip: x');
});

test('projection keeps families, definitions, variants, defaults and the CLI exclusion', () => {
  const projected = project(syntheticCapture(), { code: 0, stdout: STDOUT }, INSTALL);
  assert.deepEqual(projected.families.map((f) => f.id), ['default', 'alpha-1', 'beta-2', 'gamma-old']);
  assert.deepEqual(projected.counts, { familiesInReply: 4, familiesAfterCliFilter: 3, familiesWithParameters: 2, variantsInReply: 15 });
  assert.deepEqual(projected.cliExcludedFamilies, ['gamma-old']);
  assert.equal(projected.families[0].isAutoRow, true);

  const alpha = projected.families[1];
  assert.equal(alpha.pickerLabel, 'Alpha 1');
  assert.equal(alpha.attributes.defaultOn, true);
  assert.equal(alpha.parameterDefinitions.length, 3);
  assert.deepEqual(alpha.variants[0].parameters, { context: '200k', effort: 'low', fast: 'false' });
  assert.equal(alpha.derived.maxModeVariants, 4);
  assert.deepEqual(projected.crossProductSummary.partial, { 'beta-2': ['beta-2[thinking=false,effort=max]'] });
  assert.deepEqual(projected.crossProductSummary.noParameters, ['default', 'gamma-old']);

  const flags = projected.defaultMarkers.flags.filter((f) => f.family === 'alpha-1');
  assert.deepEqual(flags, [
    { family: 'alpha-1', flag: 'family.defaultOn' },
    { family: 'alpha-1', variant: 'alpha-1[context=200k,effort=high,fast=false]', flag: 'variant.isDefaultNonMaxConfig' },
    { family: 'alpha-1', variant: 'alpha-1[context=1m,effort=high,fast=false]', flag: 'variant.isDefaultMaxConfig' },
  ]);
  assert.equal(projected.defaultMarkers.defaultModelForCli.modelId, 'default');
  assert.equal(projected.defaultMarkers.featureModelConfigs.composerModelConfig.defaultModel, 'default');

  const rows = Object.fromEntries(projected.listModels.rows.map((r) => [r.id, r]));
  assert.deepEqual(rows.auto.match, { family: 'default', via: 'family.idAliases' });
  assert.equal(rows['alpha-1-high'].match.variant, 'alpha-1[context=200k,effort=high,fast=false]');
  assert.deepEqual(rows['alpha-1-high'].match.alsoMatches, ['alpha-1[context=1m,effort=high,fast=false]']);
  assert.deepEqual(projected.listModels.unmatchedIds, ['mystery-slug']);
  assert.deepEqual(projected.families[2].derived.legacyLabelSuffixes, ['NO ZDR']);
  assert.equal(projected.families[2].derived.tooltipMentionsDataRetention, true);
  assert.equal(projected.usableModels.length, 2);
});

test('without the CLI result the bundled exclusion list is used', () => {
  const capture = syntheticCapture();
  delete capture.serviceResultSummary;
  capture.calls[0].response.json.models.push(fixedFamily('gemini-2.5-flash', 'Gemini 2.5 Flash'));
  const projected = project(capture, { code: 0, stdout: '' }, INSTALL);
  assert.deepEqual(projected.cliExcludedFamilies, ['gemini-2.5-flash']);
});

test('redaction replaces emails, account keys and opaque identity ids', () => {
  const stats = { keys: 0, emails: 0, opaqueIds: 0 };
  const out = redact({ note: 'Contact admin' + String.fromCharCode(64) + 'example.com', teamId: 4242, nested: [{ ownerUserId: 'x' }], who: 'user_ABCDEFGHIJKLMNOP', empty: { userId: '' } }, stats);
  assert.equal(out.note, 'Contact <redacted-email>');
  assert.equal(out.teamId, '<redacted>');
  assert.equal(out.nested[0].ownerUserId, '<redacted>');
  assert.equal(out.who, '<redacted-id>');
  assert.equal(out.empty.userId, '');
  assert.deepEqual(stats, { keys: 2, emails: 1, opaqueIds: 1 });
});

test('the safety scan rejects token-like strings without echoing them', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJlLXZhbHVl';
  for (const text of ['{"note":"Bearer abc123secret"}', '{"value":"' + jwt + '"}', '{"accessToken":"abc"}', '{"key":"sk-' + 'a'.repeat(24) + '"}']) {
    assert.throws(
      () => assertSafe(text, 'synthetic'),
      (e) => e instanceof CaptureError && e.exitCode === EXIT.unsafe && !e.message.includes('abc') && !e.message.includes(jwt),
    );
  }
  const clean = safetyScan('{"contextTokenLimit":200000,"autoContextMaxTokens":1}');
  assert.equal(clean.tokenKey.count, 0);
  assert.equal(assertSafe('{"ok":true}', 'synthetic').bearer.count, 0);
});

test('buildOutputs blocks an unsafe reply and passes a clean one', () => {
  const tainted = syntheticCapture();
  tainted.calls[0].response.json.models[1].tagline = 'Authorization: Bearer abc';
  assert.throws(() => buildOutputs(tainted, { code: 0, stdout: STDOUT }, INSTALL), (e) => e.exitCode === EXIT.unsafe);

  const { projected, text, rawText } = buildOutputs(syntheticCapture(), { code: 0, stdout: STDOUT }, INSTALL);
  assert.equal(projected.capture.safetyScan.bearer, 0);
  assert.equal(projected.capture.rpcCalls[0].latencyMs, 200);
  assert.ok(text.endsWith('\n') && rawText.includes('AvailableModelsResponse'));
});

test('a failed or empty capture fails closed', () => {
  const failed = { ok: false, reason: 'availableModels reply was not observed', stage: 'command-module-loaded', calls: [] };
  assert.throws(() => checkCapture(failed), (e) => e.exitCode === EXIT.captureFailed && /not observed/.test(e.message));
  assert.throws(() => checkCapture(failed, { timedOut: true }), (e) => e.exitCode === EXIT.timeout);
  const empty = syntheticCapture();
  empty.calls[0].response.json.models = [];
  assert.throws(() => checkCapture(empty), (e) => e.exitCode === EXIT.captureFailed);
  assert.throws(() => buildOutputs(failed, { code: 0, stdout: '' }, INSTALL), (e) => e.exitCode === EXIT.captureFailed);
  assert.equal(checkCapture(syntheticCapture()).ok, true);
});

test('the compact fixture drops tooltips and escapes non-ASCII text', () => {
  const projected = project(syntheticCapture(), { code: 0, stdout: STDOUT }, INSTALL);
  const fixture = compactFixture(projected);
  assert.equal(fixture.families.length, 4);
  assert.deepEqual(fixture.families[1].parameterDefinitions[2], {
    id: 'fast',
    name: 'Fast',
    type: 'boolean',
    values: [{ value: 'false', displayName: undefined }, { value: 'true', displayName: 'Fast' + ZWSP }],
  });
  assert.deepEqual(fixture.families[1].variants[2], {
    variantStringRepresentation: 'alpha-1[context=200k,effort=high,fast=false]',
    parameters: { context: '200k', effort: 'high', fast: 'false' },
    isDefaultNonMaxConfig: true,
    isDefaultMaxConfig: false,
    isMaxMode: false,
  });
  const text = stringifyAscii(fixture);
  assert.ok(text.includes('Fast' + String.fromCharCode(92) + 'u200b'));
  assert.ok(!text.includes(ZWSP) && !text.includes('tooltip') && !text.includes('markdownContent'));
  assert.deepEqual(JSON.parse(text).families[1].parameterDefinitions[2].values[1].displayName, 'Fast' + ZWSP);
});

// A fake webpack-style CLI: index.js loads chunk 891 with require(), whose models command calls
// the model service; the service races the parameterized reply against a 50 ms timer.
const FAKE_INDEX = `
const modules = {};
const cache = {};
function req(id) {
  if (cache[id]) return cache[id].exports;
  const m = { exports: {} };
  cache[id] = m;
  modules[id].call(m.exports, m, m.exports, req);
  return m.exports;
}
req.d = (e, defs) => { for (const k in defs) Object.defineProperty(e, k, { enumerable: true, get: defs[k] }); };
modules['./src/models/model-service.ts'] = function (e, t, s) {
  s.d(t, { aC: () => aC });
  async function aC(client) {
    const timer = new Promise((r) => setTimeout(() => r('timed_out'), 50));
    const pm = await Promise.race([client.availableModels({ useModelParameters: true }), timer]);
    const usable = await client.getUsableModels({ customModelIds: [] });
    const dflt = await client.getDefaultModelForCli({});
    return {
      parameterizedModelsFetchStatus: pm === 'timed_out' ? 'timed_out' : 'loaded',
      parameterizedModels: pm === 'timed_out' ? undefined : pm.toJson().models,
      availableModels: usable.toJson().models,
      defaultModel: dflt.toJson().model,
    };
  }
};
if (process.env.FAKE_MODE !== 'no-chunk') {
  const chunk = require('./891.index.js');
  for (const id in chunk.modules) modules[id] = chunk.modules[id];
}
if (!modules['./src/commands/models.ts']) process.exit(0);
req('./src/commands/models.ts').run();
`;

const FAKE_CHUNK = `
exports.id = 891;
exports.ids = [891];
const msg = (typeName, json) => ({ toJson: () => json, getType: () => ({ typeName }) });
exports.modules = {
  './src/commands/models.ts'(e, t, s) {
    s.d(t, { run: () => run });
    const service = s('./src/models/model-service.ts');
    const client = {
      availableModels: () => new Promise((r) => setTimeout(() => r(msg('aiserver.v1.AvailableModelsResponse', {
        models: [{ name: 'solo', parameterDefinitions: [], variants: [{ parameterValues: [], variantStringRepresentation: 'solo[]' }] }],
      })), 300)),
      getUsableModels: async () => msg('agent.v1.GetUsableModelsResponse', {
        models: [{ modelId: 'solo', apiKeyCredentials: { apiKey: 'SYNTHETIC-SECRET' } }],
      }),
      getDefaultModelForCli: async () => msg('agent.v1.GetDefaultModelForCliResponse', { model: { modelId: 'solo' } }),
    };
    async function run() {
      await service.aC(client);
      process.exit(0);
    }
  },
};
`;

function runFake(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-pm-fake-'));
  try {
    writeFileSync(join(dir, 'index.js'), FAKE_INDEX);
    writeFileSync(join(dir, '891.index.js'), FAKE_CHUNK);
    const capture = join(dir, 'capture.json');
    const result = spawnSync(process.execPath, ['--require', PRELOAD, join(dir, 'index.js')], {
      cwd: dir,
      env: { ...process.env, NODE_OPTIONS: '', CURSOR_PM_CAPTURE_FILE: capture, CURSOR_PM_WAIT_MS: '5000', FAKE_MODE: mode },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(capture, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the preload waits past the race, records replies and strips credentials', () => {
  const raw = runFake('normal');
  assert.equal(raw.ok, true, JSON.stringify(raw.diagnostics));
  assert.equal(raw.serviceResultSummary.parameterizedModelsFetchStatus, 'timed_out');
  assert.deepEqual(raw.calls.map((c) => c.method + ':' + c.status), ['availableModels:fulfilled', 'getUsableModels:fulfilled', 'getDefaultModelForCli:fulfilled']);
  assert.equal(raw.calls[0].response.typeName, 'aiserver.v1.AvailableModelsResponse');
  assert.deepEqual(raw.calls[1].response.json.models, [{ modelId: 'solo' }]);
  assert.deepEqual(raw.droppedSensitiveKeyPaths, ['getUsableModels.response.json.models[0]']);
  assert.ok(!JSON.stringify(raw).includes('SYNTHETIC-SECRET'));
  assert.equal(checkCapture(raw).ok, true);
});

test('the preload fails closed when the model-list command never runs', () => {
  const raw = runFake('no-chunk');
  assert.equal(raw.ok, false);
  assert.equal(raw.stage, 'preload-loaded');
  assert.throws(() => checkCapture(raw), (e) => e.exitCode === EXIT.captureFailed);
});
