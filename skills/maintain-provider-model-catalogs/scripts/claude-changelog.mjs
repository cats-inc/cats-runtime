#!/usr/bin/env node

// Reads the release notes that an installed Claude Code binary embeds for its recent versions.
// The notes are one single-quoted JavaScript string literal that starts with "## <version>".
// This is static-artifact evidence: it says what a version changed, not what an account's
// picker offers. It never launches Claude Code and reads no settings or credentials.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const BACKSLASH = 0x5c;
const QUOTE = 0x27;
const HEADING = /^## (\d+\.\d+\.\d+)$/;

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

// Decodes the escapes a bundler writes into a single-quoted literal.
function decodeLiteral(raw) {
  return raw.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[^xu])/g, (_, escape) => {
    if (escape.length > 1) return String.fromCharCode(parseInt(escape.slice(1), 16));
    return { n: '\n', r: '\r', t: '\t', 0: '\0' }[escape] ?? escape;
  });
}

// Returns every single-quoted literal that starts with a version heading.
function findChangelogLiterals(buffer) {
  const needle = Buffer.from("'## ");
  const literals = [];
  for (let at = buffer.indexOf(needle); at >= 0; at = buffer.indexOf(needle, at + 1)) {
    const heading = buffer.subarray(at + 1, at + 40).toString('latin1');
    if (!/^## \d+\.\d+\.\d+\\n/.test(heading)) continue;
    let end = at + 1;
    while (end < buffer.length && !(buffer[end] === QUOTE && buffer[end - 1] !== BACKSLASH)) end += 1;
    literals.push(decodeLiteral(buffer.subarray(at + 1, end).toString('utf8')));
  }
  return literals;
}

function parseSections(text) {
  const sections = [];
  for (const line of text.split('\n')) {
    const heading = HEADING.exec(line.trim());
    if (heading) {
      sections.push({ version: heading[1], entries: [] });
    } else if (sections.length > 0 && line.startsWith('- ')) {
      sections[sections.length - 1].entries.push(line.slice(2));
    }
  }
  return sections;
}

export function readClaudeChangelog({ binaryPath, since, grep }) {
  const buffer = readFileSync(resolve(binaryPath));
  const literals = findChangelogLiterals(buffer);
  if (literals.length === 0) throw new Error('No embedded changelog literal was found in this binary.');
  // Prefer the literal with the most version sections when a bundle carries more than one.
  const sections = literals.map(parseSections).sort((a, b) => b.length - a.length)[0];
  const filter = grep ? new RegExp(grep, 'i') : null;
  const selected = sections
    .filter((section) => !since || compareVersions(section.version, since) > 0)
    .map((section) => ({
      version: section.version,
      entries: filter ? section.entries.filter((entry) => filter.test(entry)) : section.entries,
    }));
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    newestEmbeddedVersion: sections[0]?.version ?? null,
    oldestEmbeddedVersion: sections[sections.length - 1]?.version ?? null,
    since: since ?? null,
    grep: grep ?? null,
    sections: selected,
  };
}

function cliUsage() {
  return [
    'Usage:',
    '  claude-changelog.mjs --binary <claude executable> [--since <version>] [--grep <regex>]',
    '',
    'Prints the embedded release notes newer than --since (exclusive) as JSON. --grep keeps only',
    'matching entries, case-insensitively. A build embeds notes up to its previous release, so the',
    'newest section can be older than the binary itself.',
  ].join('\n');
}

function main() {
  try {
    const { values } = parseArgs({ options: {
      binary: { type: 'string' },
      since: { type: 'string' },
      grep: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    } });
    if (values.help || !values.binary) {
      process.stdout.write(`${cliUsage()}\n`);
      if (!values.help) process.exitCode = 1;
      return;
    }
    if (values.since && !/^\d+\.\d+\.\d+$/.test(values.since)) throw new Error('--since must be a version such as 2.1.282.');
    const result = readClaudeChangelog({ binaryPath: values.binary, since: values.since, grep: values.grep });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
