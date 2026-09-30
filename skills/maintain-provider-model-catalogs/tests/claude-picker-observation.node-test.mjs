// Keep this Node test out of Vitest's *.test.* auto-discovery.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildClaudePickerObservation } from '../scripts/claude-picker-observation.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '../scripts/claude-picker-observation.mjs');
const NORMALIZER = join(HERE, '../scripts/normalize-picker-paste.mjs');
const BOM = String.fromCharCode(0xfeff);
const CHECK_MARK = String.fromCharCode(0x2714);

// Shaped like Capture-ClaudePicker.ps1 output: one adjustable row, the current row, and a row
// without effort. ConvertTo-Json writes a one-element EffortCycle as an object, not an array.
const CAPTURE = {
  CapturedModels: [
    { Index: 1, Label: 'Example Default', Current: false, Description: 'Example One', Unsupported: false,
      CycleComplete: true, EffortCycle: [
        { Line: '  High effort', Level: 'High', Default: false, Detail: [] },
        { Line: '  Low effort', Level: 'Low', Default: false, Detail: [] },
        { Line: '  Medium effort (default)', Level: 'Medium', Default: true, Detail: [] },
      ] },
    { Index: 2, Label: 'Example Alpha', Current: true, Description: 'Example Two', Unsupported: false,
      CycleComplete: true, EffortCycle: [
        { Line: '  High effort (default)', Level: 'High', Default: true, Detail: [] },
        { Line: '  Max effort', Level: 'Max', Default: false, Detail: ['Uses more tokens.'] },
      ] },
    { Index: 3, Label: 'Example Mini', Current: false, Description: 'Example Three', Unsupported: true,
      CycleComplete: true, EffortCycle: { Line: '  Effort not supported for Example Mini', Level: null, Default: false } },
  ],
};
const ROW_STATUS = [
  { Row: 2, Label: 'Example Alpha', StatusModel: 'alpha (example-alpha-1)' },
  { Row: 3, Label: 'Example Mini', StatusModel: 'example-mini-3' },
];

test('builds model and per-row effort observations with observed row values only', () => {
  const tree = buildClaudePickerObservation({ capture: CAPTURE, rowStatus: ROW_STATUS, artifact: 'fixture.txt' });
  const [list, ...efforts] = tree.observations;
  assert.deepEqual(list.nodes.map((node) => node.rawId), [null, 'alpha', 'example-mini-3']);
  assert.deepEqual(list.nodes.map((node) => node.selection), ['not-selected', 'selected', 'not-selected']);
  assert.equal(list.nodes[1].rawText, `2. Example Alpha ${CHECK_MARK}  Example Two`);
  assert.deepEqual(efforts[0].nodes.map((node) => `${node.label}:${node.defaultClaim}`),
    ['High:not-default', 'Low:not-default', 'Medium:default']);
  assert.deepEqual(efforts[2].nodes.map((node) => [node.kind, node.defaultClaim]), [['unknown', 'unknown']]);
  assert.equal(tree.source.artifact, 'fixture.txt');
  assert.equal(tree.expectedPaths.length, 3);
});

test('the tree passes the normalizer gap check, and the command line reads BOM-prefixed files', () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-observation-test-'));
  try {
    const capture = join(root, 'capture.json');
    const rows = join(root, 'rows.json');
    writeFileSync(capture, `${BOM}${JSON.stringify(CAPTURE)}`);
    writeFileSync(rows, `${BOM}${JSON.stringify(ROW_STATUS)}`);
    const built = spawnSync(process.execPath, [SCRIPT, '--capture', capture, '--row-status', rows], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const tree = join(root, 'observation.json');
    writeFileSync(tree, built.stdout);
    const gaps = spawnSync(process.execPath, [NORMALIZER, 'gaps', tree], { encoding: 'utf8' });
    assert.equal(gaps.status, 0, gaps.stderr);
    assert.deepEqual(JSON.parse(gaps.stdout).gaps, []);

    const missing = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /Usage:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a capture result without rows', () => {
  assert.throws(() => buildClaudePickerObservation({ capture: {} }), /no CapturedModels/);
});
