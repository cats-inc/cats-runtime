#!/usr/bin/env node

// Captures the account-resolved parameterized model list that the installed Cursor CLI already
// fetches for `cursor-agent --list-models`, and writes a projected, redacted JSON file.
//
// usage:
//   node capture-cursor-parameterized-models.mjs --output <file>
//        [--cli <install root | version dir | index.js | shim>] [--raw-output <file>]
//        [--fixture-output <file>] [--work-dir <dir>] [--timeout-ms 60000]
//
// Read-only contract: no login, no prompt, no agent run, no inference. The CLI runs
// `--list-models` once from an empty temporary directory with stdin closed and a bounded timeout
// (process tree killed on expiry). The process-local preload
// (capture-cursor-parameterized-models.preload.cjs) observes decoded replies in memory; installed
// files, config and auth state are not modified, and request headers are never read.
//
// Version-specific parts:
//   - install layout: <root>/versions/<YYYY.MM.DD[-HH-MM-SS]-commit>/{node(.exe),index.js}
//     (same rule as the cursor-agent shim; override with --cli)
//   - the preload's webpack module ids and RPC method names (see that file)
//   - picker semantics under `notes` were read from the 2026.10.01-e373342 bundle

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PRELOAD = path.join(HERE, 'capture-cursor-parameterized-models.preload.cjs');
const VERSION_DIR_RE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/;
export const EXIT = { ok: 0, usage: 2, timeout: 3, captureFailed: 4, unsafe: 5 };
// Families the 2026.10.01 model service drops before building its parameterized list.
export const CLI_EXCLUDED_FALLBACK = ['claude-4.5-haiku', 'claude-4.5-haiku-thinking', 'gemini-2.5-pro', 'gemini-2.5-flash'];

export class CaptureError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = 'CaptureError';
    this.exitCode = exitCode;
  }
}

const USAGE =
  'usage: node capture-cursor-parameterized-models.mjs --output <file> [--cli <path>] [--raw-output <file>] ' +
  '[--fixture-output <file>] [--work-dir <dir>] [--timeout-ms <ms>]';

export function parseCliArgs(argv) {
  const opts = { timeoutMs: 60000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new CaptureError(EXIT.usage, 'missing value for ' + a);
      return argv[++i];
    };
    if (a === '--output') opts.output = path.resolve(next());
    else if (a === '--raw-output') opts.rawOutput = path.resolve(next());
    else if (a === '--fixture-output') opts.fixtureOutput = path.resolve(next());
    else if (a === '--cli') opts.cli = path.resolve(next());
    else if (a === '--work-dir') opts.workDir = path.resolve(next());
    else if (a === '--timeout-ms') opts.timeoutMs = Number(next());
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new CaptureError(EXIT.usage, 'unknown argument ' + a);
  }
  if (opts.help) return opts;
  if (!opts.output) throw new CaptureError(EXIT.usage, '--output <file> is required');
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 5000 || opts.timeoutMs > 600000) {
    throw new CaptureError(EXIT.usage, '--timeout-ms must be 5000..600000');
  }
  return opts;
}

// ---------------------------------------------------------------- install --

export function versionSortKey(name) {
  const m = VERSION_DIR_RE.exec(name);
  if (!m) return null;
  const pad = (s) => String(s ?? '00').padStart(2, '0');
  return m[1] + pad(m[2]) + pad(m[3]) + pad(m[4]) + pad(m[5]) + pad(m[6]);
}

export function nodeBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'node.exe' : 'node';
}

function isVersionDir(dir) {
  return fs.existsSync(path.join(dir, 'index.js')) && fs.existsSync(path.join(dir, nodeBinaryName()));
}

// Newest complete version directory under <root>/versions, or null.
export function latestVersionDir(root) {
  const versions = path.join(root, 'versions');
  if (!fs.existsSync(versions)) return null;
  const candidates = fs
    .readdirSync(versions, { withFileTypes: true })
    .filter((d) => d.isDirectory() && versionSortKey(d.name))
    .map((d) => ({ name: d.name, key: versionSortKey(d.name) }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  for (const c of candidates) {
    const dir = path.join(versions, c.name);
    if (isVersionDir(dir)) return dir;
  }
  return null;
}

function defaultInstallRoots() {
  const roots = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'cursor-agent'));
  roots.push(path.join(os.homedir(), '.local', 'share', 'cursor-agent'));
  // Follow a cursor-agent / agent shim on PATH.
  const exts = process.platform === 'win32' ? ['.cmd', '.ps1', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const base of ['cursor-agent', 'agent']) {
      for (const ext of exts) {
        const p = path.join(dir, base + ext);
        try {
          if (!fs.statSync(p).isFile()) continue;
          const real = fs.realpathSync(p);
          roots.push(path.dirname(real));
          roots.push(path.dirname(path.dirname(path.dirname(real))));
        } catch {
          // not present
        }
      }
    }
  }
  return [...new Set(roots)];
}

export function resolveInstall(cliOpt) {
  const tried = [];
  const fromPath = (p) => {
    tried.push(p);
    if (!fs.existsSync(p)) return null;
    const st = fs.statSync(p);
    if (st.isFile()) {
      const real = fs.realpathSync(p);
      if (path.basename(real) === 'index.js' && isVersionDir(path.dirname(real))) return path.dirname(real);
      return fromPath(path.dirname(real));
    }
    if (isVersionDir(p)) return p;
    return latestVersionDir(p);
  };
  const versionDir = cliOpt ? fromPath(cliOpt) : defaultInstallRoots().map(fromPath).find(Boolean);
  if (!versionDir) {
    throw new CaptureError(EXIT.usage, 'no Cursor CLI version directory found (tried ' + tried.length + ' locations); pass --cli');
  }
  return {
    versionDir,
    version: path.basename(versionDir),
    node: path.join(versionDir, nodeBinaryName()),
    entry: path.join(versionDir, 'index.js'),
  };
}

export function displayPath(p) {
  const pairs = [];
  if (process.env.LOCALAPPDATA) pairs.push([process.env.LOCALAPPDATA, '%LOCALAPPDATA%']);
  pairs.push([os.homedir(), '~']);
  for (const [prefix, label] of pairs) {
    if (p.toLowerCase().startsWith(prefix.toLowerCase())) return label + p.slice(prefix.length);
  }
  return p;
}

// ---------------------------------------------------------- integrity ----

function snapshotTree(root, skip) {
  const out = {};
  const walk = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      const rel = path.relative(root, full);
      if (skip(rel)) continue;
      if (d.isDirectory()) walk(full);
      else {
        const st = fs.statSync(full);
        out[rel] = st.size + ':' + st.mtimeMs;
      }
    }
  };
  walk(root);
  return out;
}

export function diffSnapshots(before, after) {
  const changed = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[k] !== after[k]) changed.push({ path: k, before: before[k] ?? null, after: after[k] ?? null });
  }
  return changed;
}

function statMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- run CLI --

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}

function runCli(install, cwd, captureFile, timeoutMs) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS; // keep the preload out of any child process
  delete env.NODE_COMPILE_CACHE; // the shim sets this; skip cache writes
  env.CURSOR_INVOKED_AS = env.CURSOR_INVOKED_AS || 'cursor-agent';
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  env.CURSOR_PM_CAPTURE_FILE = captureFile;
  env.CURSOR_PM_WAIT_MS = String(Math.max(5000, timeoutMs - 15000));
  return new Promise((resolve) => {
    const child = spawn(install.node, ['--require', PRELOAD, install.entry, '--list-models'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, code: null, timedOut, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ pid: child.pid, code, timedOut, stdout, stderr });
    });
  });
}

// ------------------------------------------------------------- redaction --

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ACCOUNT_KEY_RE =
  /^(email|userEmail|ownerEmail|userId|teamId|orgId|organizationId|accountId|authId|ownerId|workspaceId|membershipId|subscriptionId|stripeCustomerId|[a-z]+(User|Team|Org|Account)Id)$/;
const OPAQUE_ID_RE = /\b(user_[A-Za-z0-9]{12,}|auth0\|[A-Za-z0-9]+|google-oauth2\|[0-9]+|github\|[0-9]+)\b/g;

// Replaces emails, account-id keys and opaque identity ids; counts what it replaced in `stats`.
export function redact(value, stats = { keys: 0, emails: 0, opaqueIds: 0 }) {
  if (Array.isArray(value)) return value.map((v) => redact(v, stats));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (ACCOUNT_KEY_RE.test(k) && v !== '' && v !== null && v !== undefined) {
        out[k] = '<redacted>';
        stats.keys += 1;
      } else out[k] = redact(v, stats);
    }
    return out;
  }
  if (typeof value === 'string') {
    let s = value.replace(EMAIL_RE, () => {
      stats.emails += 1;
      return '<redacted-email>';
    });
    s = s.replace(OPAQUE_ID_RE, () => {
      stats.opaqueIds += 1;
      return '<redacted-id>';
    });
    return s;
  }
  return value;
}

const SCAN_CHECKS = {
  atSign: /@/g,
  bearer: /bearer/gi,
  tokenKey: /"[A-Za-z_]*(access|refresh|auth|id|session|bearer|api|jwt)?_?token"\s*:/gi,
  jwt: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  secretKey: /\bsk-[A-Za-z0-9_-]{20,}/g,
  apiKey: /api_?key/gi,
  credentials: /credential/gi,
  authorization: /authorization/gi,
  cookie: /cookie/gi,
};
// Checks that block writing; atSign and credentials are reported only.
export const UNSAFE_CHECKS = ['bearer', 'tokenKey', 'jwt', 'secretKey', 'apiKey', 'authorization', 'cookie'];

// Counts suspicious patterns in serialized output. Samples are kept for local diagnosis only.
export function safetyScan(text) {
  const out = {};
  for (const [name, re] of Object.entries(SCAN_CHECKS)) {
    const hits = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) && hits.length < 10) {
      hits.push(text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' '));
    }
    out[name] = { count: (text.match(re) || []).length, samples: hits };
  }
  return out;
}

// Throws before anything is written when a blocking check hits. The message never echoes matches.
export function assertSafe(text, label) {
  const scan = safetyScan(text);
  const unsafe = UNSAFE_CHECKS.filter((k) => scan[k].count > 0);
  if (unsafe.length) {
    throw new CaptureError(EXIT.unsafe, 'refusing to write ' + label + '; safety scan hit: ' + unsafe.map((k) => k + '=' + scan[k].count).join(', '));
  }
  return scan;
}

// ------------------------------------------------------------ projection --

export function enumValuesOf(def) {
  const pt = def.parameterType || {};
  if (pt.enumParameter) return { kind: 'enum', values: pt.enumParameter.values || [] };
  if (pt.booleanParameter) {
    const vals = pt.booleanParameter.values || [];
    return { kind: 'boolean', values: vals.length ? vals : [{ value: 'false' }, { value: 'true' }], implicit: vals.length === 0 };
  }
  return { kind: 'unknown', values: [] };
}

function selectableValues(def) {
  const { values } = enumValuesOf(def);
  return values.some((v) => v.blockedByAdminAllowlist === true) ? values.filter((v) => v.blockedByAdminAllowlist !== true) : values;
}

// Replica of the CLI picker row summary (format-param-summary.ts, 2026.10.01).
export function pickerSummary(family, params) {
  const defs = family.parameterDefinitions || [];
  if (defs.length === 0 && (family.variants || []).length === 1) return '';
  if (params.length === 0) return '';
  const byId = new Map(params.map((p) => [p.id, p.value]));
  const parts = [];
  if (defs.length > 0) {
    for (const def of defs) {
      const v = byId.get(def.id);
      const pt = def.parameterType || {};
      if (pt.booleanParameter) {
        if (def.id === 'thinking') continue;
        if (v === 'true' && def.name) parts.push(def.name);
      } else if (pt.enumParameter && v) {
        const vals = pt.enumParameter.values || [];
        if (vals.length <= 1) continue;
        const found = vals.find((x) => x.value === v);
        parts.push((found && found.displayName) || v);
      }
    }
  } else {
    if (byId.get('reasoning')) parts.push(byId.get('reasoning'));
    if (byId.get('fast') === 'true') parts.push('Fast');
    if (byId.get('context')) parts.push(byId.get('context'));
  }
  if (byId.get('thinking') === 'false') parts.push('No Thinking');
  return parts.join(' ');
}

function crossProduct(lists) {
  return lists.reduce((acc, list) => acc.flatMap((prefix) => list.map((x) => [...prefix, x])), [[]]);
}

// Compares a family's listed variants with the cross-product of its selectable parameter values.
export function analyzeFamily(family) {
  const defs = family.parameterDefinitions || [];
  const variants = family.variants || [];
  const defIds = defs.map((d) => d.id);
  const valueLists = defs.map((d) => selectableValues(d).map((v) => v.value));
  const keyOf = (pairs) => pairs.map((p) => p.id + '=' + p.value).join(',');
  // With no definitions the product is the single empty combination (server lists it as `name[]`).
  const expected = crossProduct(valueLists).map((combo) => combo.map((value, i) => ({ id: defIds[i], value })));
  const expectedKeys = new Set(expected.map(keyOf));
  const listedKeys = new Map();
  const idMismatch = [];
  const outsideDefinitions = [];
  const stringMismatch = [];
  for (const v of variants) {
    const pv = v.parameterValues || [];
    const ids = pv.map((p) => p.id);
    const sameIds = ids.length === defIds.length && defIds.every((id) => ids.includes(id));
    const ordered = sameIds ? defIds.map((id) => pv.find((p) => p.id === id)) : [...pv].sort((a, b) => a.id.localeCompare(b.id));
    const key = keyOf(ordered);
    listedKeys.set(key, (listedKeys.get(key) || 0) + 1);
    if (!sameIds) idMismatch.push({ variant: v.variantStringRepresentation, parameterIds: ids, definitionIds: defIds });
    else if (!expectedKeys.has(key)) outsideDefinitions.push(v.variantStringRepresentation);
    const canonical = family.name + '[' + pv.map((p) => p.id + '=' + p.value).join(',') + ']';
    if (v.variantStringRepresentation && v.variantStringRepresentation !== canonical) {
      stringMismatch.push({ listed: v.variantStringRepresentation, fromParameterValues: canonical });
    }
  }
  const missing = expected.filter((combo) => !listedKeys.has(keyOf(combo))).map((combo) => family.name + '[' + keyOf(combo) + ']');
  const duplicates = [...listedKeys.entries()].filter(([, n]) => n > 1).map(([k, n]) => ({ key: k, count: n }));
  return {
    parameterIds: defIds,
    valueCounts: Object.fromEntries(defs.map((d, i) => [d.id, valueLists[i].length])),
    expectedCombinations: expected.length,
    listedVariants: variants.length,
    hasParameters: defs.length > 0,
    isFullCrossProduct: missing.length === 0 && idMismatch.length === 0 && outsideDefinitions.length === 0,
    missingCombinations: missing,
    variantsWithParameterIdMismatch: idMismatch,
    variantsOutsideDefinitionValues: outsideDefinitions,
    duplicateCombinations: duplicates,
    variantStringMismatches: stringMismatch,
  };
}

// Parses `--list-models` text output: `<id> - <label> (current, default)` rows plus the tip line.
export function parseListModels(stdout) {
  const ansi = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
  const rows = [];
  let tip;
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(ansi, '').trim();
    if (!line || line === 'Available models') continue;
    if (line.startsWith('Tip:')) {
      tip = line;
      continue;
    }
    const m = /^(\S+?)(?: - (.*?))?(?: \(((?:current|default)(?:, (?:current|default))*)\))?$/.exec(line);
    if (!m) {
      rows.push({ unparsed: line });
      continue;
    }
    const markers = m[3] ? m[3].split(', ') : [];
    rows.push({ id: m[1], label: m[2] ?? '', current: markers.includes('current'), default: markers.includes('default') });
  }
  return { rows, tip };
}

const FAMILY_SKIP = new Set(['parameterDefinitions', 'variants']);

function projectModelDetails(m) {
  if (!m) return null;
  const pick = {};
  for (const k of ['modelId', 'displayModelId', 'displayName', 'displayNameShort', 'aliases', 'maxMode', 'thinkingDetails']) {
    if (m[k] !== undefined) pick[k] = m[k];
  }
  return pick;
}

function fulfilled(raw, method) {
  return (raw.calls || []).find((c) => c.method === method && c.status === 'fulfilled');
}

// Fail-closed check of a preload capture record. `run.timedOut` selects the timeout exit code.
export function checkCapture(raw, run = {}) {
  const code = run.timedOut ? EXIT.timeout : EXIT.captureFailed;
  if (!raw || typeof raw !== 'object') throw new CaptureError(code, 'capture is not a JSON object');
  if (raw.ok !== true) {
    const calls = (raw.calls || []).map((c) => c.method + ':' + c.status).join(',');
    throw new CaptureError(code, 'capture failed: ' + (raw.reason || 'unknown reason') + ' (stage=' + raw.stage + ', calls=' + (calls || 'none') + ')');
  }
  const avail = fulfilled(raw, 'availableModels');
  const models = avail && avail.response && avail.response.json && avail.response.json.models;
  if (!Array.isArray(models) || models.length === 0) throw new CaptureError(code, 'capture has no availableModels models');
  return raw;
}

// Projects a checked, redacted capture plus the CLI run into the published JSON shape.
export function project(raw, cliRun, install) {
  const avail = fulfilled(raw, 'availableModels');
  const usable = fulfilled(raw, 'getUsableModels');
  const dflt = fulfilled(raw, 'getDefaultModelForCli');
  const response = avail.response.json;
  const models = response.models || [];
  const cliNames = raw.serviceResultSummary && raw.serviceResultSummary.cliParameterizedModelNames;
  const cliNameSet = Array.isArray(cliNames) ? new Set(cliNames) : null;
  const excludedSet = new Set(CLI_EXCLUDED_FALLBACK);

  const families = models.map((m, index) => {
    const attributes = {};
    for (const [k, v] of Object.entries(m)) if (!FAMILY_SKIP.has(k)) attributes[k] = v;
    const label = m.clientDisplayName || m.name;
    const variants = (m.variants || []).map((v) => {
      const pv = v.parameterValues || [];
      return {
        variantStringRepresentation: v.variantStringRepresentation,
        parameters: Object.fromEntries(pv.map((p) => [p.id, p.value])),
        displayName: v.displayName,
        displayNameOutsidePicker: v.displayNameOutsidePicker,
        tagline: v.tagline,
        legacySlug: v.legacySlug,
        isMaxMode: v.isMaxMode,
        isDefaultNonMaxConfig: v.isDefaultNonMaxConfig,
        isDefaultMaxConfig: v.isDefaultMaxConfig,
        tooltipData: v.tooltipData,
        confirmationDialogue: v.confirmationDialogue,
        pickerSummaryDerived: pickerSummary(m, pv),
      };
    });
    return {
      index,
      id: m.name,
      pickerLabel: label,
      isAutoRow: m.name === 'default' || String(label).toLowerCase() === 'auto',
      cliExcluded: cliNameSet ? !cliNameSet.has(m.name) : excludedSet.has(m.name),
      fixedSingleVariant: (m.parameterDefinitions || []).length === 0 && (m.variants || []).length === 1,
      attributes,
      parameterDefinitions: m.parameterDefinitions || [],
      variants,
      analysis: analyzeFamily(m),
    };
  });

  const topLevel = {};
  for (const [k, v] of Object.entries(response)) if (k !== 'models') topLevel[k] = v;

  // A legacy slug can be shared by several variants (typically the context values of one
  // effort/fast setting). The CLI resolves `--model <slug>` with the first match in server order
  // among the families it keeps, so `match` is that variant and `alsoMatches` lists the others.
  const variantHits = new Map();
  for (const f of families) {
    for (const v of f.variants) {
      for (const [key, via] of [
        [v.legacySlug, 'variant.legacySlug'],
        [v.variantStringRepresentation, 'variantStringRepresentation'],
      ]) {
        if (!key) continue;
        const hits = variantHits.get(key) || [];
        hits.push({ family: f.id, variant: v.variantStringRepresentation, via, cliExcluded: f.cliExcluded });
        variantHits.set(key, hits);
      }
    }
  }
  const familyIndex = new Map();
  for (const f of families) {
    for (const s of f.attributes.legacySlugs || []) if (!familyIndex.has(s)) familyIndex.set(s, { family: f.id, via: 'family.legacySlugs' });
    if (!familyIndex.has(f.id)) familyIndex.set(f.id, { family: f.id, via: 'family.name' });
    for (const s of f.attributes.idAliases || []) if (!familyIndex.has(s)) familyIndex.set(s, { family: f.id, via: 'family.idAliases' });
  }
  const resolveId = (id) => {
    const hits = variantHits.get(id) || [];
    const first = hits.filter((h) => !h.cliExcluded)[0] || hits[0];
    if (first) {
      const { cliExcluded, ...match } = first;
      const others = hits.filter((h) => h !== first).map((h) => h.variant);
      return others.length ? { ...match, alsoMatches: others } : match;
    }
    return familyIndex.get(id) || null;
  };
  const ambiguousSlugs = [...variantHits.entries()]
    .filter(([, hits]) => hits.length > 1)
    .map(([slug, hits]) => ({ slug, variants: hits.map((h) => h.variant) }));
  const listed = parseListModels(cliRun.stdout || '');
  const listRows = listed.rows.map((r) => (r.id ? { ...r, match: resolveId(r.id) } : r));

  // Derived per-family hints (not server fields): parenthesized suffixes that only the legacy
  // --list-models labels carry, e.g. "(NO ZDR)", and data-retention wording in tooltips.
  for (const f of families) {
    const suffixes = new Set();
    for (const r of listRows) {
      if (!r.match || r.match.family !== f.id) continue;
      for (const m of String(r.label).matchAll(/\(([^()]+)\)\s*$/g)) suffixes.add(m[1]);
    }
    const tooltips = [f.attributes.tooltipData, f.attributes.tooltipDataForMaxMode, ...f.variants.map((v) => v.tooltipData)]
      .map((t) => (t && t.markdownContent) || '')
      .join(' ');
    f.derived = {
      legacyLabelSuffixes: [...suffixes],
      tooltipMentionsDataRetention: /data retention/i.test(tooltips),
      variantsWithConfirmationDialogue: f.variants.filter((v) => v.confirmationDialogue).length,
      maxModeVariants: f.variants.filter((v) => v.isMaxMode).length,
      singleValueParameters: f.parameterDefinitions
        .filter((d) => enumValuesOf(d).kind === 'enum' && enumValuesOf(d).values.length <= 1)
        .map((d) => d.id),
    };
  }

  const defaults = [];
  for (const f of families) {
    if (f.attributes.defaultOn) defaults.push({ family: f.id, flag: 'family.defaultOn' });
    for (const v of f.variants) {
      if (v.isDefaultNonMaxConfig) defaults.push({ family: f.id, variant: v.variantStringRepresentation, flag: 'variant.isDefaultNonMaxConfig' });
      if (v.isDefaultMaxConfig) defaults.push({ family: f.id, variant: v.variantStringRepresentation, flag: 'variant.isDefaultMaxConfig' });
    }
  }

  return {
    schema: 'cursor-parameterized-models/v1',
    source:
      'Account-resolved AvailableModels reply (useModelParameters) observed in memory while the installed CLI ran --list-models; no login, prompt, agent run or inference. Account identifiers redacted.',
    capturedAt: new Date().toISOString(),
    cli: {
      version: install.version,
      versionDir: install.versionDir ? displayPath(install.versionDir) : null,
      entry: 'index.js',
      node: nodeBinaryName(),
      listModelsExitCode: cliRun.code ?? null,
    },
    request: avail.request ? avail.request.json : null,
    cliView: raw.serviceResultSummary
      ? {
          parameterizedModelsFetchStatus: raw.serviceResultSummary.parameterizedModelsFetchStatus,
          parameterizedModelCount: Array.isArray(cliNames) ? cliNames.length : null,
          cliExcludedSource: cliNameSet ? 'difference between raw reply and the CLI model-service result' : 'fallback list read from the 2026.10.01 bundle',
        }
      : null,
    counts: {
      familiesInReply: families.length,
      familiesAfterCliFilter: families.filter((f) => !f.cliExcluded).length,
      familiesWithParameters: families.filter((f) => f.parameterDefinitions.length > 0).length,
      variantsInReply: families.reduce((n, f) => n + f.variants.length, 0),
    },
    cliExcludedFamilies: families.filter((f) => f.cliExcluded).map((f) => f.id),
    cliExclusionListInBundle: CLI_EXCLUDED_FALLBACK,
    crossProductSummary: {
      fullCrossProduct: families.filter((f) => f.analysis.hasParameters && f.analysis.isFullCrossProduct).map((f) => f.id),
      partial: Object.fromEntries(families.filter((f) => !f.analysis.isFullCrossProduct).map((f) => [f.id, f.analysis.missingCombinations])),
      noParameters: families.filter((f) => !f.analysis.hasParameters).map((f) => f.id),
      variantStringMismatches: families.filter((f) => f.analysis.variantStringMismatches.length).map((f) => f.id),
    },
    hiddenFamilies: families.filter((f) => f.attributes.isHidden === true).map((f) => f.id),
    defaultMarkers: {
      defaultModelForCli: dflt ? projectModelDetails(dflt.response.json.model) : null,
      featureModelConfigs: Object.fromEntries(Object.entries(topLevel).filter(([k]) => /ModelConfigs?$/.test(k))),
      flags: defaults,
    },
    responseTopLevel: topLevel,
    families,
    listModels: {
      rows: listRows,
      tip: listed.tip,
      unmatchedIds: listRows.filter((r) => r.id && !r.match).map((r) => r.id),
      rowsWithAmbiguousSlug: listRows.filter((r) => r.match && r.match.alsoMatches).length,
      distinctVariantLegacySlugs: new Set(families.flatMap((f) => f.variants.map((v) => v.legacySlug).filter(Boolean))).size,
      ambiguousLegacySlugs: { count: ambiguousSlugs.length, items: ambiguousSlugs },
    },
    usableModels: usable ? (usable.response.json.models || []).map(projectModelDetails) : null,
    notes: [
      'families[] keeps the server order. The CLI drops cliExcluded families before building its parameterized list.',
      'The interactive /model picker (model-picker-pager.tsx) shows every remaining family; it does not filter isHidden, namedModelSectionIndex or visibleInRoutedModelView. It only moves name==="default" / label "auto" to the top. Row label = clientDisplayName || name.',
      'Only booleans and enums with more than one value are editable in the picker (format-param-summary AR). Values with blockedByAdminAllowlist=true are not selectable.',
      '--model resolution (models/index.ts handleInitialModel, read from the bundle, not executed): the value must equal a variant legacySlug or variantStringRepresentation exactly (string equality, parameter order included); otherwise a usable-model alias or a bare family name (saved/default parameters) is tried, else the CLI exits with "Cannot use this model". Unlisted combinations are therefore not accepted. Interactive parameter edits snap to a listed variant or fall back to the default variant (isDefaultNonMaxConfig, then isDefaultMaxConfig, then the first). A successful --model is written to the CLI config.',
      'pickerSummaryDerived replicates the CLI row summary text for a variant (not server data).',
      'Families without parameterDefinitions have exactly one variant whose variantStringRepresentation is `name[]`.',
      'listModels.rows is what --list-models prints: GetUsableModels rows keyed by displayModelId (legacy slugs). match is the first variant (server order, CLI-kept families) whose legacySlug equals the row id, which is what --model <slug> resolves to; alsoMatches lists other variants sharing that slug (usually other context values).',
      'family.attributes is every AvailableModel field except parameterDefinitions/variants, serialized with emitDefaultValues; proto3 optional fields such as isHidden or reasonForZdrConsentBlock appear only when the server sets them.',
    ],
  };
}

// Redacts, projects and scans one capture. Throws CaptureError(unsafe) before anything is written.
export function buildOutputs(raw, run, install, integrity = null) {
  checkCapture(raw, run);
  const stats = { keys: 0, emails: 0, opaqueIds: 0 };
  const rawRedacted = redact(raw, stats);
  const projected = project(rawRedacted, { code: run.code, stdout: redact(run.stdout || '', stats) }, install);
  projected.capture = {
    hookVersion: raw.hookVersion,
    redactions: stats,
    droppedSensitiveKeyCount: (raw.droppedSensitiveKeyPaths || []).length,
    rpcCalls: (raw.calls || []).map((c) => ({
      method: c.method,
      status: c.status,
      typeName: c.response && c.response.typeName,
      latencyMs: c.settledAtMs && c.startedAtMs ? c.settledAtMs - c.startedAtMs : null,
    })),
    integrity,
  };
  const scan = assertSafe(JSON.stringify(projected, null, 2), 'the projection');
  projected.capture.safetyScan = Object.fromEntries(Object.entries(scan).map(([k, v]) => [k, v.count]));
  const rawText = JSON.stringify(rawRedacted, null, 2) + '\n';
  assertSafe(rawText, 'the raw capture');
  return { projected, text: JSON.stringify(projected, null, 2) + '\n', rawText, scan };
}

// Compact evidence projection for docs/research/fixtures: no tooltips, raw replies or paths.
export function compactFixture(projected) {
  return {
    schema: 'cursor-parameterized-models-fixture/v1',
    source: projected.source,
    capturedAt: projected.capturedAt,
    cli: { version: projected.cli.version },
    counts: projected.counts,
    cliExcludedFamilies: projected.cliExcludedFamilies,
    cliExclusionListInBundle: projected.cliExclusionListInBundle,
    defaultModelForCli: projected.defaultMarkers.defaultModelForCli,
    families: projected.families.map((f) => ({
      index: f.index,
      id: f.id,
      pickerLabel: f.pickerLabel,
      cliExcluded: f.cliExcluded,
      parameterDefinitions: f.parameterDefinitions.map((d) => {
        const { kind, values } = enumValuesOf(d);
        return { id: d.id, name: d.name, type: kind, values: values.map((v) => ({ value: v.value, displayName: v.displayName })) };
      }),
      variants: f.variants.map((v) => ({
        variantStringRepresentation: v.variantStringRepresentation,
        parameters: v.parameters,
        isDefaultNonMaxConfig: v.isDefaultNonMaxConfig === true,
        isDefaultMaxConfig: v.isDefaultMaxConfig === true,
        isMaxMode: v.isMaxMode === true,
      })),
    })),
  };
}

// JSON with every non-ASCII character escaped, so zero-width characters stay visible in review.
export function stringifyAscii(value) {
  const nonAscii = new RegExp('[' + String.fromCharCode(0x80) + '-' + String.fromCharCode(0xffff) + ']', 'g');
  const escape = String.fromCharCode(92) + 'u';
  return JSON.stringify(value, null, 2).replace(nonAscii, (c) => escape + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n';
}

// ------------------------------------------------------------------ main --

export async function main(argv) {
  const opts = parseCliArgs(argv);
  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }
  if (!fs.existsSync(PRELOAD)) throw new CaptureError(EXIT.usage, 'preload not found next to this script');
  const install = resolveInstall(opts.cli);

  const workRoot = opts.workDir || os.tmpdir();
  fs.mkdirSync(workRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(workRoot, 'cursor-pm-'));
  const cwd = path.join(work, 'cwd');
  fs.mkdirSync(cwd);
  const captureFile = path.join(work, 'capture.raw.json');

  const skipRunning = (rel) => rel === '.running' || rel.startsWith('.running' + path.sep);
  const before = snapshotTree(install.versionDir, skipRunning);
  const cliConfig = path.join(os.homedir(), '.cursor', 'cli-config.json');
  const configMtimeBefore = statMtime(cliConfig);

  const run = await runCli(install, cwd, captureFile, opts.timeoutMs);

  const installChanges = diffSnapshots(before, snapshotTree(install.versionDir, skipRunning));
  const integrity = {
    installFilesChanged: installChanges.map((c) => c.path),
    inUseMarkerLeftBehind: run.pid ? fs.existsSync(path.join(install.versionDir, '.running', String(run.pid))) : false,
    cliConfigMtimeChanged: configMtimeBefore !== statMtime(cliConfig),
    filesCreatedInCwd: fs.readdirSync(cwd),
  };

  if (!fs.existsSync(captureFile)) {
    throw new CaptureError(
      run.timedOut ? EXIT.timeout : EXIT.captureFailed,
      'no capture written (timedOut=' + run.timedOut + ', exit=' + run.code + '); the preload did not reach the model-list command, so check its module ids for this CLI version. work dir: ' + work,
    );
  }
  const raw = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
  const { projected, text, rawText, scan } = buildOutputs(raw, run, install, integrity);

  fs.mkdirSync(path.dirname(opts.output), { recursive: true });
  fs.writeFileSync(opts.output, text);
  if (opts.rawOutput) fs.writeFileSync(opts.rawOutput, rawText);
  if (opts.fixtureOutput) {
    const fixtureText = stringifyAscii(compactFixture(projected));
    assertSafe(fixtureText, 'the fixture');
    fs.mkdirSync(path.dirname(opts.fixtureOutput), { recursive: true });
    fs.writeFileSync(opts.fixtureOutput, fixtureText);
  }
  fs.rmSync(work, { recursive: true, force: true });

  process.stdout.write(
    JSON.stringify(
      {
        output: opts.output,
        cliVersion: install.version,
        counts: projected.counts,
        cliExcludedFamilies: projected.cliExcludedFamilies,
        cliFetchStatus: projected.cliView && projected.cliView.parameterizedModelsFetchStatus,
        listModelsExitCode: run.code,
        integrity,
        safetyScan: Object.fromEntries(Object.entries(scan).map(([k, v]) => [k, v.count])),
      },
      null,
      2,
    ) + '\n',
  );
  if (installChanges.length) {
    process.stderr.write('warning: installed files changed during the run: ' + installChanges.map((c) => c.path).join(', ') + '\n');
    process.exitCode = EXIT.unsafe;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write('capture-cursor-parameterized-models: ' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = error instanceof CaptureError ? error.exitCode : EXIT.captureFailed;
  }
}
