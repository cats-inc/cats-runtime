// Keep this Node test out of Vitest's *.test.* auto-discovery.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readClaudeChangelog } from '../scripts/claude-changelog.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/claude-changelog.mjs');
const BS = String.fromCharCode(92);
const NL = `${BS}n`;

// A synthetic "binary": bytes around bundled code whose release notes are one escaped literal.
function writeFakeBinary(root) {
  const notes = [
    `## 9.9.3${NL}${NL}`,
    `- Added Example Model 9 (\`ex-9\`) ${BS}u2014 fast${NL}`,
    `- Fixed the picker${BS}'s count${NL}${NL}`,
    `## 9.9.2${NL}${NL}- Changed Ultracode into a toggle${NL}${NL}`,
    `## 9.9.1${NL}${NL}- Older entry${NL}`,
  ].join('');
  const decoy = `x='## 9.9.3${NL}- partial copy'`;
  const body = Buffer.concat([
    Buffer.from([0, 1, 2, 0x27, 3]),
    Buffer.from(`function a(){return'${notes}'}function b(){${decoy}}var c='## not a heading';`),
    Buffer.from([0xff, 0]),
  ]);
  const path = join(root, 'claude.bin');
  writeFileSync(path, body);
  return path;
}

function withScratch(run) {
  const root = mkdtempSync(join(tmpdir(), 'claude-changelog-test-'));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('reads the longest embedded notes literal and decodes its escapes', () => withScratch((root) => {
  const result = readClaudeChangelog({ binaryPath: writeFakeBinary(root) });
  assert.equal(result.newestEmbeddedVersion, '9.9.3');
  assert.equal(result.oldestEmbeddedVersion, '9.9.1');
  assert.deepEqual(result.sections.map((section) => section.version), ['9.9.3', '9.9.2', '9.9.1']);
  assert.deepEqual(result.sections[0].entries, [
    'Added Example Model 9 (`ex-9`) — fast',
    "Fixed the picker's count",
  ]);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
}));

test('keeps sections newer than --since and entries matching --grep', () => withScratch((root) => {
  const result = readClaudeChangelog({ binaryPath: writeFakeBinary(root), since: '9.9.1', grep: 'ultracode' });
  assert.deepEqual(result.sections, [
    { version: '9.9.3', entries: [] },
    { version: '9.9.2', entries: ['Changed Ultracode into a toggle'] },
  ]);
}));

test('reads a template literal, as builds from 2.1.286 embed it', () => withScratch((root) => {
  // Real line breaks, as 2.1.287 embeds them, alongside escaped quotes and backticks.
  const notes = [
    '## 9.9.5\n\n',
    `- Added a count such as ${BS}"2 of 5${BS}" and ${BS}\`code${BS}\`\n`,
    `- Fixed a path ending in ${BS}${BS}\n\n`,
    `## 9.9.4${NL}${NL}- Older entry${NL}`,
  ].join('');
  const path = join(root, 'template.bin');
  writeFileSync(path, Buffer.from(`function dr(){return\`${notes}\`}var x='unrelated';`));
  const result = readClaudeChangelog({ binaryPath: path, since: '9.9.4' });
  assert.equal(result.newestEmbeddedVersion, '9.9.5');
  assert.deepEqual(result.sections, [
    { version: '9.9.5', entries: ['Added a count such as "2 of 5" and `code`', `Fixed a path ending in ${BS}`] },
  ]);
}));

test('the command line prints JSON and rejects a binary without notes', () => withScratch((root) => {
  const ok = spawnSync(process.execPath, [SCRIPT, '--binary', writeFakeBinary(root), '--since', '9.9.2'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).sections.map((section) => section.version), ['9.9.3']);

  const empty = join(root, 'empty.bin');
  writeFileSync(empty, Buffer.from("var a='## later';"));
  const missing = spawnSync(process.execPath, [SCRIPT, '--binary', empty], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No embedded changelog literal/);

  const badSince = spawnSync(process.execPath, [SCRIPT, '--binary', empty, '--since', 'latest'], { encoding: 'utf8' });
  assert.equal(badSince.status, 1);
  assert.match(badSince.stderr, /--since must be a version/);
}));
