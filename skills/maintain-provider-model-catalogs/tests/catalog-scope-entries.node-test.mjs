import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import {
  variantEntries, orderByCapture, clineEntries, devinEntries, cursorEntries, mergeExisting, spliceScopeModels,
} from '../scripts/catalog-scope-entries.mjs';

const row = (id, label, evidence = {}) => ({ id, label, evidence });

test('OpenCode/Kilo rows follow the picker order and put Default before the variants', () => {
  const entries = variantEntries([
    row('ex/old', 'Old', { releaseDate: '2026-01-01', variants: ['low', 'high'] }),
    row('ex/b', 'Beta', { releaseDate: '2026-05-01' }),
    row('ex/a', 'Alpha', { releaseDate: '2026-05-01', variants: ['thinking'] }),
    row('ex/gone', 'Gone', { releaseDate: '2026-09-01', status: 'deprecated' }),
  ], { key: 'ex.variant' });
  assert.deepEqual(entries.map((entry) => entry.id), ['ex/a', 'ex/b', 'ex/old']);
  assert.deepEqual(entries[0].controls[0].values, [{ value: 'default', label: 'Default' }, { value: 'thinking', label: 'thinking' }]);
  assert.equal(entries[0].controls[0].default, undefined);
  assert.deepEqual(entries[1].controls, []);
  assert.deepEqual(entries[2].execution, { model: 'ex/old' });
  assert.deepEqual(variantEntries([row('ex/z', 'Z'), row('ex/y', 'Y')], { key: 'k', order: 'source' }).map((entry) => entry.id), ['ex/z', 'ex/y']);
});

test('a captured picker section orders the rows and must cover each exactly once', () => {
  const rows = [row('ex/a', 'A'), row('ex/b', 'B')];
  assert.deepEqual(orderByCapture(rows, ['B', 'A']).map((entry) => entry.id), ['ex/b', 'ex/a']);
  assert.throws(() => orderByCapture(rows, ['B']), /missing from the picker: A/);
  assert.throws(() => orderByCapture(rows, ['B', 'A', 'C']), /"C" is not in the listed models/);
});

test('ClinePass keeps only subscribed rows, the approved label and the five thinking levels', () => {
  const entries = clineEntries([
    row('cline-pass/a', 'A'), row('cline-pass/raw-id', 'cline-pass/raw-id'), row('cline-free/a', 'A (free)'),
  ], { labels: { 'cline-pass/raw-id': 'Raw Id' } });
  assert.deepEqual(entries.map((entry) => [entry.id, entry.label]), [['cline-pass/a', 'A'], ['cline-pass/raw-id', 'Raw Id']]);
  assert.deepEqual(entries[0].execution, { model: 'cline-pass/a', provider: 'cline-pass' });
  const [control] = entries[0].controls;
  assert.equal(control.key, 'cline.reasoning_effort');
  assert.equal(control.default, 'medium');
  assert.deepEqual(control.values.map((value) => value.label), ['Off', 'Low', 'Medium', 'High', 'Extra High']);
  assert.notEqual(entries[0].controls[0], entries[1].controls[0]);
});

const devinRow = (id, label, family, familyLabel) => ({ id, label, evidence: { family, familyLabel } });

test('Devin families become effort and speed controls over exact variant UIDs', () => {
  const rows = [
    devinRow('adaptive', 'Adaptive', 'Adaptive', 'Adaptive'),
    devinRow('ex-1-medium', 'Ex 1 Medium', 'ex-1', 'Ex 1'),
    devinRow('ex-1-low', 'Ex 1 Low', 'ex-1', 'Ex 1'),
    devinRow('ex-1-medium-fast', 'Ex 1 Medium Fast', 'ex-1', 'Ex 1'),
    devinRow('ex-1-low-fast', 'Ex 1 Low Fast', 'ex-1', 'Ex 1'),
    devinRow('gx', 'GX High', 'gx', 'GX'),
    devinRow('gx-none', 'GX No Thinking', 'gx', 'GX'),
    devinRow('gx-1m', 'GX High 1M', 'gx', 'GX'),
    devinRow('gx-none-1m', 'GX No Thinking 1M', 'gx', 'GX'),
    devinRow('fusion-a-b', 'Fusion', 'fusion', 'Fusion'),
    devinRow('MODEL_OLD', 'Old', 'old', 'Old'),
  ];
  const entries = devinEntries(rows, { excludeFamilies: ['fusion'], excludeIds: [/^MODEL_/] });
  assert.deepEqual(entries.map((entry) => [entry.id, entry.label]), [
    ['adaptive', 'Adaptive'], ['ex-1-medium', 'Ex 1'], ['gx', 'GX'], ['gx-1m', 'GX 1M'],
  ]);
  assert.deepEqual(entries[0].controls, []);
  assert.equal(entries[0].execution.variants, undefined);
  const ex = entries[1];
  assert.deepEqual(ex.controls.map((control) => [control.key, control.values.map((value) => value.label)]), [
    ['devin.effort', ['Medium', 'Low']], ['devin.speed', ['Standard', 'Fast']],
  ]);
  assert.deepEqual(ex.execution.variants.find((variant) => variant.when['devin.effort'] === 'low' && variant.when['devin.speed'] === 'fast'),
    { when: { 'devin.effort': 'low', 'devin.speed': 'fast' }, model: 'ex-1-low-fast' });
  assert.equal(ex.execution.variants.length, 4);
  assert.deepEqual(entries[2].controls[0].values, [{ value: 'high', label: 'High' }, { value: 'none', label: 'No Thinking' }]);
  assert.deepEqual(entries[2].execution.variants.map((variant) => variant.model), ['gx', 'gx-none']);
  const ascending = devinEntries(rows, { effortOrder: 'ascending', excludeFamilies: ['fusion'], excludeIds: [/^MODEL_/] });
  assert.equal(ascending[1].id, 'ex-1-low');
  assert.throws(() => devinEntries([devinRow('ex-1-low', 'Ex 1 Low', 'ex-1', 'Ex 1'), devinRow('ex-1-low-fast', 'Ex 1 Low Fast', 'ex-1', 'Ex 1'),
    devinRow('ex-1-high', 'Ex 1 High', 'ex-1', 'Ex 1')]), /0 variants for high fast/);
  assert.throws(() => devinEntries([devinRow('ex-1-low', 'L', 'ex-1', 'Ex 1'), devinRow('ex-1-turbo', 'T', 'ex-1', 'Ex 1')]), /unknown variant token "turbo"/);
});

test('Devin keeps Lightning as a separate form with its exact effort UIDs', () => {
  const entries = devinEntries([
    devinRow('ex-high', 'Ex High', 'ex', 'Ex'),
    devinRow('ex-medium', 'Ex Medium', 'ex', 'Ex'),
    devinRow('ex-medium-lightning', 'Ex Medium Lightning', 'ex', 'Ex'),
    devinRow('ex-high-lightning', 'Ex High Lightning', 'ex', 'Ex'),
  ]);
  assert.deepEqual(entries.map(({ label }) => label), ['Ex', 'Ex Lightning']);
  assert.deepEqual(entries[1].controls[0].values, [
    { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
  ]);
  assert.deepEqual(entries[1].execution.variants.map(({ model }) => model),
    ['ex-medium-lightning', 'ex-high-lightning']);
  assert.equal(entries[1].controls.length, 1);
});

test('Cursor families need every parameter combination and keep the exact variant strings', () => {
  const family = {
    id: 'ex-5', label: 'Ex 5',
    parameterDefinitions: [
      { id: 'effort', name: 'Effort', values: [{ value: 'low', displayName: 'Low' }, { value: 'high', displayName: 'High' }] },
      { id: 'fast', name: 'Fast', values: [{ value: 'false' }, { value: 'true', displayName: 'Fast' }] },
    ],
    variants: [
      { variantStringRepresentation: 'ex-5[effort=low,fast=false]', parameters: { effort: 'low', fast: 'false' } },
      { variantStringRepresentation: 'ex-5[effort=low,fast=true]', parameters: { effort: 'low', fast: 'true' } },
      { variantStringRepresentation: 'ex-5[effort=high,fast=false]', parameters: { effort: 'high', fast: 'false' } },
      { variantStringRepresentation: 'ex-5[effort=high,fast=true]', parameters: { effort: 'high', fast: 'true' } },
    ],
  };
  const [entry] = cursorEntries([family, { id: 'gone', cliExcluded: true }]);
  assert.equal(entry.id, 'ex-5[effort=low,fast=false]');
  assert.deepEqual(entry.controls.map((control) => [control.key, control.values.map((value) => value.label)]), [
    ['cursor.effort', ['Low', 'High']], ['cursor.fast', ['Off', 'On']],
  ]);
  assert.equal(entry.execution.variants.length, 4);
  assert.deepEqual(cursorEntries([{ id: 'plain', pickerLabel: 'Plain', parameterDefinitions: [], variants: [{ variantStringRepresentation: 'plain[]', parameters: {} }] }])[0],
    { id: 'plain[]', label: 'Plain', execution: { model: 'plain[]' }, controls: [] });

  // Fast is missing at High: the family splits on Effort, and High keeps Fast off without a control.
  const split = cursorEntries([{ ...family, variants: family.variants.filter((variant) => variant.variantStringRepresentation !== 'ex-5[effort=high,fast=true]') }]);
  assert.deepEqual(split.map((part) => [part.id, part.label, part.controls.map((control) => control.key)]), [
    ['ex-5[effort=low,fast=false]', 'Ex 5 Low', ['cursor.fast']],
    ['ex-5[effort=high,fast=false]', 'Ex 5 High', []],
  ]);

  const value = (v) => ({ value: v });
  const cube = { id: 'cube', label: 'Cube', parameterDefinitions: ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), values: [value('1'), value('2')] })), variants: [] };
  for (const a of ['1', '2']) for (const b of ['1', '2']) for (const c of ['1', '2']) {
    if ((a === b && b === c)) continue;
    cube.variants.push({ variantStringRepresentation: `cube[a=${a},b=${b},c=${c}]`, parameters: [{ id: 'a', value: a }, { id: 'b', value: b }, { id: 'c', value: c }] });
  }
  assert.throws(() => cursorEntries([cube]), /no full parameter product, even split/);
  assert.throws(() => cursorEntries([{ ...family, variants: [{ variantStringRepresentation: 'ex-5[effort=low]', parameters: { effort: 'low' } }] }]), /lacks fast/);

  // The picker preselects the isDefaultNonMaxConfig variant; a thinking split is named like the row summary.
  const preset = cursorEntries([{
    id: 'ex-6', pickerLabel: 'Ex 6',
    parameterDefinitions: [
      { id: 'thinking', name: 'Thinking', parameterType: { booleanParameter: { values: [value('false'), value('true')] } } },
      { id: 'fast', name: 'Fast', values: [value('false'), value('true')] },
    ],
    variants: [
      { variantStringRepresentation: 'ex-6[thinking=false,fast=false]', parameters: { thinking: 'false', fast: 'false' } },
      { variantStringRepresentation: 'ex-6[thinking=true,fast=false]', parameters: { thinking: 'true', fast: 'false' }, isDefaultNonMaxConfig: true },
      { variantStringRepresentation: 'ex-6[thinking=true,fast=true]', parameters: { thinking: 'true', fast: 'true' } },
    ],
  }]);
  assert.deepEqual(preset.map((part) => [part.id, part.label, part.controls.map((control) => `${control.key}=${control.default}`)]), [
    ['ex-6[thinking=false,fast=false]', 'Ex 6 No Thinking', []],
    ['ex-6[thinking=true,fast=false]', 'Ex 6', ['cursor.fast=false']],
  ]);
});

test('existing tags and spellings survive a regeneration and only the target scope changes', () => {
  const merged = mergeExisting([{ id: 'a', label: 'A', execution: { model: 'a' }, controls: [] }, { id: 'n', label: 'N', execution: { model: 'n' }, controls: [] }],
    [{ id: 'a', label: 'A — Medium', capabilityTags: ['reasoning'], source_names: ['a'] }]);
  assert.deepEqual(merged[0], { id: 'a', label: 'A', capabilityTags: ['reasoning'], source_names: ['a', 'A — Medium'], execution: { model: 'a' }, controls: [] });
  assert.deepEqual(Object.keys(merged[1]), ['id', 'label', 'execution', 'controls']);

  const text = [
    'schema_version: 2',
    'catalogs:',
    '  - provider: ex',
    '    backend: agent',
    '    transport: acp_stdio',
    '    selection_mode: full',
    '    models:',
    '      - id: old',
    '        label: Old',
    '        execution:',
    '          model: old',
    '        controls: []',
    '    presets: []',
    '  - provider: ex',
    '    backend: cli',
    '    selection_mode: discovery',
    '    models: []',
    '',
  ].join('\n');
  const out = spliceScopeModels(text, { provider: 'ex', backend: 'agent', transport: 'acp_stdio' }, merged);
  const document = parse(out);
  assert.deepEqual(document.catalogs[0].models.map((entry) => entry.id), ['a', 'n']);
  assert.deepEqual(document.catalogs[0].presets, []);
  assert.deepEqual(document.catalogs[1], { provider: 'ex', backend: 'cli', selection_mode: 'discovery', models: [] });
  assert.throws(() => spliceScopeModels(text, { provider: 'missing', backend: 'cli' }, merged), /No missing\/cli scope/);
});
