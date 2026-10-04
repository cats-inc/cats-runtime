#!/usr/bin/env node

// Operator-run catalog probe. `probe` reads each installed CLI's read-only model enumeration,
// writes a projected snapshot outside Git and validates it against the factory catalog;
// `validate` re-checks an existing snapshot. The report says which entries are confirmed, which
// need the operator (install, sign in, rerun) and which need an agent to investigate.
// It never edits the catalog, logs in, starts a session or sends a prompt.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { exitCodeFor, validateAcknowledgements, validateSnapshot } from './catalog-probe/compare.mjs';
import { buildEvidence, selectSnapshotSources, writeEvidence } from './catalog-probe/evidence.mjs';
import { renderHtml } from './catalog-probe/html.mjs';
import { buildHandoff } from './catalog-probe/handoff.mjs';
import { handoffPrompt, renderMarkdown, renderTerminal } from './catalog-probe/report.mjs';
import { runSource, SOURCES } from './catalog-probe/sources.mjs';

const PACKAGE_NAME = '@cats-inc/cats-runtime';
const GENERATED = join('config', 'curated-model-catalogs.generated.json');
const FACTORY = join('config', 'curated-model-catalogs.yaml.example');
export const ACKNOWLEDGEMENTS = join('config', 'catalog-probe-acknowledgements.json');
const CONCURRENCY = 4;

export function findRepoRoot(start) {
  let current = resolve(start);
  while (true) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest) && existsSync(join(current, GENERATED))) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).name === PACKAGE_NAME) return current;
      } catch {
        // Not the runtime manifest; keep walking.
      }
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Run this from a cats-runtime checkout (no ${PACKAGE_NAME} root above ${start}).`);
    current = parent;
  }
}

export function loadFactory(repo) {
  const generated = JSON.parse(readFileSync(join(repo, GENERATED), 'utf8'));
  const digest = createHash('sha256').update(readFileSync(join(repo, FACTORY), 'utf8')).digest('hex');
  if (generated.sourceDigest !== digest) {
    throw new Error('The generated catalog is stale. Run `npm run catalog:generate` first.');
  }
  return generated;
}

export function loadAcknowledgements(repo) {
  const path = join(repo, ACKNOWLEDGEMENTS);
  return existsSync(path) ? validateAcknowledgements(JSON.parse(readFileSync(path, 'utf8'))) : [];
}

function personalOverride(env) {
  const root = env.CATS_RUNTIME_DIR?.trim() || join(env.HOME || env.USERPROFILE || homedir(), '.cats', 'runtime');
  const path = join(isAbsolute(root) ? root : resolve(root), 'config', 'curated-model-catalogs.yaml');
  return existsSync(path) ? path : null;
}

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function providerList(value) {
  if (!value) return null;
  const names = value.split(',').map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !SOURCES.some((source) => source.provider === name));
  if (unknown.length) {
    throw new Error(`Unknown provider ${unknown.join(', ')}. Known: ${SOURCES.map((source) => source.provider).join(', ')}.`);
  }
  return names;
}

/** --providers keeps only the named sources; --skip drops CLIs this machine does not use. */
export function selectSources({ providers, skip } = {}) {
  const wanted = providerList(providers);
  const skipped = providerList(skip) ?? [];
  return SOURCES.filter((source) => (!wanted || wanted.includes(source.provider)) && !skipped.includes(source.provider));
}

export async function probeSources({ sources, catalogDocument, env = process.env, timeoutMs, onResult }) {
  const catalogs = catalogDocument.catalogs ?? [];
  const results = await mapLimited(sources, CONCURRENCY, async (source) => {
    const scope = catalogs.find((candidate) => candidate.provider === source.provider
      && candidate.backend === source.backend
      && (candidate.transport ?? null) === (source.transport ?? null));
    const result = await runSource(source, { scope, env, timeoutMs });
    onResult?.(result);
    return result;
  });
  return {
    schemaVersion: 1,
    kind: 'cats-catalog-probe-snapshot',
    createdAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, node: process.version },
    selection: sources.length === SOURCES.length ? 'all' : sources.map((source) => source.provider),
    sources: results,
  };
}

/** Opens a file with the desktop's default handler, detached, without waiting for it. */
function openInBrowser(path) {
  const [command, args, options] = process.platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `start "" "${path}"`], { windowsVerbatimArguments: true }]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [path], {}];
  try {
    spawn(command, args, { ...options, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    // The path is printed either way.
  }
}

function writeReport({ outDir, repo, report, snapshot, snapshotPath, catalogDocument, json, open }) {
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, 'report.json');
  const htmlPath = join(outDir, 'report.html');
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  const handoffJson = `${JSON.stringify(buildHandoff({
    report, snapshot, catalogDocument, repo, snapshotPath, reportPath,
  }), null, 2)}\n`;
  writeFileSync(reportPath, reportJson);
  writeFileSync(join(outDir, 'agent-handoff.json'), handoffJson);
  writeFileSync(join(outDir, 'report.md'), renderMarkdown(report, { reportPath }));
  const files = Object.fromEntries(['snapshot.json', 'report.json', 'report.md', 'agent-handoff.json']
    .filter((name) => existsSync(join(outDir, name)))
    .map((name) => [name, name]));
  const handoff = report.needsAgent.length ? handoffPrompt(report, reportPath) : null;
  writeFileSync(htmlPath, renderHtml(report, { handoff, files }));
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderTerminal(report, { reportDir: relative(repo, outDir) || outDir, reportPath }));
    if (report.needsAgent.length) {
      process.stdout.write(`Agent input: ${Buffer.byteLength(handoffJson)} bytes; full report: ${Buffer.byteLength(reportJson)} bytes.\n`);
    }
    process.stdout.write(`View: ${pathToFileURL(htmlPath).href}\n`);
  }
  if (open && !json) openInBrowser(htmlPath);
}

function usage() {
  return [
    'Usage:',
    '  catalog-probe.mjs probe [--providers codex,kiro | --skip muse,cursor] [--out <dir>] [--timeout <ms>] [--open] [--json]',
    '  catalog-probe.mjs validate --snapshot <snapshot.json> [--out <dir>] [--open] [--json]',
    '  catalog-probe.mjs evidence --snapshot <snapshot.json> --scope <provider[,provider]> [--ids a,b]',
    '                            [--name model-list.probe] [--fixtures-root <dir>] [--force]',
    '',
    'probe runs each installed CLI\'s read-only model enumeration, writes snapshot.json, report.json,',
    'report.md, report.html and agent-handoff.json under tmp/catalog-probe/<time>/ (outside Git).',
    '--open shows report.html in the default browser.',
    'validate re-checks a saved snapshot, for example after a catalog or acknowledgement change.',
    'evidence writes a scope\'s rows with their provenance as a committable redacted fixture under',
    'docs/research/fixtures/<cli>-<version>/; --ids keeps only those rows.',
    'Exit codes: 0 nothing to do, 2 the operator or an agent has something to do, 1 the tool failed.',
  ].join('\n');
}

function readSnapshot(path) {
  if (!path) throw new Error('This command needs --snapshot <snapshot.json>.');
  const snapshotPath = resolve(path);
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  if (snapshot.kind !== 'cats-catalog-probe-snapshot') throw new Error(`${snapshotPath} is not a catalog probe snapshot.`);
  return { snapshot, snapshotPath };
}

function writeEvidenceFixtures({ repo, values }) {
  const { snapshot } = readSnapshot(values.snapshot);
  if (!values.scope) throw new Error('evidence needs --scope <provider[,provider]>.');
  const sources = selectSnapshotSources(snapshot, values.scope);
  const ids = values.ids ? values.ids.split(',').map((id) => id.trim()).filter(Boolean) : null;
  if (ids && sources.length > 1) throw new Error('--ids works with one --scope at a time.');
  const fixturesRoot = values['fixtures-root'] ? resolve(values['fixtures-root']) : join(repo, 'docs', 'research', 'fixtures');
  const written = sources.map((source) => {
    const document = buildEvidence({ snapshot, source, ids });
    return { document, path: writeEvidence({ document, source, fixturesRoot, name: values.name, force: values.force }) };
  });
  for (const { document, path } of written) {
    const inside = relative(repo, path);
    const shown = inside.startsWith('..') || isAbsolute(inside) ? path : inside.split('\\').join('/');
    process.stdout.write(`Wrote ${shown} (${document.models.length} rows${document.redaction.redactions.length ? `, redacted: ${document.redaction.redactions.join(', ')}` : ''})\n`);
    process.stdout.write(`  Cite in notes: "Evidence: ${shown}"\n`);
  }
  process.stdout.write('Review each file before committing it; the redaction helper catches only common shapes.\n');
  return 0;
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      providers: { type: 'string' },
      skip: { type: 'string' },
      out: { type: 'string' },
      snapshot: { type: 'string' },
      timeout: { type: 'string' },
      repo: { type: 'string' },
      scope: { type: 'string' },
      ids: { type: 'string' },
      name: { type: 'string' },
      'fixtures-root': { type: 'string' },
      force: { type: 'boolean' },
      json: { type: 'boolean' },
      open: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0] ?? 'probe';
  if (values.help || !['probe', 'validate', 'evidence'].includes(command)) {
    process.stdout.write(`${usage()}\n`);
    return values.help ? 0 : 1;
  }
  const repo = findRepoRoot(values.repo ?? process.cwd());
  if (command === 'evidence') return writeEvidenceFixtures({ repo, values });
  const factory = loadFactory(repo);
  const acknowledgements = loadAcknowledgements(repo);
  const environment = { catalogSourceDigest: factory.sourceDigest, personalOverride: personalOverride(process.env) };

  let snapshot;
  let snapshotPath;
  let outDir;
  if (command === 'validate') {
    const read = readSnapshot(values.snapshot);
    snapshot = read.snapshot;
    snapshotPath = read.snapshotPath;
    outDir = values.out ? resolve(values.out) : dirname(read.snapshotPath);
  } else {
    const timeoutMs = values.timeout ? Number(values.timeout) : 60000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error('--timeout must be an integer of at least 1000 ms.');
    const sources = selectSources({ providers: values.providers, skip: values.skip });
    outDir = values.out ? resolve(values.out) : join(repo, 'tmp', 'catalog-probe', timestamp());
    if (!values.json) process.stderr.write(`Probing ${sources.length} CLI sources (read-only)...\n`);
    snapshot = await probeSources({
      sources,
      catalogDocument: factory.document,
      timeoutMs,
      onResult: values.json ? undefined : (result) => process.stderr.write(`  ${result.provider}: ${result.status}${result.reason ? ` (${result.reason})` : ''}\n`),
    });
    mkdirSync(outDir, { recursive: true });
    snapshotPath = join(outDir, 'snapshot.json');
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  const report = validateSnapshot({ snapshot, catalogDocument: factory.document, acknowledgements, environment });
  writeReport({ outDir, repo, report, snapshot, snapshotPath, catalogDocument: factory.document, json: values.json, open: values.open });
  return exitCodeFor(report);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
