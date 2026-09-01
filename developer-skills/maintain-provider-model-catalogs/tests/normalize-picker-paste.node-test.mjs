// Keep this Node test out of Vitest's *.test.* auto-discovery.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assessIntakeDecision,
  computeObservationGaps,
  inspectObservationDocument,
  normalizePickerPaste,
  summarizeObservationDocument,
} from '../scripts/normalize-picker-paste.mjs';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function readJsonFixture(name) {
  return JSON.parse(await readFile(join(FIXTURE_ROOT, name), 'utf8'));
}

test('normalization preserves visible ordering and hierarchy while stripping controls', async () => {
  const cases = await readJsonFixture('picker-cases.json');
  const normalized = normalizePickerPaste(cases.ansiAndNested, { source: 'raw-picker.txt' });

  assert.equal(normalized.source, 'raw-picker.txt');
  assert.equal(normalized.lines[0].text, 'Models');
  assert.equal(normalized.lines[1].text, '┌ Select a model ┐');
  assert.equal(normalized.lines[2].text, '  › model-alpha  Alpha');
  assert.equal(normalized.lines[3].text, '      Reasoning');
  assert.equal(normalized.lines[4].text, '        High');
  assert.equal(normalized.lines[7].text, 'Account: <redacted-email>');
  assert.equal(normalized.lines[8].text, 'Authorization: <redacted-secret>');
  assert.ok(normalized.lines.every((line) => line.semanticStatus === 'unparsed'));
  assert.ok(normalized.lines.every((line) => !line.text.includes('\u001b')));
  assert.deepEqual(normalized.redactionTypes, ['email', 'secret-field']);
});

test('single-line confirmations and truncated pastes remain intact', async () => {
  const cases = await readJsonFixture('picker-cases.json');
  assert.equal(normalizePickerPaste(cases.singleLine).lines[0].text, cases.singleLine);
  const truncated = normalizePickerPaste(cases.truncated);
  assert.equal(truncated.lines.at(-1).text, '  …');
  assert.equal(truncated.lineCount, 4);

  const wrapped = normalizePickerPaste(cases.wrapped);
  assert.equal(wrapped.lines[0].text, '  model-gamma  A long visible description');
  assert.equal(wrapped.lines[1].text, '               continued by the terminal picker');

  const identifiers = normalizePickerPaste(cases.uuidIdentifiers);
  assert.equal(
    identifiers.lines[0].text,
    'Model: 123e4567-e89b-12d3-a456-426614174000',
  );
  assert.equal(identifiers.lines[1].text, 'Tenant ID: <redacted-identifier>');
  assert.deepEqual(identifiers.redactionTypes, ['context-uuid']);
});

test('summary and gap calculation preserve model-specific dependent branches', async () => {
  const document = await readJsonFixture('nested-observation.json');
  const inspection = inspectObservationDocument(document);
  assert.equal(inspection.gaps.length, 1);
  assert.deepEqual(inspection.gaps[0].path, ['model:beta', 'option:reasoning']);

  const gaps = computeObservationGaps(document);
  assert.equal(gaps.gaps.length, 1);
  assert.equal(gaps.observedPathCount, 7);
  assert.equal(
    inspection.rows.some(
      (row) => JSON.stringify(row.path) === JSON.stringify(['model:beta', 'option:reasoning']),
    ),
    false,
  );

  const summary = summarizeObservationDocument(document);
  assert.match(summary, /\| model-list \| — \| complete \|/);
  assert.match(summary, /model:alpha > option:reasoning > value:high > option:budget/);
  assert.match(summary, /Select Beta, then open its reasoning picker/);

  document.observations[0].completeness = 'partial';
  assert.match(
    summarizeObservationDocument(document),
    /\| model-list \| — \| partial \|/,
  );
});

test('a mismatched parent path is rejected instead of silently flattening the tree', async () => {
  const document = await readJsonFixture('nested-observation.json');
  document.observations[1].nodes[0].parentPath = [];
  assert.throws(
    () => inspectObservationDocument(document),
    /parentPath does not match its ordered tree position/,
  );
});

test('duplicate observation ids and node paths are rejected as ambiguous evidence', async () => {
  const duplicateObservation = await readJsonFixture('nested-observation.json');
  duplicateObservation.observations.push({ ...duplicateObservation.observations[0] });
  assert.throws(
    () => inspectObservationDocument(duplicateObservation),
    /duplicate observation id/,
  );

  const duplicateNode = await readJsonFixture('nested-observation.json');
  duplicateNode.observations[0].nodes.push({ ...duplicateNode.observations[0].nodes[0] });
  assert.throws(
    () => inspectObservationDocument(duplicateNode),
    /duplicate node path/,
  );
});

test('interaction policies and hard gates produce inspectable decision artifacts', async () => {
  const cases = await readJsonFixture('intake-decision-cases.json');
  for (const fixture of cases) {
    const actual = assessIntakeDecision(fixture.input);
    for (const [key, expected] of Object.entries(fixture.expected)) {
      assert.deepEqual(actual[key], expected, `${fixture.name}: ${key}`);
    }
  }

  const gated = assessIntakeDecision(cases[4].input);
  assert.deepEqual(gated.decisions[0].hardGates, ['list-completeness']);
  assert.deepEqual(
    gated.decisions[1].hardGates,
    ['list-completeness', 'deletion'],
  );
  assert.deepEqual(gated.decisions[2].hardGates, ['projection-loss']);
  assert.deepEqual(gated.decisions[3].hardGates, ['scope-expansion']);

  const resolved = assessIntakeDecision(cases[6].input);
  assert.equal(resolved.repositoryMutationAllowed, true);
  assert.deepEqual(resolved.readyChangeIds, ['add-alpha', 'remove-beta']);
});
