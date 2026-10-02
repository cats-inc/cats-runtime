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
import { findRepoRoot, loadFactory, selectSources } from '../scripts/catalog-probe.mjs';
import {
  compareScope,
  exitCodeFor,
  familyPattern,
  validateAcknowledgements,
  validateSnapshot,
} from '../scripts/catalog-probe/compare.mjs';
import { cleanEnv, launchSpec, resolveNpmShimScript } from '../scripts/catalog-probe/process.mjs';
import { buildEvidence, evidenceDirectoryName, selectSnapshotSources, writeEvidence } from '../scripts/catalog-probe/evidence.mjs';
import { escapeHtml, renderHtml } from '../scripts/catalog-probe/html.mjs';
import { renderMarkdown, renderTerminal } from '../scripts/catalog-probe/report.mjs';
import {
  claudeChangelogSignals,
  parseAgyModels,
  parseAuggieModelList,
  parseClineProviderBlock,
  parseCodexDebugModels,
  parseCursorListModels,
  parseDevinModelsList,
  parseGrokModels,
  parseKiroListModels,
  parseVerboseChannel,
  parseVersion,
  projectMuseModelList,
  runSource,
  SOURCES,
  SourceFailure,
} from '../scripts/catalog-probe/sources.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/catalog-probe.mjs');

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

  assert.deepEqual(parseAuggieModelList(JSON.stringify({
    registryAvailable: false,
    defaultModelId: 'a',
    models: [{ id: 'opaque_a', displayName: 'Ex (A + B)', costTier: 2, badges: [], effortLevels: ['low'], isDefault: true }],
  })), {
    rows: [{ id: 'opaque_a', label: 'Ex (A + B)', evidence: { costTier: 2, effortLevels: ['low'], jsonIsDefault: true } }],
    registryAvailable: false,
    defaultModelId: 'a',
  });

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

test('renderers name the agent scopes and give a hand-off prompt', () => {
  const report = validateSnapshot({
    snapshot: snapshotOf([source({ models: [...source().models, { id: 'd', label: 'Ex | D' }] })], ['ex']),
    catalogDocument: { catalogs: [fullScope()] },
  });
  const terminal = renderTerminal(report, { reportDir: 'tmp/x', reportPath: '/abs/report.json' });
  assert.match(terminal, /\[agent\] ex\/cli/);
  assert.match(terminal, /maintain-provider-model-catalogs skill .* \/abs\/report\.json \(scopes: ex\/cli\)/);
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
  assert.match(html, /<details class="scope" id="scope-ex-cli" data-filter="agent" open>/);
  assert.match(html, /class="pill s-drift"/);
  assert.match(html, /class="pill s-new"/);
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

  const notSnapshot = join(root, 'other.json');
  writeFileSync(notSnapshot, '{"kind":"something-else"}');
  const refused = spawnSync(process.execPath, [SCRIPT, 'validate', '--snapshot', notSnapshot, '--repo', root], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /not a catalog probe snapshot/);
}));
