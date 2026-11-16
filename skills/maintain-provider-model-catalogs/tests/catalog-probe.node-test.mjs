// Keep this Node test out of Vitest's *.test.* auto-discovery. Every input is synthetic; no CLI
// is started.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { findRepoRoot, loadFactory, probeSources, selectSources } from '../scripts/catalog-probe.mjs';
import { assertRequestedBases, detectSignInMarker, parseBasisOption, readKimiRegion } from '../scripts/catalog-probe/basis.mjs';
import {
  compareScope,
  exitCodeFor,
  familyPattern,
  validateAcknowledgements,
  validateSnapshot,
} from '../scripts/catalog-probe/compare.mjs';
import { cleanEnv, launchSpec, resolveNpmShimScript } from '../scripts/catalog-probe/process.mjs';
import { buildEvidence, evidenceDirectoryName, selectorBases, selectSnapshotSources, writeEvidence } from '../scripts/catalog-probe/evidence.mjs';
import { escapeHtml, renderHtml } from '../scripts/catalog-probe/html.mjs';
import { renderMarkdown, renderTerminal } from '../scripts/catalog-probe/report.mjs';
import { buildHandoff } from '../scripts/catalog-probe/handoff.mjs';
import {
  claudeChangelogSignals,
  parseAgyModels,
  parseAuggieModelList,
  parseKimiProviderList,
  parseClineProviderBlock,
  parseCodexDebugModels,
  parseCursorListModels,
  parseDevinModelsList,
  parseGrokModels,
  parseKiroListModels,
  parseVerboseChannel,
  parseVersion,
  museProbeResult,
  projectMuseModelList,
  runSource,
  SOURCES,
  SourceFailure,
} from '../scripts/catalog-probe/sources.mjs';
import { KiroAcpError, parseKiroModelOptions, readKiroModelOptions } from '../scripts/catalog-probe/kiro-acp.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/catalog-probe.mjs');
const FAKE_KIRO_ACP = join(dirname(fileURLToPath(import.meta.url)), 'support', 'fake-kiro-acp.mjs');

function parseFailure(run) {
  assert.throws(run, (error) => error instanceof SourceFailure && error.status === 'error' && error.reason === 'parse');
}

function withScratch(run) {
  const root = mkdtempSync(join(tmpdir(), 'catalog-probe-test-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- parsers ---------------------------------------------------------------------------------

test('codex debug models keeps compared fields and public evidence, never instructions', () => {
  const rows = parseCodexDebugModels(JSON.stringify({
    models: [
      {
        slug: 'ex-2', display_name: 'Ex-2', description: 'Everyday model', visibility: 'list', default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }, { effort: 'medium' }], context_window: 1000, max_context_window: 4000,
        base_instructions: 'long text that must not survive', available_access_programs: ['private'],
      },
      { slug: 'ex-hidden', display_name: 'Hidden', visibility: 'hide', supported_reasoning_levels: [] },
    ],
  }));
  assert.deepEqual(rows, [
    {
      id: 'ex-2', label: 'Ex-2', efforts: ['low', 'medium'], effortDefault: 'medium', hidden: false,
      evidence: { description: 'Everyday model', visibility: 'list', contextWindow: 1000, maxContextWindow: 4000, effortDescriptions: { low: 'Fast' } },
    },
    { id: 'ex-hidden', label: 'Hidden', efforts: [], effortDefault: null, hidden: true, evidence: { visibility: 'hide' } },
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /long text|private/);
  parseFailure(() => parseCodexDebugModels('not json'));
  parseFailure(() => parseCodexDebugModels(JSON.stringify({ models: [{ display_name: 'no slug' }] })));
});

test('agy models reads tab pairs and rejects a changed line shape', () => {
  assert.deepEqual(parseAgyModels('Fetching available models...\nex-high\tEx (High)\nex-low\tEx (Low)\n'), [
    { id: 'ex-high', label: 'Ex (High)' },
    { id: 'ex-low', label: 'Ex (Low)' },
  ]);
  parseFailure(() => parseAgyModels('ex-high   Ex (High)\n'));
  parseFailure(() => parseAgyModels('Fetching available models...\n'));
});

test('grok models reads the model list and the sign-in state', () => {
  const signedOut = parseGrokModels('You are not authenticated.\n\nDefault model: ex-1\n\nAvailable models:\n  * ex-1 (default)\n  - ex-1-fast\n');
  assert.deepEqual(signedOut, { rows: [{ id: 'ex-1', evidence: { listMarkedDefault: true } }, { id: 'ex-1-fast' }], authenticated: false });
  assert.equal(parseGrokModels('You are logged in with <redacted>.\nAvailable models:\n  - ex-1\n').authenticated, true);
  assert.equal(parseGrokModels('Available models:\n  - ex-1\n').authenticated, null);
  parseFailure(() => parseGrokModels('Models:\n  - ex-1\n'));
  parseFailure(() => parseGrokModels('Available models:\n  ex-1 is great\n'));
});

test('kiro, auggie and devin JSON projections', () => {
  assert.deepEqual(parseKiroListModels(JSON.stringify({
    models: [
      { model_id: 'auto', model_name: 'auto', description: 'Chosen by task', context_window_tokens: 5, rate_multiplier: 1, rate_unit: 'Credit' },
      { model_id: 'ex-1', model_name: 'ex-1' },
    ],
    default_model: 'auto',
  })), [
    { id: 'auto', label: 'auto', evidence: { description: 'Chosen by task', contextWindowTokens: 5, rateMultiplier: 1, rateUnit: 'Credit', listDefault: true } },
    { id: 'ex-1', label: 'ex-1' },
  ]);
  parseFailure(() => parseKiroListModels(JSON.stringify({ models: [{ model_name: 'x' }] })));

  assert.deepEqual(parseKiroModelOptions({
    id: 'model', currentValue: 'auto',
    options: [
      { value: 'auto', name: 'Auto', description: 'Chosen by task', _meta: { kiro: { rateMultiplier: 1, rateUnit: 'Credit', hasEffort: false, thinkingToggleable: false } } },
      { value: 'ex-think', name: 'Example Think', _meta: { kiro: { rateMultiplier: 2, rateUnit: 'Credit', hasEffort: true, effortSchemaPath: 'output_config', effortLevels: ['low', 'high'], defaultEffortLevel: 'high', thinkingToggleable: true, defaultThinkingEnabled: true } } },
      { value: 'ex-unknown' },
    ],
  }), [
    { id: 'auto', label: 'auto', efforts: [], effortDefault: null, evidence: { displayName: 'Auto', description: 'Chosen by task', rateMultiplier: 1, rateUnit: 'Credit', thinkingToggleable: false, currentModel: true } },
    { id: 'ex-think', label: 'ex-think', efforts: ['low', 'high'], effortDefault: 'high', evidence: { displayName: 'Example Think', rateMultiplier: 2, rateUnit: 'Credit', effortSchemaPath: 'output_config', thinkingToggleable: true, defaultThinkingEnabled: true } },
    { id: 'ex-unknown', label: 'ex-unknown', efforts: null, effortDefault: null },
  ]);
  assert.throws(() => parseKiroModelOptions({ id: 'model', options: [{ name: 'no value' }] }),
    (error) => error instanceof KiroAcpError && error.reason === 'parse');

  assert.deepEqual(parseAuggieModelList(JSON.stringify({
    registryAvailable: false,
    defaultModelId: 'a',
    models: [{ id: 'opaque_a', displayName: 'Ex (A + B)', costTier: 2, badges: [], effortLevels: ['low'], isDefault: true }],
  })), {
    rows: [{ id: 'opaque_a', label: 'Ex (A + B)', evidence: { costTier: 2, effortLevels: ['low'], jsonIsDefault: true } }],
    registryAvailable: false,
    defaultModelId: 'a',
  });

  assert.deepEqual(parseKimiProviderList(JSON.stringify({
    providers: { 'managed:kimi-code': { type: 'kimi', apiKey: 'secret', oauth: { key: 'secret' } } },
    models: {
      'kimi-code/k3': { provider: 'managed:kimi-code', model: 'k3', maxContextSize: 1048576, displayName: 'K3',
        supportEfforts: ['low', 'high', 'max'], defaultEffort: 'high' },
      'kimi-code/fast': { provider: 'managed:kimi-code', model: 'fast', displayName: 'Fast' },
      'custom/model': { provider: 'custom', model: 'm', displayName: 'Mine' },
    },
  })), [
    { id: 'kimi-code/k3', label: 'K3', evidence: { model: 'k3', maxContextSize: 1048576,
      supportEfforts: ['low', 'high', 'max'], defaultEffort: 'high' } },
    { id: 'kimi-code/fast', label: 'Fast', evidence: { model: 'fast' } },
  ]);
  assert.throws(() => parseKimiProviderList('{"providers": {}}'), (error) => error instanceof SourceFailure && error.reason === 'parse');

  assert.deepEqual(parseDevinModelsList(JSON.stringify({
    families: [{ family_uid: 'ex', family_label: 'Ex', variants: [
      { model_uid: 'ex-low', label: 'Ex Low', cost_summary: '$1', is_new: true },
      { model_uid: 'ex-high', label: 'Ex High' },
    ] }],
  })), [
    { id: 'ex-low', label: 'Ex Low', evidence: { family: 'ex', familyLabel: 'Ex', isNew: true } },
    { id: 'ex-high', label: 'Ex High', evidence: { family: 'ex', familyLabel: 'Ex' } },
  ]);
  parseFailure(() => parseDevinModelsList(JSON.stringify({ families: [] })));
});

test('verbose OpenCode/Kilo output is filtered to the scope channel', () => {
  const text = [
    'chan/ex-1',
    JSON.stringify({
      id: 'ex-1', providerID: 'chan', name: 'Ex 1', family: 'ex', status: 'active', release_date: '2026-10-01',
      api: { url: 'https://example.invalid/v1' }, cost: { input: 1 }, limit: { context: 1000, output: 100 },
      capabilities: { reasoning: true }, variants: { low: {}, high: {} },
    }, null, 2),
    'other/ex-2',
    JSON.stringify({ id: 'ex-2', providerID: 'other', name: 'Ex 2' }),
  ].join('\n');
  const rows = parseVerboseChannel(text, 'chan');
  assert.deepEqual(rows, [{
    id: 'chan/ex-1',
    label: 'Ex 1',
    evidence: { family: 'ex', status: 'active', releaseDate: '2026-10-01', contextLimit: 1000, outputLimit: 100, reasoning: true, variants: ['low', 'high'] },
  }]);
  assert.doesNotMatch(JSON.stringify(rows), /example\.invalid|input/);
  parseFailure(() => parseVerboseChannel(text, 'missing'));
  parseFailure(() => parseVerboseChannel('{"orphan": true}', 'chan'));
});

test('the Cline provider block is read without executing the bundle', () => {
  const bundle = [
    'var a={"other":{"other/x":{name:"Other"}}};',
    'var b={"chan":{"chan/ex-1":{name:"Ex 1",note:"a } and a \\" in a string",id:"chan/ex-1",contextWindow:1000,releaseDate:"2026-09-22"},',
    '"chan/ex-2":{name:"chan/ex-2",reasoningOptions:[{type:"toggle"}],pricing:{input:0}}},"after":{"after/z":{name:"Z"}}};',
  ].join('');
  assert.deepEqual(parseClineProviderBlock(bundle, 'chan'), [
    { id: 'chan/ex-1', label: 'Ex 1', evidence: { releaseDate: '2026-09-22', contextWindow: 1000 } },
    { id: 'chan/ex-2', label: 'chan/ex-2', evidence: { reasoningOptions: ['toggle'] } },
  ]);
  parseFailure(() => parseClineProviderBlock(bundle, 'absent'));
});

test('cursor-agent --list-models lines lose their status markers', () => {
  const output = '\u001b[2KLoading models...\nAvailable models\n\nex-1 - Ex 1 (default)\nex-1-fast - Ex 1 Fast (current)\nTip: use --model\n';
  assert.deepEqual(parseCursorListModels(output), [
    { id: 'ex-1', label: 'Ex 1', evidence: { listMarkedDefault: true } },
    { id: 'ex-1-fast', label: 'Ex 1 Fast' },
  ]);
  parseFailure(() => parseCursorListModels('Loading models...\n'));
});

test('MSP model/list keeps the catalog source and per-row variants', () => {
  assert.deepEqual(projectMuseModelList({
    source: 'bundledCatalog',
    providerId: 'p',
    profileId: 'private',
    models: [
      { modelId: 'ex-1', displayLabel: 'ex-1', variants: ['low', 'high'], isDefault: true, isActive: true, releaseDate: '2026-09-02', contextLimit: 10, cost: null },
      { modelId: 'ex-2', displayLabel: 'ex-2' },
    ],
  }), {
    rows: [
      { id: 'ex-1', label: 'ex-1', efforts: ['low', 'high'], evidence: { releaseDate: '2026-09-02', contextLimit: 10, mspIsDefault: true } },
      { id: 'ex-2', label: 'ex-2', efforts: null },
    ],
    catalogSource: 'bundledCatalog',
  });
});

test('a non-account Muse reply falls back to the account cache for the same profile', () => withScratch((root) => {
  const dir = join(root, 'model-catalog');
  mkdirSync(dir);
  const row = (id, visibility, tiers, isDefault = false) => ({
    model_id: id, display_label: id, visibility, release_date: '2026-10-01', context_limit: 10, output_limit: 5,
    is_default: isDefault, cost: { input: 1 }, roles: [],
    reasoning_effort_variants: tiers ? tiers.map((tier) => ({ tier, description: null })) : null,
  });
  const cache = (profile, rows, source = 'provider_catalog') => JSON.stringify({
    schema_version: 3, provider_id: 'p', profile_id: profile, source, rows });
  writeFileSync(join(dir, 'a__p01.json'), cache('other', [row('wrong-profile', 'visible', ['low'])]));
  writeFileSync(join(dir, 'b__p02.json'), cache('private', [row('bundled-only', 'visible', ['low'])], 'bundled'));
  writeFileSync(join(dir, 'c__p03.json'), cache('private', [row('ex-a', 'visible', ['low', 'max']), row('ex-a-contributor', 'hidden', ['low'], true)]));
  writeFileSync(join(dir, 'd.json'), '{not json');
  const install = { version: '9.9.9-R1' };
  const reply = { source: 'bundledCatalog', providerId: 'p', profileId: 'private', museHome: root, models: [] };

  const fromCache = museProbeResult(install, reply);
  assert.equal(fromCache.status, undefined);
  assert.deepEqual([fromCache.sourceClass, fromCache.catalogSource, fromCache.cliVersion], ['cli-account-cache', 'accountCache', '9.9.9-R1']);
  assert.deepEqual(fromCache.models, [
    { id: 'ex-a', label: 'ex-a', efforts: ['low', 'max'], hidden: false, evidence: { releaseDate: '2026-10-01', contextLimit: 10, outputLimit: 5 } },
    { id: 'ex-a-contributor', label: 'ex-a-contributor', efforts: ['low'], hidden: true,
      evidence: { releaseDate: '2026-10-01', contextLimit: 10, outputLimit: 5, cacheIsDefault: true } },
  ]);
  assert.match(fromCache.notes[0], /^MSP answered from "bundledCatalog", .*c__p03\.json, source provider_catalog, written \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\), not from a live server read\.$/);
  assert.match(museProbeResult(install, reply, { now: Date.now() + 30 * 86400000 }).notes[0], /It is (30|31) days old/);

  const live = museProbeResult(install, { ...reply, source: 'providerCatalog', models: [{ modelId: 'live' }] });
  assert.deepEqual([live.status, live.sourceClass, live.models.map((model) => model.id)], [undefined, undefined, ['live']]);
  for (const missing of [{ profileId: 'absent' }, { museHome: undefined }, { providerId: undefined }]) {
    const degraded = museProbeResult(install, { ...reply, ...missing });
    assert.deepEqual([degraded.status, degraded.reason, degraded.sourceClass], ['degraded', 'non-account-source', undefined]);
  }
}));

test('versions and Claude release-note signals', () => {
  assert.equal(parseVersion('grok 1.0.46 (2765805b9442) [alpha]'), '1.0.46');
  assert.equal(parseVersion('kiro-cli-chat 2.27.0'), '2.27.0');
  assert.equal(parseVersion('2026.10.01-e373342'), '2026.10.01-e373342');
  assert.equal(parseVersion('no version here'), null);
  const signals = claudeChangelogSignals({
    sections: [
      { version: '9.9.3', entries: ['Made Ex 9.1 the default for /model', 'Fixed retries when the model refuses a request'] },
      { version: '9.9.2', entries: ['Fixed the spend meter for a model call'] },
      { version: '9.9.1', entries: ['Added Sonnet 9 to the picker', 'Changed effort levels', 'Added the opus[1m] alias'] },
    ],
  });
  assert.deepEqual(signals, [
    { version: '9.9.3', entries: ['Made Ex 9.1 the default for /model'] },
    { version: '9.9.1', entries: ['Added Sonnet 9 to the picker', 'Changed effort levels', 'Added the opus[1m] alias'] },
  ]);
});

// --- process helpers ---------------------------------------------------------------------------

test('npm shims resolve to their node script; other wrappers do not', () => {
  const npmShim = '@ECHO off\r\nSET "_prog=node"\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@ex\\cli\\bin\\ex.js" %*\r\n';
  // An absolute path on every platform; CI runs on Linux.
  const shimPath = resolve(tmpdir(), 'npm-prefix', 'ex.cmd');
  const resolved = resolveNpmShimScript(shimPath, () => npmShim);
  assert.equal(resolved, join(dirname(shimPath), 'node_modules', '@ex', 'cli', 'bin', 'ex.js'));
  assert.equal(resolveNpmShimScript('ex.cmd', () => '@echo off\r\n"%~dp0ex.exe" %*\r\n'), null);
  assert.equal(resolveNpmShimScript('missing.cmd', () => { throw new Error('ENOENT'); }), null);
  assert.deepEqual(launchSpec('/usr/bin/ex', ['models'], { platform: 'linux' }), { command: '/usr/bin/ex', args: ['models'] });
});

test('the cleaned environment drops terminal, host-agent and named provider variables', () => {
  const env = cleanEnv({
    PATH: 'p', HOME: 'h', TERM: 'xterm', CI: '1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', KIRO_X: '1', AWS_EXECUTION_ENV: 'x', KEEP: 'k',
  }, { dropPrefixes: ['KIRO_'], drop: ['AWS_EXECUTION_ENV'], set: { OPENCODE_DISABLE_AUTOUPDATE: 'true' } });
  assert.deepEqual(env, { PATH: 'p', HOME: 'h', KEEP: 'k', OPENCODE_DISABLE_AUTOUPDATE: 'true' });
});

test('family matching keeps version boundaries', () => {
  const opus = familyPattern('ex-opus-5[thinking=true,effort=high]');
  assert.ok(opus.test('ex-opus-5'));
  assert.ok(opus.test('ex-opus-5-thinking-high'));
  assert.ok(!opus.test('ex-opus-5-5-low'));
  assert.ok(!opus.test('ex-opus-50'));
  const grok = familyPattern('grok-4.6[effort=high,fast=true]');
  assert.ok(grok.test('cursor-grok-4.6-high-fast'));
  assert.ok(!grok.test('grok-4.61'));
  assert.ok(!familyPattern('ex-5.6').test('ex-5x6'));
});

// --- comparison --------------------------------------------------------------------------------

const EFFORT = 'ex.reasoning_effort';
function effortControl(values, defaultValue) {
  return [{ key: EFFORT, label: 'Effort', kind: 'enum', values: values.map((value) => ({ value, label: value })), ...(defaultValue ? { default: defaultValue } : {}) }];
}

function fullScope(overrides = {}) {
  return {
    provider: 'ex', backend: 'cli', selection_mode: 'full', cli_version: '1.0.0', last_updated: '2026-01-01',
    models: [
      { id: 'a', label: 'Ex A', execution: { model: 'a' }, controls: effortControl(['low', 'high'], 'low') },
      { id: 'b', label: 'Ex B', execution: { model: 'b' }, controls: [] },
      { id: 'c', label: 'Ex C', execution: { model: 'c-low', variants: [{ model: 'c-low', when: { x: 'low' } }, { model: 'c-high', when: { x: 'high' } }] } },
    ],
    ...overrides,
  };
}

function source(overrides = {}) {
  return {
    provider: 'ex', backend: 'cli', transport: null, sourceClass: 'machine-readable', command: 'ex models',
    coverage: { membership: 'complete', label: true, efforts: EFFORT, effortDefault: true },
    status: 'ok', cliVersion: '1.0.0',
    models: [
      { id: 'a', label: 'Ex A', efforts: ['low', 'high'], effortDefault: 'low' },
      { id: 'b', label: 'Ex B', efforts: null },
      { id: 'c-low', label: 'Ex C' },
      { id: 'c-high', label: 'Ex C high' },
    ],
    ...overrides,
  };
}

const kinds = (summary) => summary.findings.map((finding) => `${finding.kind}:${finding.audience}:${finding.subject}`);

test('a matching source confirms every entry, including every variant', () => {
  const summary = compareScope(source({ coverage: { membership: 'complete', efforts: EFFORT, effortDefault: true } }), fullScope());
  assert.deepEqual(summary.confirmedEntries, ['a', 'b', 'c']);
  assert.deepEqual(summary.findings, []);
  assert.equal(summary.verdict, 'none');
  assert.equal(summary.listConfirmed, true);
});

test('new rows, absent wire ids and field drift go to an agent', () => {
  const summary = compareScope(source({
    cliVersion: '1.1.0',
    models: [
      { id: 'a', label: 'Ex A2', efforts: ['low', 'high'], effortDefault: 'high' },
      { id: 'b', label: 'Ex B', efforts: ['low'] },
      { id: 'c-low', label: 'Ex C' },
      { id: 'd', label: 'Ex D' },
      { id: 'secret', label: 'Hidden', hidden: true },
    ],
  }), fullScope());
  assert.deepEqual(kinds(summary), [
    'version-changed:info:cli_version',
    'field-drift:agent:a',
    'field-drift:agent:a',
    'field-drift:agent:b',
    'absent-from-source:agent:c-high',
    'new-candidate:agent:d',
    'hidden-upstream:info:1 rows',
  ]);
  assert.deepEqual(summary.findings.filter((finding) => finding.subject === 'a').map((finding) => finding.field), ['label', 'effortDefault']);
  const labelDrift = summary.findings.find((finding) => finding.field === 'label' && finding.subject === 'a');
  assert.deepEqual([labelDrift.catalog, labelDrift.observed], ['Ex A', 'Ex A2']);
  assert.equal(summary.findings.find((finding) => finding.subject === 'b').field, 'efforts');
  assert.deepEqual(summary.counts, { confirmed: 0, newCandidates: 1, drift: 3, absent: 1, hidden: 0, acknowledged: 0 });
  assert.equal(summary.verdict, 'agent');
  assert.equal(summary.listConfirmed, false);
});

test('effort-default drift is reported once the values agree', () => {
  const summary = compareScope(source({ coverage: { membership: 'complete', efforts: EFFORT, effortDefault: true }, models: [
    { id: 'a', efforts: ['low', 'high'], effortDefault: 'high' }, { id: 'b' }, { id: 'c-low' }, { id: 'c-high' },
  ] }), fullScope());
  assert.deepEqual(kinds(summary), ['field-drift:agent:a']);
  assert.equal(summary.findings[0].field, 'effortDefault');
});

test('a catalog entry on a hidden row needs an agent', () => {
  const summary = compareScope(source({ coverage: { membership: 'complete' }, models: [
    { id: 'a' }, { id: 'b', hidden: true }, { id: 'c-low' }, { id: 'c-high' },
  ] }), fullScope());
  assert.deepEqual(kinds(summary), ['hidden-in-source:agent:b']);
});

test('shortlists and superset sources report other upstream rows as information', () => {
  const shortlist = compareScope(source({ coverage: { membership: 'complete' }, models: [...source().models, { id: 'z1' }, { id: 'z2' }] }), fullScope({ selection_mode: 'shortlist' }));
  assert.deepEqual(kinds(shortlist), ['upstream-only:info:2 rows']);
  const superset = compareScope(source({ coverage: { membership: 'superset' }, models: [...source().models, { id: 'z1' }] }), fullScope());
  assert.deepEqual(kinds(superset), ['upstream-only:info:1 rows']);
  assert.equal(superset.verdict, 'info');
});

test('a degraded source makes model findings inconclusive and asks the operator', () => {
  const summary = compareScope(source({ status: 'degraded', reason: 'non-account-source', message: 'fallback list', coverage: { membership: 'complete' }, models: [{ id: 'a' }] }), fullScope());
  assert.deepEqual(kinds(summary), [
    'source-degraded:operator:non-account-source',
    'absent-from-source:info:b',
    'absent-from-source:info:c-low',
    'absent-from-source:info:c-high',
  ]);
  assert.ok(summary.findings.slice(1).every((finding) => finding.inconclusive));
  assert.equal(summary.verdict, 'operator');
});

test('source failures go to the operator or an agent by reason', () => {
  const missing = compareScope(source({ status: 'unavailable', reason: 'not-installed', message: 'not found', models: [] }), fullScope());
  assert.deepEqual(kinds(missing), ['source-unavailable:operator:not-installed']);
  const broken = compareScope(source({ status: 'error', reason: 'parse', message: 'changed', models: [] }), fullScope());
  assert.deepEqual(kinds(broken), ['source-unavailable:agent:parse']);
  assert.match(broken.findings[0].nextAction, /update this probe source/);
});

test('permission failures from native and nested helpers ask for host access, not catalog edits', async () => {
  for (const error of [Object.assign(new Error('denied'), { code: 'EACCES' }),
    new SourceFailure('error', 'parse', 'spawnSync java.exe EPERM')]) {
    const result = await runSource({ ...source(), probe: async () => { throw error; } });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'permission-denied');
    const summary = compareScope(result, fullScope());
    assert.equal(summary.verdict, 'operator');
    assert.match(summary.findings[0].nextAction, /host approval/);
  }
  // Old snapshots can be revalidated without launching their CLIs again.
  const legacy = compareScope(source({ status: 'error', reason: 'internal', message: 'spawn EPERM' }), fullScope());
  assert.equal(legacy.verdict, 'operator');
});

test('failed, degraded and different-transport scopes cannot make an acknowledgement stale', () => {
  const acknowledgements = validateAcknowledgements({ schemaVersion: 1, acknowledgements: [
    { provider: 'ex', kind: 'absent-from-source', subject: 'withdrawn', reason: 'source gap', evidence: 'docs/x.md', acknowledgedOn: '2026-10-04' },
  ] });
  for (const patch of [{ status: 'error' }, { status: 'unavailable' }, { status: 'degraded' }, { transport: 'other' }]) {
    const report = validateSnapshot({ snapshot: snapshotOf([source(patch)]), catalogDocument: { catalogs: [fullScope()] }, acknowledgements });
    assert.equal(report.general.filter((item) => item.kind === 'stale-acknowledgement').length, 0);
  }
  const degraded = compareScope(source({ status: 'degraded', reason: 'non-account-source' }), fullScope());
  assert.equal(degraded.counts.confirmed, 0);
  assert.ok(degraded.comparison.entries.every((entry) => entry.status === 'inconclusive'));
});

test('an unreadable Claude changelog cannot retire acknowledgements; permission signals need host action', () => {
  const acknowledgements = validateAcknowledgements({ schemaVersion: 1, acknowledgements: [
    { provider: 'ex', kind: 'capture-needed', subject: 'picker', reason: 'already captured', evidence: 'docs/x.md', acknowledgedOn: '2026-10-04' },
  ] });
  for (const message of ['EACCES: permission denied, open binary', 'changelog not found']) {
    const snapshot = snapshotOf([source({ coverage: { membership: 'none' }, signals: [{ kind: 'changelog-unreadable', message }] })]);
    const report = validateSnapshot({ snapshot, catalogDocument: { catalogs: [fullScope()] }, acknowledgements });
    assert.deepEqual(report.general, []);
    assert.deepEqual(report.needsAgent, []);
    assert.deepEqual(report.needsOperator, message.startsWith('EACCES') ? ['ex/cli'] : []);
  }
});

test('the agent handoff carries only actionable scopes, relevant rows, inherited controls and exact snapshot paths', () => {
  const catalogDocument = { catalogs: [fullScope({ shared_controls: effortControl(['low', 'high']) }), fullScope({ provider: 'healthy' })] };
  const snapshot = snapshotOf([source({ models: [...source().models, { id: 'new', label: 'New' }] }), source({ provider: 'healthy' })]);
  const report = validateSnapshot({ snapshot, catalogDocument });
  const handoff = buildHandoff({ report, snapshot, catalogDocument, repo: '/repo', snapshotPath: '/private/original/snapshot.json', reportPath: '/elsewhere/report.json' });
  assert.deepEqual(handoff.scopes.map((scope) => scope.key), ['ex/cli']);
  assert.deepEqual(handoff.scopes[0].rows.map((row) => row.id), ['c-low', 'c-high', 'new']);
  assert.deepEqual(handoff.scopes[0].entries[0].controls, catalogDocument.catalogs[0].shared_controls);
  assert.equal(handoff.scopes[0].source.coverage.efforts, EFFORT);
  assert.ok(handoff.scopes[0].evidenceCommand.includes('/private/original/snapshot.json'));
  assert.equal(handoff.commands.validate.at(-1), '/private/original/snapshot.json');
  assert.ok(handoff.scopes[0].findings.every((finding) => finding.audience === 'agent'));
  assert.ok(!JSON.stringify(handoff).includes('healthy'));
});

test('a family source checks parameterized entries by family only', () => {
  const scope = fullScope({ selection_mode: 'shortlist', models: [
    { id: 'ex-5[effort=high]', label: 'Ex 5 High', execution: { model: 'ex-5[effort=high]' } },
    { id: 'ex-6[fast=true]', label: 'Ex 6 Fast', execution: { model: 'ex-6[fast=true]' } },
  ] });
  const summary = compareScope(source({ coverage: { membership: 'family' }, models: [{ id: 'ex-5-high' }, { id: 'ex-5-5-low' }, { id: 'other' }] }), scope);
  assert.deepEqual(kinds(summary), ['absent-from-source:agent:ex-6[fast=true]', 'upstream-only:info:2 rows']);
  assert.deepEqual(summary.confirmedEntries, ['ex-5[effort=high]']);
});

test('a source without enumeration asks for a capture only when picker notes appeared', () => {
  const quiet = compareScope(source({ coverage: { membership: 'none' }, models: [], cliVersion: '1.0.1', signals: [{ kind: 'changelog', sections: [] }] }), fullScope());
  assert.deepEqual(kinds(quiet), ['version-changed:info:cli_version', 'no-automatic-source:info:picker']);
  const loud = compareScope(source({ coverage: { membership: 'none' }, models: [], cliVersion: '1.0.1', signals: [{ kind: 'changelog', sections: [{ version: '1.0.1', entries: ['Added Ex 2 to /model'] }] }] }), fullScope());
  assert.deepEqual(kinds(loud), ['version-changed:info:cli_version', 'capture-needed:agent:picker', 'no-automatic-source:info:picker']);
  assert.deepEqual(loud.findings[1].observed, ['1.0.1: Added Ex 2 to /model']);
});

test('build numbers are not compared with release versions, and source notes surface', () => {
  const summary = compareScope(source({ coverage: { membership: 'complete' }, cliVersion: '3419.26', versionKind: 'build', notes: ['scope unknown'] }), fullScope());
  assert.deepEqual(kinds(summary), ['version-not-comparable:info:cli_version', 'source-note:info:source']);
});

test('the comparison keeps every entry side by side with its listed row', () => {
  const summary = compareScope(source({
    models: [
      { id: 'a', label: 'Ex A2', efforts: ['low', 'high'], effortDefault: 'low' },
      { id: 'b', label: 'Ex B', efforts: null, hidden: true },
      { id: 'c-low', label: 'Ex C' },
      { id: 'd', label: 'Ex D' },
      { id: 'secret', label: 'Hidden', hidden: true },
    ],
  }), fullScope());
  const { comparison } = summary;
  assert.equal(comparison.comparable, true);
  assert.equal(comparison.labelCompared, true);
  assert.equal(comparison.effortsCompared, EFFORT);
  assert.deepEqual(comparison.entries.map((entry) => [entry.id, entry.status]), [['a', 'drift'], ['b', 'hidden'], ['c', 'absent']]);
  const a = comparison.entries[0];
  assert.deepEqual(a.observed, { id: 'a', label: 'Ex A2', efforts: ['low', 'high'], effortDefault: 'low' });
  assert.deepEqual(a.controls, [{ key: EFFORT, values: ['low', 'high'], default: 'low' }]);
  assert.deepEqual(a.findings.map((index) => summary.findings[index].field), ['label']);
  assert.deepEqual(comparison.entries[2].wires, [{ id: 'c-low', listed: true, hidden: false }, { id: 'c-high', listed: false }]);
  assert.deepEqual(comparison.upstream.map((row) => [row.id, row.status]), [['d', 'new'], ['secret', 'hidden']]);

  const unverified = compareScope(source({ coverage: { membership: 'none' }, models: [] }), fullScope());
  assert.deepEqual(unverified.comparison.entries.map((entry) => entry.status), ['unverified', 'unverified', 'unverified']);
  const failed = compareScope(source({ status: 'error', reason: 'parse', models: [] }), fullScope());
  assert.equal(failed.comparison.comparable, false);
  const family = compareScope(source({ coverage: { membership: 'family' }, models: [{ id: 'a-x' }, { id: 'a-y' }, { id: 'b' }, { id: 'c-low' }, { id: 'c-high' }] }), fullScope());
  assert.deepEqual(family.comparison.entries[0].wires, [{ id: 'a', listed: true, matches: ['a-x', 'a-y'], hidden: false }]);
});

// --- report ------------------------------------------------------------------------------------

function snapshotOf(sources, selection = 'all') {
  return { schemaVersion: 1, kind: 'cats-catalog-probe-snapshot', createdAt: '2026-10-02T00:00:00.000Z', selection, sources };
}

test('acknowledgements match the exact finding and are reported stale otherwise', () => {
  const acks = validateAcknowledgements({
    schemaVersion: 1,
    acknowledgements: [
      { provider: 'ex', kind: 'new-candidate', subject: 'd', reason: 'operator left it out', evidence: 'docs/x.md', acknowledgedOn: '2026-10-02' },
      { provider: 'ex', kind: 'field-drift', subject: 'a', field: 'label', observed: 'Something else', reason: 'old', evidence: 'docs/y.md', acknowledgedOn: '2026-10-02' },
      { provider: 'ex', kind: 'absent-from-source', subject: 'gone', reason: 'old gap', evidence: 'docs/z.md', acknowledgedOn: '2026-10-02' },
      { provider: 'unprobed', kind: 'new-candidate', subject: 'q', reason: 'other provider', evidence: 'docs/q.md', acknowledgedOn: '2026-10-02' },
    ],
  });
  const report = validateSnapshot({
    snapshot: snapshotOf([source({ models: [...source().models.slice(1), { id: 'a', label: 'Ex A2', efforts: ['low', 'high'], effortDefault: 'low' }, { id: 'd' }] })], ['ex']),
    catalogDocument: { catalogs: [fullScope(), { provider: 'other', backend: 'cli', selection_mode: 'full', models: [] }] },
    acknowledgements: acks,
  });
  const [scope] = report.scopes;
  const candidate = scope.findings.find((finding) => finding.kind === 'new-candidate');
  assert.equal(candidate.audience, 'none');
  assert.equal(candidate.audienceBeforeAcknowledgement, 'agent');
  assert.deepEqual(candidate.acknowledged, { reason: 'operator left it out', evidence: 'docs/x.md', acknowledgedOn: '2026-10-02' });
  assert.equal(scope.findings.find((finding) => finding.field === 'label').audience, 'agent');
  assert.equal(scope.counts.acknowledged, 1);
  assert.equal(scope.counts.newCandidates, 0);
  assert.equal(scope.comparison.upstream.find((row) => row.id === 'd').status, 'acknowledged');
  assert.equal(scope.comparison.entries.find((entry) => entry.id === 'a').status, 'drift');
  assert.deepEqual(report.needsAgent, ['ex/cli']);
  assert.deepEqual(report.general.map((finding) => finding.subject), ['ex:field-drift:a', 'ex:absent-from-source:gone']);
  assert.deepEqual(report.unprobedScopes, []);
  assert.equal(exitCodeFor(report), 2);
  assert.throws(() => validateAcknowledgements({ schemaVersion: 1, acknowledgements: [{ provider: 'ex', kind: 'x', subject: 'y' }] }), /needs a non-empty "reason"/);
});

test('a subjectPattern acknowledges a whole class of findings and can go stale', () => {
  const acks = validateAcknowledgements({
    schemaVersion: 1,
    acknowledgements: [
      { provider: 'ex', kind: 'new-candidate', subjectPattern: '^fusion-', reason: 'operator excluded fusion', evidence: 'docs/x.md', acknowledgedOn: '2026-10-14' },
      { provider: 'ex', kind: 'new-candidate', subjectPattern: '^MODEL_', reason: 'operator excluded legacy ids', evidence: 'docs/x.md', acknowledgedOn: '2026-10-14' },
    ],
  });
  const report = validateSnapshot({
    snapshot: snapshotOf([source({ models: [...source().models, { id: 'fusion-a-b' }, { id: 'fusion-a-c' }, { id: 'e' }] })], ['ex']),
    catalogDocument: { catalogs: [fullScope()] },
    acknowledgements: acks,
  });
  const [scope] = report.scopes;
  assert.deepEqual(scope.findings.filter((finding) => finding.kind === 'new-candidate').map((finding) => `${finding.subject}:${finding.audience}`),
    ['fusion-a-b:none', 'fusion-a-c:none', 'e:agent']);
  assert.equal(scope.counts.acknowledged, 2);
  assert.deepEqual(report.general.map((finding) => finding.subject), ['ex:new-candidate:^MODEL_']);
  assert.throws(() => validateAcknowledgements({ schemaVersion: 1, acknowledgements: [{ provider: 'ex', kind: 'x', subject: 'y', subjectPattern: 'z', reason: 'r', evidence: 'e', acknowledgedOn: 'd' }] }), /exactly one/);
  assert.throws(() => validateAcknowledgements({ schemaVersion: 1, acknowledgements: [{ provider: 'ex', kind: 'x', subjectPattern: '(', reason: 'r', evidence: 'e', acknowledgedOn: 'd' }] }), /invalid "subjectPattern"/);
});

test('a full run lists curated scopes that have no source', () => {
  const report = validateSnapshot({
    snapshot: snapshotOf([source()]),
    catalogDocument: { catalogs: [fullScope(), { provider: 'other', backend: 'cli', selection_mode: 'full', models: [] }, { provider: 'disc', backend: 'api', transport: 't', selection_mode: 'discovery' }] },
    environment: { personalOverride: '/home/x/.cats/runtime/config/curated-model-catalogs.yaml' },
  });
  assert.deepEqual(report.unprobedScopes, ['other/cli']);
  assert.equal(report.general[0].kind, 'personal-override');
  assert.equal(report.verdict, 'info');
  assert.equal(exitCodeFor(report), 0);
  const text = renderTerminal(report, { reportDir: 'tmp/x', reportPath: '/abs/report.json' });
  assert.match(text, /clean \(notes only\)/);
  assert.doesNotMatch(text, /Hand this to an agent/);
});

// --- catalog bases (SPEC-045 FR-8) --------------------------------------------------------------

const REGION = (id) => ({ id, label: `${id} (label)` });
function regionCatalogs() {
  return [
    fullScope({ basis: { region: REGION('global') } }),
    fullScope({ basis: { id: 'cn', region: REGION('cn') }, models: [fullScope().models[0]] }),
  ];
}
const withNew = () => source({ models: [...source().models, { id: 'd', label: 'Ex D' }] });
const basisReport = (src, extra = {}) => validateSnapshot({ snapshot: snapshotOf([src]), catalogDocument: { catalogs: regionCatalogs() }, ...extra });

test('without a sign-in marker a multi-basis target is compared with its first basis, unconfirmed', () => {
  const report = basisReport(withNew());
  const [scope] = report.scopes;
  assert.equal(scope.key, 'ex/cli');
  assert.deepEqual([scope.basis.how, scope.basis.confirmed, scope.basis.others], ['first', false, ['ex/cli#cn']]);
  assert.deepEqual(kinds(scope), ['basis-unconfirmed:operator:ex/cli', 'new-candidate:info:d']);
  assert.equal(scope.findings[1].basisUnconfirmed, true);
  assert.equal(scope.findings[1].inconclusive, true);
  assert.equal(scope.findings[0].basisUnconfirmed, undefined);
  assert.match(scope.findings[0].nextAction, /--basis ex=<id>/);
  // Nothing counts as confirmed against a basis the sign-in may not use.
  assert.deepEqual(scope.confirmedEntries, []);
  assert.equal(scope.listConfirmed, false);
  assert.ok(scope.comparison.entries.every((entry) => entry.status === 'inconclusive'));
  assert.deepEqual([report.needsAgent, report.needsOperator], [[], ['ex/cli']]);
});

test('a capture is not asked for on an unconfirmed basis either', () => {
  const picker = source({ coverage: { membership: 'none' }, cliVersion: '1.1.0', models: [],
    signals: [{ kind: 'changelog', sections: [{ version: '1.1.0', entries: ['Added model x'] }] }] });
  const confirmed = validateSnapshot({ snapshot: snapshotOf([picker]), catalogDocument: { catalogs: [fullScope()] } }).scopes[0];
  assert.ok(kinds(confirmed).includes('capture-needed:agent:picker'));
  const report = basisReport(picker);
  assert.deepEqual(kinds(report.scopes[0]), ['basis-unconfirmed:operator:ex/cli', 'version-changed:info:cli_version',
    'capture-needed:info:picker', 'no-automatic-source:info:picker']);
  assert.ok(report.scopes[0].findings.slice(1).every((finding) => finding.basisUnconfirmed));
  assert.deepEqual(report.needsAgent, []);
});

test('the renderers show the compared basis and its findings', () => {
  for (const report of [basisReport(withNew()), basisReport(source({ basis: { marker: { region: 'cn' } } }))]) {
    const key = report.scopes[0].key;
    const terminal = renderTerminal(report, { reportDir: 'tmp/x', reportPath: '/abs/report.json' });
    const markdown = renderMarkdown(report, { reportPath: '/abs/report.json' });
    const html = renderHtml(report, { handoff: null, files: {} });
    for (const text of [terminal, markdown, html]) {
      assert.ok(text.includes(key), key);
      assert.doesNotMatch(text, /undefined/);
    }
    const basisMessage = report.scopes[0].findings.find((finding) => finding.kind.startsWith('basis-')).message;
    assert.ok(markdown.includes(basisMessage.slice(0, 40)), 'markdown carries the basis finding');
    assert.ok(html.includes(escapeHtml(basisMessage.slice(0, 40))), 'html carries the basis finding');
  }
});

test('the sign-in marker or --basis picks the compared basis, and only that basis', () => {
  const detected = basisReport(source({ basis: { marker: { region: 'cn' } } })).scopes[0];
  assert.equal(detected.key, 'ex/cli#cn');
  assert.deepEqual([detected.basis.how, detected.basis.id, detected.basis.confirmed], ['detected', 'cn', true]);
  assert.deepEqual(kinds(detected), ['basis-compared:info:ex/cli#cn', 'new-candidate:agent:b', 'new-candidate:agent:c-low', 'new-candidate:agent:c-high']);
  assert.match(detected.findings[0].message, /Compared with the cn \(label\) basis \(detected\)\. Not compared: ex\/cli\./);
  assert.deepEqual(detected.confirmedEntries, ['a']);

  // --basis beats the marker; a recorded request is reused by validate.
  const requested = basisReport(source({ basis: { marker: { region: 'cn' } } }), { requestedBases: new Map([['ex', 'first']]) }).scopes[0];
  assert.deepEqual([requested.key, requested.basis.how, requested.verdict], ['ex/cli', 'requested', 'info']);
  assert.equal(basisReport(source({ basis: { requested: 'cn' } })).scopes[0].key, 'ex/cli#cn');

  // A recorded basis the catalog no longer has is reported, never swapped for the first.
  const gone = basisReport(source({ basis: { requested: 'retired' } })).scopes[0];
  assert.deepEqual(kinds(gone), ['basis-missing:operator:retired']);
  assert.equal(gone.comparison, undefined);
});

test('a sign-in no captured basis covers is the owner\'s call, and a bare marker changes nothing today', () => {
  const uncovered = basisReport({ ...withNew(), basis: { marker: { region: 'eu' } } }).scopes[0];
  assert.deepEqual(kinds(uncovered), ['basis-not-captured:operator:region eu', 'new-candidate:info:d']);
  assert.equal(uncovered.basis.confirmed, false);
  assert.match(uncovered.findings[0].nextAction, /Ask the owner before adding a basis/);

  // Today's Kimi scope records no region: the marker is kept, and the report is as before.
  const plain = validateSnapshot({ snapshot: snapshotOf([withNew()]), catalogDocument: { catalogs: [fullScope()] } }).scopes[0];
  const marked = validateSnapshot({ snapshot: snapshotOf([{ ...withNew(), basis: { marker: { region: 'global' } } }]), catalogDocument: { catalogs: [fullScope()] } }).scopes[0];
  assert.deepEqual(kinds(marked), kinds(plain));
  assert.equal(marked.verdict, 'agent');
  assert.deepEqual(marked.basis.marker, { region: 'global' });
  assert.equal(plain.basis, undefined);
  // Once that scope records global, a mainland sign-in is no longer silently compared with it.
  const single = validateSnapshot({ snapshot: snapshotOf([{ ...withNew(), basis: { marker: { region: 'cn' } } }]),
    catalogDocument: { catalogs: [fullScope({ basis: { region: REGION('global') } })] } }).scopes[0];
  assert.deepEqual(kinds(single), ['basis-not-captured:operator:region cn', 'new-candidate:info:d']);

  // Bases on different channels are not a sign-in question: the probe lists the chosen channel.
  const channels = validateSnapshot({ snapshot: snapshotOf([source()]), catalogDocument: { catalogs: [
    fullScope({ basis: { channel: { id: 'go', label: 'go' } } }),
    fullScope({ basis: { id: 'zen', channel: { id: 'zen', label: 'zen' } } }),
  ] } }).scopes[0];
  assert.deepEqual([channels.basis.how, channels.basis.confirmed, channels.verdict], ['first', true, 'info']);
  assert.deepEqual(kinds(channels), ['basis-compared:info:ex/cli']);
});

test('acknowledgements name their basis; without basisId they cover the first basis', () => {
  const acks = validateAcknowledgements({ schemaVersion: 1, acknowledgements: [
    { provider: 'ex', kind: 'new-candidate', subject: 'b', reason: 'first-basis gap', evidence: 'docs/x.md', acknowledgedOn: '2026-11-16' },
    { provider: 'ex', basisId: 'cn', kind: 'new-candidate', subject: 'b', reason: 'not on cn', evidence: 'docs/y.md', acknowledgedOn: '2026-11-16' },
  ] });
  const onCn = basisReport(source({ basis: { marker: { region: 'cn' } } }), { acknowledgements: acks });
  assert.equal(onCn.scopes[0].findings.find((finding) => finding.subject === 'b').acknowledged.reason, 'not on cn');
  // The first-basis acknowledgement is not stale just because cn was compared.
  assert.deepEqual(onCn.general, []);
  const onFirst = basisReport(source({ basis: { requested: 'first' } }), { acknowledgements: acks });
  assert.deepEqual(onFirst.general.map((item) => item.kind), ['stale-acknowledgement']);
  assert.match(onFirst.general[0].message, /first-basis gap/);
  // An unconfirmed comparison retires nothing.
  assert.deepEqual(basisReport(source(), { acknowledgements: acks }).general, []);
  assert.throws(() => validateAcknowledgements({ schemaVersion: 1, acknowledgements: [{ ...acks[1], basisId: ' ' }] }), /empty "basisId"/);
});

test('the handoff and evidence follow the compared basis', () => withScratch((root) => {
  const catalogDocument = { catalogs: regionCatalogs() };
  const snapshot = snapshotOf([source({ basis: { marker: { region: 'cn' } } })]);
  const report = validateSnapshot({ snapshot, catalogDocument });
  const handoff = buildHandoff({ report, snapshot, catalogDocument, repo: '/repo', snapshotPath: '/s/snapshot.json', reportPath: '/s/report.json' });
  assert.deepEqual(handoff.scopes.map((scope) => scope.key), ['ex/cli#cn']);
  assert.deepEqual(handoff.scopes[0].basis, catalogDocument.catalogs[1].basis);
  assert.deepEqual(handoff.scopes[0].basisChoice, { id: 'cn', how: 'detected', marker: { region: 'cn' } });
  assert.deepEqual(handoff.scopes[0].rows.map((row) => row.id), ['b', 'c-low', 'c-high']);
  assert.ok(handoff.instructions.some((line) => /never another basis/.test(line)));
  const scopeArg = handoff.scopes[0].evidenceCommand[handoff.scopes[0].evidenceCommand.indexOf('--scope') + 1];
  assert.equal(scopeArg, 'ex/cli#cn');
  const [picked] = selectSnapshotSources(snapshot, scopeArg);
  assert.equal(picked, snapshot.sources[0]);
  assert.deepEqual(selectorBases(`${scopeArg},ex`), ['cn', null]);
  const document = buildEvidence({ snapshot, source: picked, basisId: 'cn' });
  assert.deepEqual([document.basisId, document.signIn], ['cn', { region: 'cn' }]);
  assert.equal(buildEvidence({ snapshot: snapshotOf([source()]), source: source() }).basisId, undefined);
  assert.ok(root);
}));

test('the probe lists each CLI for its chosen basis and records only the request and the marker', async () => {
  const catalogDocument = { catalogs: regionCatalogs() };
  const listedFor = [];
  const run = async (src, { scope }) => {
    listedFor.push(scope.basis.id ?? 'first');
    return { ...source(), provider: src.provider };
  };
  const detected = await probeSources({ sources: [source()], catalogDocument, detect: () => ({ region: 'cn' }), run });
  assert.deepEqual(listedFor, ['cn']);
  assert.deepEqual(detected.sources[0].basis, { marker: { region: 'cn' } });
  const requested = await probeSources({ sources: [source()], catalogDocument, detect: () => ({ region: 'cn' }), run,
    requestedBases: new Map([['ex', 'first']]) });
  assert.deepEqual(listedFor, ['cn', 'first']);
  assert.deepEqual(requested.sources[0].basis, { requested: 'first', marker: { region: 'cn' } });
  const unmarked = await probeSources({ sources: [source()], catalogDocument: { catalogs: [fullScope()] }, detect: () => null,
    run: async () => source() });
  assert.equal(unmarked.sources[0].basis, undefined);

  // --basis is checked against the catalog before any CLI starts.
  assert.deepEqual([...parseBasisOption('cn', ['ex'])], [['ex', 'cn']]);
  assert.deepEqual([...parseBasisOption('ex=cn,other=first', ['ex', 'other'])], [['ex', 'cn'], ['other', 'first']]);
  assert.throws(() => parseBasisOption('cn', ['ex', 'other']), /exactly one selected provider/);
  assert.throws(() => parseBasisOption('nope=cn', ['ex']), /does not include/);
  assert.throws(() => assertRequestedBases(new Map([['ex', 'eu']]), catalogDocument.catalogs, [source()]), /ex\/cli has no basis "eu". Known: first, cn\./);
  assertRequestedBases(new Map([['ex', 'first']]), catalogDocument.catalogs, [source()]);
  const failed = spawnSync(process.execPath, [SCRIPT, 'probe', '--providers', 'kimi', '--basis', 'nope'], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /kimi\/cli has no basis "nope"/);
  assert.doesNotMatch(failed.stderr, /Probing/);
});

test('the Kimi sign-in marker is the region file alone', () => withScratch((root) => {
  const reads = [];
  const readText = (path) => {
    reads.push(path);
    return path.endsWith('region') ? ' mainland-cn \n' : 'secret';
  };
  assert.deepEqual(detectSignInMarker('kimi', { env: {}, home: root, readText }), { region: 'mainland-cn' });
  assert.deepEqual(reads, [join(root, '.kimi-code', 'region')]);
  assert.deepEqual(detectSignInMarker('kimi', { env: { KIMI_CODE_HOME: join(root, 'alt') }, home: root, readText }), { region: 'mainland-cn' });
  assert.equal(reads.at(-1), join(root, 'alt', 'region'));
  assert.equal(detectSignInMarker('kimi', { env: {}, home: root, readText: () => '{"token":1}' }), null);
  assert.equal(detectSignInMarker('kimi', { env: {}, home: root }), null);
  mkdirSync(join(root, '.kimi-code'));
  writeFileSync(join(root, '.kimi-code', 'region'), 'global\n');
  assert.deepEqual(detectSignInMarker('kimi', { env: {}, home: root }), { region: 'global' });
  assert.equal(detectSignInMarker('copilot', { env: {}, home: root, readText }), null);
  assert.deepEqual(readKimiRegion(join(root, '.kimi-code')), 'global');
}));

test('renderers name the agent scopes and give a hand-off prompt', () => {
  const report = validateSnapshot({
    snapshot: snapshotOf([source({ models: [...source().models, { id: 'd', label: 'Ex | D' }] })], ['ex']),
    catalogDocument: { catalogs: [fullScope()] },
  });
  const terminal = renderTerminal(report, { reportDir: 'tmp/x', reportPath: '/abs/report.json' });
  assert.match(terminal, /\[agent\] ex\/cli/);
  assert.match(terminal, /maintain-provider-model-catalogs skill\. Read .*agent-handoff\.json first \(scopes: ex\/cli\)/);
  assert.match(terminal, /Full report: \/abs\/report\.json/);
  const markdown = renderMarkdown(report, { reportPath: '/abs/report.json' });
  assert.match(markdown, /\| ex\/cli \| 1\.0\.0 \|/);
  assert.match(markdown, /\*\*new-candidate\*\* `d` \[agent\]: .*Ex \| D/);
  assert.match(markdown, /## Agent handoff/);
});

test('the HTML view escapes CLI text and marks differences', () => {
  const report = validateSnapshot({
    snapshot: snapshotOf([source({ models: [
      { id: 'a', label: '<img src=x onerror=alert(1)>', efforts: ['low', 'max'], effortDefault: 'max' },
      { id: 'b' }, { id: 'c-low', label: 'Ex C' }, { id: 'c-high' },
      { id: 'n', label: 'New "one"', efforts: ['low'], evidence: { description: '<b>bold</b>', contextLimit: 1000000 } },
    ] })], ['ex']),
    catalogDocument: { catalogs: [fullScope()] },
  });
  const html = renderHtml(report, { handoff: 'Use the skill on /abs/report.json', files: { 'report.json': 'report.json' } });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /New &quot;one&quot;/);
  assert.match(html, /<h1>1 scope needs an agent\.<\/h1>/);
  assert.match(html, /<details class="scope sheet v-agent" id="scope-ex-cli" data-filter="agent" open>/);
  // Each tally mark links to its ledger row, keyed by position so sanitized IDs cannot collide.
  assert.match(html, /<a class="mk m-drift" title="Ex A: Differs\. [^"]+" aria-label="Ex A: Differs" href="#scope-ex-cli-e0"><\/a>/);
  assert.match(html, /<tr id="scope-ex-cli-e0">/);
  assert.match(html, /<a class="mk m-new" [^>]*aria-label="New &quot;one&quot;: New" href="#scope-ex-cli-u0"><\/a>/);
  assert.match(html, /<tr id="scope-ex-cli-u0">/);
  assert.match(html, /<span class="st st-drift">Differs<\/span>/);
  assert.match(html, /<th colspan="2" scope="colgroup">In the catalog, captured with ex 1\.0\.0<\/th>/);
  assert.match(html, /<th colspan="2" scope="colgroup">Listed by ex 1\.0\.0 \(installed\)<\/th>/);
  assert.match(html, /<span class="chip del">high<\/span>/);
  assert.match(html, /<span class="chip add def def-diff" title="default">max<\/span>/);
  assert.match(html, /<details class="ev" open><summary>More from the CLI<\/summary>/);
  assert.match(html, /<dt>description<\/dt><dd>&lt;b&gt;bold&lt;\/b&gt;<\/dd>/);
  assert.match(html, /<dt>contextLimit<\/dt><dd>1,000,000<\/dd>/);
  assert.match(html, /<pre id="handoff">Use the skill on \/abs\/report\.json<\/pre>/);
  assert.match(html, /<a href="report\.json">report\.json<\/a>/);

  const clean = renderHtml(validateSnapshot({ snapshot: snapshotOf([source()]), catalogDocument: { catalogs: [fullScope()] } }));
  assert.match(clean, /Nothing to do/);
  assert.doesNotMatch(clean, /id="handoff"/);
  assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
});

// --- running sources and the command line ------------------------------------------------------

test('a source that cannot find its CLI is unavailable, not an error', async () => {
  const codex = SOURCES.find((candidate) => candidate.provider === 'codex');
  const result = await runSource(codex, { scope: null, env: { PATH: '' }, find: () => null });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'not-installed');
  assert.deepEqual(result.models, []);
});

test('a degraded source is tried once more and keeps the better answer', async () => {
  const flaky = (answers) => {
    let call = 0;
    return {
      provider: 'flaky', backend: 'cli', transport: null, sourceClass: 'machine-readable', command: 'flaky models', coverage: { membership: 'complete' },
      calls: () => call,
      async probe() {
        const answer = answers[call];
        call += 1;
        if (answer === 'fail') throw new SourceFailure('error', 'timeout', 'no answer');
        return answer === 'degraded'
          ? { models: [{ id: 'a' }], status: 'degraded', reason: 'not-authenticated', message: 'signed out' }
          : { models: [{ id: 'a' }, { id: 'b' }] };
      },
    };
  };

  const recovered = flaky(['degraded', 'ok']);
  const ok = await runSource(recovered, { scope: null });
  assert.equal(recovered.calls(), 2);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.models.length, 2);
  assert.deepEqual(ok.notes, ['The first attempt was degraded (not-authenticated); a second attempt answered normally.']);

  const still = await runSource(flaky(['degraded', 'degraded']), { scope: null });
  assert.equal(still.status, 'degraded');
  assert.equal(still.reason, 'not-authenticated');
  assert.deepEqual(still.notes, ['A second attempt was degraded too (not-authenticated).']);

  const failed = await runSource(flaky(['degraded', 'fail']), { scope: null });
  assert.equal(failed.status, 'degraded');
  assert.equal(failed.models.length, 1);
  assert.deepEqual(failed.notes, ['A second attempt returned error (timeout).']);

  const once = flaky(['ok']);
  assert.equal((await runSource(once, { scope: null })).notes, undefined);
  assert.equal(once.calls(), 1);
});

test('channel-scoped sources refuse a factory scope without a basis channel', async () => {
  const opencode = SOURCES.find((candidate) => candidate.provider === 'opencode');
  const result = await runSource(opencode, { scope: { provider: 'opencode', backend: 'cli' }, find: () => '/bin/opencode' });
  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'internal');
  assert.match(result.message, /basis\.channel/);
});

test('every source maps to a distinct scope and provider selection validates names', () => {
  const keys = SOURCES.map((candidate) => `${candidate.provider}/${candidate.backend}/${candidate.transport ?? ''}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(selectSources({ providers: 'kiro,codex' }).map((candidate) => candidate.provider), ['codex', 'kiro']);
  assert.ok(!selectSources({ skip: 'muse' }).some((candidate) => candidate.provider === 'muse'));
  assert.throws(() => selectSources({ providers: 'nope' }), /Unknown provider nope/);
});

function writeRepo(root, { stale = false } = {}) {
  const yaml = 'schema_version: 2\ncatalogs: []\n';
  const digest = createHash('sha256').update(yaml).digest('hex');
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@cats-inc/cats-runtime' }));
  writeFileSync(join(root, 'config', 'curated-model-catalogs.yaml.example'), yaml);
  writeFileSync(join(root, 'config', 'curated-model-catalogs.generated.json'), JSON.stringify({
    sourceDigest: stale ? 'stale' : digest,
    document: { schema_version: 2, catalogs: [fullScope()] },
  }));
  return root;
}

test('the kiro ACP reader keeps the model option, deletes its session and classifies failures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-probe-kiro-acp-'));
  try {
    await kiroAcpReaderChecks(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

async function kiroAcpReaderChecks(root) {
  const log = join(root, 'requests.log');
  const result = await readKiroModelOptions({
    command: process.execPath, args: [FAKE_KIRO_ACP, 'ok'], env: { ...process.env, FAKE_KIRO_ACP_LOG: log }, cwd: root, timeoutMs: 10000,
  });
  assert.equal(result.sessionId, 'sess_fake');
  assert.equal(result.sessionDeleted, true);
  assert.deepEqual(result.rows.map((row) => [row.id, row.efforts, row.effortDefault]),
    [['auto', [], null], ['ex-think', ['low', 'medium', 'high'], 'medium'], ['ex-plain', [], null]]);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['initialize', 'session/new', 'session/delete']);

  const failure = async (mode, timeoutMs = 10000) => {
    try {
      await readKiroModelOptions({ command: process.execPath, args: [FAKE_KIRO_ACP, mode], cwd: root, timeoutMs, modelOptionWaitMs: 100 });
    } catch (error) {
      assert.ok(error instanceof KiroAcpError, String(error));
      return [error.status, error.reason];
    }
    throw new Error(`mode ${mode} did not fail`);
  };
  assert.deepEqual(await failure('auth'), ['unavailable', 'not-signed-in']);
  assert.deepEqual(await failure('silent', 500), ['unavailable', 'timeout']);
  assert.deepEqual(await failure('no-model'), ['error', 'parse']);
}

test('the repository root is found from below and a stale generated catalog is refused', () => withScratch((root) => {
  writeRepo(root, { stale: true });
  mkdirSync(join(root, 'a', 'b'), { recursive: true });
  assert.equal(findRepoRoot(join(root, 'a', 'b')), root);
  assert.throws(() => loadFactory(root), /generated catalog is stale/);
}));

test('an evidence fixture carries the rows with their provenance and redaction', () => withScratch((root) => {
  const snapshot = snapshotOf([
    source({
      cliVersion: '1.2.0',
      versionSource: 'npm package',
      models: [
        { id: 'a', label: 'Ex A', evidence: { description: 'Ask owner@example.com' } },
        { id: 'b', label: 'Ex B' },
      ],
      sourceEvidence: { defaultModelId: 'a' },
    }),
    source({ provider: 'none', coverage: { membership: 'none' }, models: [] }),
    source({ provider: 'down', status: 'unavailable', reason: 'not-installed', models: [] }),
  ]);
  snapshot.host = { platform: 'win32', arch: 'x64', node: 'v24' };
  const [ex] = selectSnapshotSources(snapshot, 'ex/cli');
  assert.equal(selectSnapshotSources(snapshot, 'ex')[0], ex);
  assert.throws(() => selectSnapshotSources(snapshot, 'nope'), /has no scope "nope"/);

  const document = buildEvidence({ snapshot, source: ex, ids: ['a'] });
  assert.equal(document.kind, 'cats-catalog-probe-evidence');
  assert.equal(document.command, 'ex models');
  assert.equal(document.cliVersion, '1.2.0');
  assert.equal(document.observedAt, '2026-10-02T00:00:00.000Z');
  assert.deepEqual(document.host, { platform: 'win32', arch: 'x64' });
  assert.match(document.accountScope, /No identity is recorded/);
  assert.equal(document.completeness.membership, 'complete');
  assert.deepEqual(document.authoritativeFor, { ids: true, label: true, efforts: EFFORT, effortDefault: true });
  assert.deepEqual(document.selection, { ids: ['a'] });
  assert.deepEqual(document.sourceEvidence, { defaultModelId: 'a' });
  assert.deepEqual(document.models, [{ id: 'a', label: 'Ex A', evidence: { description: 'Ask <redacted-email>' } }]);
  assert.deepEqual(document.redaction.redactions, ['email']);
  assert.throws(() => buildEvidence({ snapshot, source: ex, ids: ['a', 'zz'] }), /Not in the ex\/cli snapshot: zz/);
  assert.throws(() => buildEvidence({ snapshot, source: selectSnapshotSources(snapshot, 'none')[0] }), /no read-only model list/);
  assert.throws(() => buildEvidence({ snapshot, source: selectSnapshotSources(snapshot, 'down')[0] }), /no listed rows/);

  const path = writeEvidence({ document, source: ex, fixturesRoot: root });
  assert.equal(path, join(root, 'ex-1.2.0', 'model-list.probe.redacted.json'));
  assert.throws(() => writeEvidence({ document, source: ex, fixturesRoot: root }), /already exists/);
  writeEvidence({ document, source: ex, fixturesRoot: root, force: true });
  assert.throws(() => writeEvidence({ document, source: ex, fixturesRoot: root, name: '../escape' }), /plain file stem/);
  assert.equal(evidenceDirectoryName({ provider: 'junie', cliVersion: '3419.26', versionKind: 'build' }), 'junie-build-3419.26');
  assert.equal(evidenceDirectoryName({ provider: 'x', cliVersion: null }), 'x-unknown-version');
}));

test('the evidence command writes a fixture and prints how to cite it', () => withScratch((root) => {
  writeRepo(root);
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshotOf([source({ cliVersion: '1.2.0' })])));
  const fixtures = join(root, 'docs', 'research', 'fixtures');
  const run = spawnSync(process.execPath, [SCRIPT, 'evidence', '--snapshot', snapshotPath, '--scope', 'ex', '--ids', 'a,b', '--repo', root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Wrote docs\/research\/fixtures\/ex-1\.2\.0\/model-list\.probe\.redacted\.json \(2 rows\)/);
  assert.match(run.stdout, /Cite in notes: "Evidence: docs\/research\/fixtures\/ex-1\.2\.0\/model-list\.probe\.redacted\.json"/);
  const written = JSON.parse(readFileSync(join(fixtures, 'ex-1.2.0', 'model-list.probe.redacted.json'), 'utf8'));
  assert.deepEqual(written.models.map((row) => row.id), ['a', 'b']);
  const again = spawnSync(process.execPath, [SCRIPT, 'evidence', '--snapshot', snapshotPath, '--scope', 'ex', '--repo', root], { encoding: 'utf8' });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
}));

test('validate re-checks a saved snapshot and writes both reports', () => withScratch((root) => {
  writeRepo(root);
  writeFileSync(join(root, 'config', 'catalog-probe-acknowledgements.json'), JSON.stringify({
    schemaVersion: 1,
    acknowledgements: [{ provider: 'ex', kind: 'new-candidate', subject: 'd', reason: 'left out', evidence: 'docs/x.md', acknowledgedOn: '2026-10-02' }],
  }));
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(snapshotOf([source({ models: [...source().models, { id: 'd' }, { id: 'e' }] })], ['ex'])));
  const run = spawnSync(process.execPath, [SCRIPT, 'validate', '--snapshot', snapshotPath, '--repo', root, '--out', join(root, 'out')], {
    encoding: 'utf8',
    env: { ...process.env, CATS_RUNTIME_DIR: join(root, 'runtime') },
  });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stdout, /needs an agent/);
  const report = JSON.parse(readFileSync(join(root, 'out', 'report.json'), 'utf8'));
  assert.deepEqual(report.scopes[0].findings.filter((finding) => finding.audience === 'agent').map((finding) => finding.subject), ['e']);
  assert.ok(existsSync(join(root, 'out', 'report.md')));
  assert.match(readFileSync(join(root, 'out', 'report.html'), 'utf8'), /<title>Catalog probe<\/title>/);
  assert.match(run.stdout, /View: file:\/\//);
  const handoff = JSON.parse(readFileSync(join(root, 'out', 'agent-handoff.json'), 'utf8'));
  assert.equal(handoff.snapshotPath, snapshotPath);
  assert.deepEqual(handoff.scopes[0].rows.map((row) => row.id), ['e']);
  assert.match(run.stdout, /agent-handoff\.json/);
  assert.match(run.stdout, /Agent input: \d+ bytes; full report: \d+ bytes/);
  const cleanSnapshot = snapshotOf([source()], ['ex']);
  writeFileSync(snapshotPath, JSON.stringify(cleanSnapshot));
  const cleanRun = spawnSync(process.execPath, [SCRIPT, 'validate', '--snapshot', snapshotPath, '--repo', root, '--out', join(root, 'out')], { encoding: 'utf8', env: { ...process.env, CATS_RUNTIME_DIR: join(root, 'runtime') } });
  assert.equal(cleanRun.status, 0, cleanRun.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'out', 'agent-handoff.json'), 'utf8')).scopes, []);

  const notSnapshot = join(root, 'other.json');
  writeFileSync(notSnapshot, '{"kind":"something-else"}');
  const refused = spawnSync(process.execPath, [SCRIPT, 'validate', '--snapshot', notSnapshot, '--repo', root], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /not a catalog probe snapshot/);
}));
