// Per-provider catalog sources for the probe. Each source locates the installed CLI without
// running it, reads its version from installation metadata where one exists, runs only the
// read-only enumeration recorded in that provider's reference, and projects the reply to public
// model fields. No source logs in, starts a session, sends a prompt or keeps raw output.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readClaudeChangelog } from '../claude-changelog.mjs';
import { extractPiModels } from '../extract-pi-models.mjs';
import { readJunieModelIds, defaultJunieDataDir } from '../junie-model-ids.mjs';
import { listCopilotModels } from '../list-copilot-models.mjs';
import { redactVisibleText, stripTerminalPresentation } from '../normalize-picker-paste.mjs';
import { parseVerboseModels } from '../project-opencode-models.mjs';
import { cleanEnv, findExecutable, launchSpec, npmPackageDir, readPackageVersion, runCommand } from './process.mjs';

const VERSION_PATTERN = /\b\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?\b/;
const AUTH_PATTERN = /not (?:logged|signed) in|not authenticated|unauthori[sz]ed|please (?:log|sign) ?in|\blogin required|authentication (?:required|failed)|\b401\b/i;
// Release-note entries that can change the /model picker: the picker itself, a named model with
// its version, the default model, effort levels or a 1M alias. A bare "model" is too common:
// fallback, retry and pricing fixes mention it on most releases.
const CLAUDE_PICKER_SIGNAL = /\/model\b|\bmodel (?:picker|selector|menu|list)\b|\bdefault model\b|\b(?:opus|sonnet|haiku|fable)\s+\d|\beffort\b|\bultracode\b|\[1m\]/i;

/** A failure that already knows its probe status and reason. */
export class SourceFailure extends Error {
  constructor(status, reason, message) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

function sanitize(text, limit = 240) {
  const line = stripTerminalPresentation(String(text ?? '')).split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? '';
  const { text: redacted } = redactVisibleText(line);
  return redacted.length > limit ? `${redacted.slice(0, limit)}…` : redacted;
}

// A Windows child that is still exiting can hold its working directory for a moment. A leftover
// empty directory under the OS temp folder must not fail the probe.
function removeQuietly(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // Left for the OS temp cleanup.
  }
}

export function parseVersion(text) {
  return VERSION_PATTERN.exec(String(text ?? ''))?.[0] ?? null;
}

function compareSemver(left, right) {
  const a = left.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const b = right.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (Number.isNaN(a[index]) ? -1 : a[index] ?? -1) - (Number.isNaN(b[index]) ? -1 : b[index] ?? -1);
    if (delta !== 0) return delta;
  }
  return 0;
}

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceFailure('error', 'parse', `${what} did not print JSON.`);
  }
}

function requireArray(value, what) {
  if (!Array.isArray(value)) throw new SourceFailure('error', 'parse', `${what} has no model array.`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// Pure parsers. Each returns projected rows: { id, label?, efforts?, effortDefault?, hidden? }
// plus `evidence`, selected public fields an agent may cite but the probe never compares. No
// account, cost, endpoint or session field is kept.

/** Drops null, undefined and empty values so evidence holds only what the source stated. */
export function compactEvidence(fields) {
  const kept = Object.entries(fields).filter(([, value]) => value !== null && value !== undefined
    && !(Array.isArray(value) && value.length === 0)
    && !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0));
  return kept.length ? Object.fromEntries(kept) : undefined;
}

function withEvidence(row, fields) {
  const evidence = compactEvidence(fields);
  return evidence ? { ...row, evidence } : row;
}

const str = (value) => (typeof value === 'string' && value.trim() ? value : null);
const num = (value) => (typeof value === 'number' ? value : null);

export function parseCodexDebugModels(output) {
  const rows = requireArray(parseJson(output, '`codex debug models`').models, '`codex debug models`');
  return rows.map((row) => {
    if (typeof row?.slug !== 'string') throw new SourceFailure('error', 'parse', 'A `codex debug models` row has no slug.');
    const levels = Array.isArray(row.supported_reasoning_levels) ? row.supported_reasoning_levels : null;
    return withEvidence({
      id: row.slug,
      label: row.display_name ?? null,
      efforts: levels ? levels.map((level) => level?.effort).filter((effort) => typeof effort === 'string') : null,
      effortDefault: row.default_reasoning_level ?? null,
      hidden: row.visibility !== 'list',
    }, {
      description: str(row.description),
      visibility: str(row.visibility),
      contextWindow: num(row.context_window),
      maxContextWindow: num(row.max_context_window),
      effortDescriptions: levels
        ? Object.fromEntries(levels.filter((level) => str(level?.effort) && str(level?.description)).map((level) => [level.effort, level.description]))
        : null,
    });
  });
}

export function parseAgyModels(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || /^fetching available models/i.test(line.trim())) continue;
    const fields = line.split('\t');
    if (fields.length !== 2 || !fields[0].trim()) {
      throw new SourceFailure('error', 'parse', '`agy models` printed a line that is not `<id>\\t<label>`.');
    }
    rows.push({ id: fields[0].trim(), label: fields[1].trim() });
  }
  if (rows.length === 0) throw new SourceFailure('error', 'parse', '`agy models` printed no models.');
  return rows;
}

export function parseGrokModels(output) {
  const lines = String(output).split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*available models:\s*$/i.test(line));
  if (start < 0) throw new SourceFailure('error', 'parse', '`grok models` printed no "Available models:" section.');
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    const match = /^\s*[*-]\s+(\S+)((?:\s+\((?:default|current)\))*)\s*$/i.exec(line);
    if (!match) throw new SourceFailure('error', 'parse', '`grok models` printed an unexpected model line.');
    // The (default) marker did not match config.toml on 2026-09-25; it is evidence, not a default.
    rows.push(withEvidence({ id: match[1] }, { listMarkedDefault: /\(default\)/i.test(match[2]) || null }));
  }
  if (rows.length === 0) throw new SourceFailure('error', 'parse', '`grok models` listed no models.');
  const authenticated = /you are not authenticated/i.test(output) ? false : /you are logged in/i.test(output) ? true : null;
  return { rows, authenticated };
}

export function parseKiroListModels(output) {
  const document = parseJson(output, '`kiro-cli chat --list-models`');
  const rows = requireArray(document.models, '`kiro-cli chat --list-models`');
  return rows.map((row) => {
    if (typeof row?.model_id !== 'string') throw new SourceFailure('error', 'parse', 'A Kiro model row has no model_id.');
    return withEvidence({ id: row.model_id, label: row.model_name ?? row.model_id }, {
      description: str(row.description),
      contextWindowTokens: num(row.context_window_tokens),
      rateMultiplier: num(row.rate_multiplier),
      rateUnit: str(row.rate_unit),
      // `default_model` is the list's marker, not a catalog default (kiro.md).
      listDefault: row.model_id === document.default_model || null,
    });
  });
}

export function parseAuggieModelList(output) {
  const document = parseJson(output, '`auggie model list --json`');
  const rows = requireArray(document.models, '`auggie model list --json`').map((row) => {
    if (typeof row?.id !== 'string') throw new SourceFailure('error', 'parse', 'An Auggie model row has no id.');
    return withEvidence({ id: row.id, label: row.displayName ?? null }, {
      shortName: str(row.shortName),
      description: str(row.description),
      costTier: row.costTier ?? null,
      badges: Array.isArray(row.badges) ? row.badges : null,
      // Recorded in notes per auggie.md; no effort binding or picker effort exists.
      effortLevels: Array.isArray(row.effortLevels) ? row.effortLevels : null,
      // The JSON flag matched the picker's (default) suffix in 0.36.0, but only the picker is evidence.
      jsonIsDefault: row.isDefault === true || null,
    });
  });
  // defaultModelId may name no picker row (auggie.md); it is kept for notes only.
  return { rows, registryAvailable: document.registryAvailable ?? null, defaultModelId: str(document.defaultModelId) };
}

export function parseDevinModelsList(output) {
  const families = requireArray(parseJson(output, '`devin models list`').families, '`devin models list`');
  const rows = [];
  for (const family of families) {
    for (const variant of family?.variants ?? []) {
      if (typeof variant?.model_uid !== 'string') throw new SourceFailure('error', 'parse', 'A Devin variant has no model_uid.');
      rows.push(withEvidence({ id: variant.model_uid, label: variant.label ?? null }, {
        family: str(family.family_uid),
        familyLabel: str(family.family_label),
        description: str(variant.description),
        isNew: variant.is_new === true || null,
        isBeta: variant.is_beta === true || null,
      }));
    }
  }
  if (rows.length === 0) throw new SourceFailure('error', 'parse', '`devin models list` listed no variants.');
  return rows;
}

/** OpenCode and Kilo share the `models <provider> --verbose` shape: an ID line, then JSON. */
export function parseVerboseChannel(output, channel) {
  let parsed;
  try {
    parsed = parseVerboseModels(String(output), { keepMetadata: true });
  } catch (error) {
    throw new SourceFailure('error', 'parse', `Verbose model output did not parse: ${error.message}`);
  }
  const rows = parsed
    .filter((row) => !channel || row.id.startsWith(`${channel}/`))
    .map((row) => {
      const metadata = row.metadata ?? {};
      return withEvidence({ id: row.id, label: row.name }, {
        family: str(metadata.family),
        status: str(metadata.status),
        releaseDate: str(metadata.release_date),
        contextLimit: num(metadata.limit?.context),
        outputLimit: num(metadata.limit?.output),
        reasoning: typeof metadata.capabilities?.reasoning === 'boolean' ? metadata.capabilities.reasoning : null,
        variants: metadata.variants && typeof metadata.variants === 'object' ? Object.keys(metadata.variants) : null,
      });
    });
  if (rows.length === 0) throw new SourceFailure('error', 'parse', `No models were listed${channel ? ` for ${channel}` : ''}.`);
  return rows;
}

function objectLiteralEnd(text, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function literalScalar(entry, key) {
  const match = new RegExp(`[{,]${key}:(?:"([^"]*)"|(-?\\d+(?:\\.\\d+)?))`).exec(entry);
  if (!match) return null;
  return match[1] !== undefined ? match[1] : Number(match[2]);
}

/** Reads one provider block of the bundled `@cline/llms` catalog without executing it. */
export function parseClineProviderBlock(bundle, channel = 'cline-pass') {
  const marker = `"${channel}":{`;
  const at = bundle.indexOf(marker);
  if (at < 0) throw new SourceFailure('error', 'parse', `The bundled Cline catalog has no "${channel}" block.`);
  const start = at + marker.length - 1;
  const end = objectLiteralEnd(bundle, start);
  if (end < 0) throw new SourceFailure('error', 'parse', `The "${channel}" block does not close.`);
  const block = bundle.slice(start, end);
  const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = [...block.matchAll(new RegExp(`"(${escaped}/[^"]+)":\\{name:"([^"]*)"`, 'g'))].map((match) => {
    const entryStart = match.index + match[0].indexOf('{');
    const entryEnd = objectLiteralEnd(block, entryStart);
    const entry = entryEnd < 0 ? '' : block.slice(entryStart, entryEnd);
    const reasoning = /reasoningOptions:\[([^\]]*)\]/.exec(entry)?.[1] ?? '';
    return withEvidence({ id: match[1], label: match[2] }, {
      family: str(literalScalar(entry, 'family')),
      releaseDate: str(literalScalar(entry, 'releaseDate')),
      contextWindow: num(literalScalar(entry, 'contextWindow')),
      maxTokens: num(literalScalar(entry, 'maxTokens')),
      reasoningOptions: [...reasoning.matchAll(/type:"([^"]+)"/g)].map((option) => option[1]),
    });
  });
  if (rows.length === 0) throw new SourceFailure('error', 'parse', `The "${channel}" block lists no models.`);
  return rows;
}

/** `cursor-agent --list-models`: `<slug> - <label> (default)`, as the runtime's discovery parses. */
export function parseCursorListModels(output) {
  const rows = [];
  for (const raw of stripTerminalPresentation(String(output)).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^loading models|^available models$|^tip:/i.test(line)) continue;
    const match = /^([A-Za-z0-9._-]+)\s+-\s+(.+)$/.exec(line);
    if (!match) continue;
    const markers = /((?:\s+\((?:default|current)\))+)\s*$/i.exec(match[2])?.[1] ?? '';
    rows.push(withEvidence(
      { id: match[1], label: match[2].slice(0, match[2].length - markers.length).trim() },
      { listMarkedDefault: /\(default\)/i.test(markers) || null },
    ));
  }
  if (rows.length === 0) throw new SourceFailure('error', 'parse', '`cursor-agent --list-models` listed no models.');
  return rows;
}

export function projectMuseModelList(result) {
  const rows = requireArray(result?.models, 'MSP model/list').map((row) => {
    if (typeof row?.modelId !== 'string') throw new SourceFailure('error', 'parse', 'An MSP model row has no modelId.');
    return withEvidence({
      id: row.modelId,
      label: row.displayLabel ?? null,
      efforts: Array.isArray(row.variants) ? row.variants : null,
    }, {
      description: str(row.description),
      releaseDate: str(row.releaseDate),
      contextLimit: num(row.contextLimit),
      outputLimit: num(row.outputLimit),
      // MSP isDefault has pointed at a -contributor row; muse.md forbids copying it as a default.
      mspIsDefault: row.isDefault === true || null,
    });
  });
  return { rows, catalogSource: typeof result.source === 'string' ? result.source : null };
}

export function claudeChangelogSignals(changelog) {
  return (changelog?.sections ?? [])
    .map((section) => ({
      version: section.version,
      entries: section.entries.filter((entry) => CLAUDE_PICKER_SIGNAL.test(entry)),
    }))
    .filter((section) => section.entries.length > 0);
}

// ---------------------------------------------------------------------------------------------
// Running sources.

async function runOrFail(ctx, executable, args, { what, env, timeoutMs } = {}) {
  const result = await runCommand(launchSpec(executable, args), {
    env: env ?? ctx.env(),
    cwd: ctx.workDir,
    timeoutMs: timeoutMs ?? ctx.timeoutMs,
  });
  if (result.timedOut) throw new SourceFailure('error', 'timeout', `${what} did not finish within ${ctx.timeoutMs} ms.`);
  if (result.error) throw new SourceFailure('error', 'launch', `${what} could not start: ${sanitize(result.error)}`);
  if (result.exitCode !== 0) {
    const detail = sanitize(result.stderr || result.stdout);
    if (AUTH_PATTERN.test(`${result.stderr}\n${result.stdout}`)) {
      throw new SourceFailure('unavailable', 'not-authenticated', `${what} needs a signed-in CLI: ${detail}`);
    }
    throw new SourceFailure('error', 'exit', `${what} exited with ${result.exitCode}${detail ? `: ${detail}` : '.'}`);
  }
  return result;
}

// The channel a multi-channel CLI is probed on comes from the factory scope's basis, never a
// default here, so a changed basis cannot be masked.
function scopeChannel(ctx) {
  const channel = ctx.scope?.basis?.channel?.id;
  if (!channel) throw new SourceFailure('error', 'internal', 'The factory scope has no basis.channel to probe.');
  return channel;
}

function locate(ctx, name, extraDirs = []) {
  const executable = ctx.find(name, extraDirs);
  if (!executable) throw new SourceFailure('unavailable', 'not-installed', `\`${name}\` was not found on PATH.`);
  return executable;
}

async function versionFromFlag(ctx, executable, args = ['--version'], env) {
  const result = await runCommand(launchSpec(executable, args), { env: env ?? ctx.env(), cwd: ctx.workDir, timeoutMs: 20000 });
  return result.exitCode === 0 ? parseVersion(result.stdout || result.stderr) : null;
}

function npmVersion(executable, packageName) {
  const packageDir = npmPackageDir(executable, packageName);
  return { packageDir, version: readPackageVersion(packageDir) };
}

function newestClaudeVersion(home) {
  const dir = join(home, '.local', 'share', 'claude', 'versions');
  let names;
  try {
    names = readdirSync(dir).filter((name) => /^\d+\.\d+\.\d+$/.test(name));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  const version = names.sort(compareSemver).at(-1);
  let binary = join(dir, version);
  if (statSync(binary).isDirectory()) {
    binary = ['claude.exe', 'claude'].map((name) => join(binary, name)).find((candidate) => existsSync(candidate)) ?? null;
  }
  return { version, binary };
}

function museInstall(ctx) {
  const dirs = [];
  if (ctx.env().LOCALAPPDATA) dirs.push(join(ctx.env().LOCALAPPDATA, 'Programs', 'muse'));
  const launcher = ctx.find('muse');
  if (launcher) {
    try {
      dirs.push(dirname(realpathSync(launcher)));
    } catch {
      // A dangling launcher leaves only the platform directory.
    }
  }
  for (const dir of dirs) {
    const versionFile = join(dir, '.muse-version');
    if (!existsSync(versionFile)) continue;
    const version = readFileSync(versionFile, 'utf8').trim();
    const binary = [`muse-bin-${version}.exe`, `muse-bin-${version}`].map((name) => join(dir, name)).find((candidate) => existsSync(candidate));
    if (binary) return { version, binary };
  }
  return null;
}

/** MSP over newline-delimited JSON: initialize, the required initialized notice, model/list. */
export function museModelList({ binary, env, timeoutMs }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, ['serve', '--no-session-log'], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let buffer = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolvePromise(value);
    };
    const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    const timer = setTimeout(() => finish(new SourceFailure('error', 'timeout', `MSP model/list did not answer within ${timeoutMs} ms.`)), timeoutMs);
    // A host that exits early surfaces through 'exit'; a write into its closed pipe must not throw.
    child.stdin.on('error', () => {});
    child.on('error', (error) => finish(new SourceFailure('error', 'launch', `muse serve could not start: ${sanitize(error.message)}`)));
    child.on('exit', (code) => finish(new SourceFailure('error', 'exit', `muse serve exited (${code}) before model/list returned.`)));
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish(new SourceFailure('error', 'parse', 'muse serve printed a non-JSON frame.'));
          return;
        }
        if (message.id === 1) {
          if (message.error) {
            finish(new SourceFailure('error', 'exit', `MSP initialize failed: ${sanitize(message.error.message)}`));
            return;
          }
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'model/list', params: {} });
        } else if (message.id === 2) {
          if (message.error) {
            const reason = AUTH_PATTERN.test(message.error.message ?? '') ? 'not-authenticated' : 'exit';
            finish(new SourceFailure(reason === 'exit' ? 'error' : 'unavailable', reason, `MSP model/list failed: ${sanitize(message.error.message)}`));
          } else {
            finish(null, message.result);
          }
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'cats_catalog_probe', version: '1' } } });
  });
}

const SCOPE = (provider, backend = 'cli', transport = null) => ({ provider, backend, transport });

/**
 * coverage.membership: complete (the source lists what the picker offers), partial (known to omit
 * picker rows), superset (static data that can list more than the picker), family (only model
 * families, not executable variants) or none (no enumeration). label/efforts/effortDefault say
 * which fields the source may contradict; efforts names the catalog control key to compare.
 */
export const SOURCES = [
  {
    ...SCOPE('claude'),
    sourceClass: 'static-artifact',
    command: 'embedded release notes of the installed Claude Code build',
    coverage: { membership: 'none' },
    async probe(ctx) {
      const installed = newestClaudeVersion(ctx.home);
      let version = installed?.version ?? null;
      let binary = installed?.binary ?? null;
      if (!installed) {
        const executable = locate(ctx, 'claude');
        const npm = npmVersion(executable, '@anthropic-ai/claude-code');
        version = npm.version;
        binary = npm.packageDir ? join(npm.packageDir, 'cli.js') : executable;
      }
      const result = { cliVersion: version, versionSource: installed ? 'claude versions directory' : 'npm package', models: [] };
      const since = ctx.scope?.cli_version;
      if (!binary || !since || !version || compareSemver(version, since) <= 0) return result;
      try {
        const changelog = readClaudeChangelog({ binaryPath: binary, since });
        return { ...result, signals: [{ kind: 'changelog', since, newestEmbeddedVersion: changelog.newestEmbeddedVersion, sections: claudeChangelogSignals(changelog) }] };
      } catch (error) {
        return { ...result, signals: [{ kind: 'changelog-unreadable', message: sanitize(error.message) }] };
      }
    },
  },
  {
    ...SCOPE('codex'),
    sourceClass: 'machine-readable',
    command: 'codex debug models',
    coverage: { membership: 'complete', label: true, efforts: 'codex.reasoning_effort', effortDefault: true },
    async probe(ctx) {
      const executable = locate(ctx, 'codex');
      const { version } = npmVersion(executable, '@openai/codex');
      const result = await runOrFail(ctx, executable, ['debug', 'models'], { what: '`codex debug models`' });
      return {
        cliVersion: version ?? await versionFromFlag(ctx, executable),
        versionSource: version ? 'npm package' : '--version',
        models: parseCodexDebugModels(result.stdout),
      };
    },
  },
  {
    ...SCOPE('antigravity'),
    sourceClass: 'machine-readable',
    command: 'agy models',
    coverage: { membership: 'complete' },
    async probe(ctx) {
      const executable = locate(ctx, 'agy', ctx.env().LOCALAPPDATA ? [join(ctx.env().LOCALAPPDATA, 'agy', 'bin')] : []);
      const result = await runOrFail(ctx, executable, ['models'], { what: '`agy models`' });
      return { cliVersion: await versionFromFlag(ctx, executable), versionSource: '--version', models: parseAgyModels(result.stdout) };
    },
  },
  {
    ...SCOPE('grok'),
    sourceClass: 'machine-readable',
    command: 'grok models',
    coverage: { membership: 'complete' },
    async probe(ctx) {
      const executable = locate(ctx, 'grok', [join(ctx.home, '.grok', 'bin')]);
      const result = await runOrFail(ctx, executable, ['models'], { what: '`grok models`' });
      const { rows, authenticated } = parseGrokModels(result.stdout);
      return {
        cliVersion: await versionFromFlag(ctx, executable),
        versionSource: '--version',
        authenticated,
        models: rows,
        ...(authenticated === false
          ? { status: 'degraded', reason: 'not-authenticated', message: 'grok reports "You are not authenticated"; the list may not be this account\'s.' }
          : {}),
        ...(authenticated === null
          ? { notes: ['grok printed neither a signed-in nor a not-authenticated line, so the account scope is unknown.'] }
          : {}),
      };
    },
  },
  {
    ...SCOPE('muse'),
    sourceClass: 'machine-readable',
    command: 'muse-bin serve --no-session-log, MSP model/list',
    coverage: { membership: 'complete', efforts: 'muse.reasoning_effort' },
    async probe(ctx) {
      const install = museInstall(ctx);
      if (!install) throw new SourceFailure('unavailable', 'not-installed', 'No Muse install with a .muse-version file was found.');
      const reply = await museModelList({ binary: install.binary, env: ctx.env(), timeoutMs: ctx.timeoutMs });
      const { rows, catalogSource } = projectMuseModelList(reply);
      return {
        cliVersion: install.version,
        versionSource: '.muse-version',
        models: rows,
        catalogSource,
        ...(catalogSource !== 'providerCatalog'
          ? { status: 'degraded', reason: 'non-account-source', message: `MSP answered from "${catalogSource}", not the account's providerCatalog.` }
          : {}),
      };
    },
  },
  {
    ...SCOPE('cursor'),
    sourceClass: 'machine-readable',
    command: 'cursor-agent --list-models',
    coverage: { membership: 'family' },
    async probe(ctx) {
      const extra = ctx.env().LOCALAPPDATA ? [join(ctx.env().LOCALAPPDATA, 'cursor-agent')] : [];
      const executable = locate(ctx, 'cursor-agent', extra);
      const result = await runOrFail(ctx, executable, ['--list-models'], { what: '`cursor-agent --list-models`' });
      return { cliVersion: await versionFromFlag(ctx, executable), versionSource: '--version', models: parseCursorListModels(result.stdout) };
    },
  },
  {
    ...SCOPE('copilot'),
    sourceClass: 'machine-readable',
    command: 'copilot --headless --stdio, models.list',
    coverage: { membership: 'partial', label: true, efforts: 'copilot.reasoning_effort' },
    async probe(ctx) {
      const executable = locate(ctx, 'copilot');
      const { packageDir, version } = npmVersion(executable, '@github/copilot');
      const loader = packageDir ? join(packageDir, 'npm-loader.js') : null;
      if (!loader || !existsSync(loader)) {
        throw new SourceFailure('unavailable', 'not-installed', 'The npm-installed @github/copilot loader was not found.');
      }
      let reply;
      try {
        reply = await listCopilotModels({ loader, timeoutMs: ctx.timeoutMs, cwd: ctx.workDir, env: ctx.env() });
      } catch (error) {
        const reason = AUTH_PATTERN.test(error.message) ? 'not-authenticated' : /within \d+ ms/.test(error.message) ? 'timeout' : 'exit';
        throw new SourceFailure(reason === 'not-authenticated' ? 'unavailable' : 'error', reason, sanitize(error.message));
      }
      return {
        cliVersion: version,
        versionSource: 'npm package',
        models: reply.models.map((row) => withEvidence(
          { id: row.id, label: row.name ?? null, efforts: row.supportedReasoningEfforts ?? null },
          { contextMax: num(row.contextMax), longContextMax: num(row.longContextMax), discountPercent: num(row.discountPercent) },
        )),
      };
    },
  },
  {
    ...SCOPE('opencode'),
    sourceClass: 'machine-readable',
    command: 'opencode models <channel> --verbose --pure',
    coverage: { membership: 'complete', label: true },
    async probe(ctx) {
      const channel = scopeChannel(ctx);
      const executable = locate(ctx, 'opencode');
      const { version } = npmVersion(executable, 'opencode-ai');
      const env = ctx.env({ set: { OPENCODE_DISABLE_AUTOUPDATE: 'true' } });
      const result = await runOrFail(ctx, executable, ['models', channel, '--verbose', '--pure'], { what: '`opencode models`', env });
      return { cliVersion: version, versionSource: 'npm package', models: parseVerboseChannel(result.stdout, channel) };
    },
  },
  {
    ...SCOPE('kilo'),
    sourceClass: 'machine-readable',
    command: 'kilo models <channel> --verbose --pure (gateway list, not the picker)',
    // The gateway list is broader than the picker and lacks its routing rows (kilo.md).
    coverage: { membership: 'partial' },
    async probe(ctx) {
      const channel = scopeChannel(ctx);
      const executable = locate(ctx, 'kilo');
      const { version } = npmVersion(executable, '@kilocode/cli');
      const result = await runOrFail(ctx, executable, ['models', channel, '--verbose', '--pure'], { what: '`kilo models`' });
      return { cliVersion: version, versionSource: 'npm package', models: parseVerboseChannel(result.stdout, channel) };
    },
  },
  {
    ...SCOPE('goose'),
    sourceClass: 'version-only',
    command: 'goose --version (GOOSE_PATH_ROOT in a temporary directory)',
    coverage: { membership: 'none' },
    async probe(ctx) {
      const executable = locate(ctx, 'goose', [join(ctx.home, '.local', 'bin')]);
      const root = mkdtempSync(join(tmpdir(), 'cats-catalog-probe-goose-'));
      try {
        const version = await versionFromFlag(ctx, executable, ['--version'], ctx.env({ set: { GOOSE_PATH_ROOT: root } }));
        return { cliVersion: version, versionSource: '--version', models: [] };
      } finally {
        removeQuietly(root);
      }
    },
  },
  {
    ...SCOPE('pi'),
    sourceClass: 'static-artifact',
    command: 'installed pi-ai models.generated.js (extract-pi-models.mjs)',
    coverage: { membership: 'complete', efforts: 'pi.thinking', effortDefault: true },
    async probe(ctx) {
      const executable = locate(ctx, 'pi');
      const packageDir = npmPackageDir(executable, '@earendil-works/pi-coding-agent');
      if (!packageDir) throw new SourceFailure('unavailable', 'not-installed', 'The npm-installed Pi package was not found.');
      const provider = scopeChannel(ctx);
      let extracted;
      try {
        extracted = await extractPiModels({ packageDir, provider });
      } catch (error) {
        throw new SourceFailure('error', 'parse', sanitize(error.message));
      }
      return {
        cliVersion: extracted.piVersion,
        versionSource: 'npm package',
        models: extracted.models.map((row) => withEvidence({
          id: row.id,
          efforts: row.thinkingLevels ?? null,
          effortDefault: extracted.defaultThinkingLevel ?? null,
        }, {
          name: str(row.name),
          input: Array.isArray(row.input) ? row.input : null,
          reasoning: typeof row.reasoning === 'boolean' ? row.reasoning : null,
          thinkingLevelMap: row.thinkingLevelMap ?? null,
          contextWindow: num(row.contextWindow),
          maxTokens: num(row.maxTokens),
        })),
        sourceEvidence: { piAiVersion: extracted.piAiVersion, defaultThinkingLevel: extracted.defaultThinkingLevel ?? null },
      };
    },
  },
  {
    ...SCOPE('auggie'),
    sourceClass: 'machine-readable',
    command: 'auggie model list --json',
    coverage: { membership: 'complete', label: true },
    async probe(ctx) {
      const executable = locate(ctx, 'auggie');
      const { version } = npmVersion(executable, '@augmentcode/auggie');
      const env = ctx.env({ dropPrefixes: ['AUGMENT_', 'AUGGIE_'] });
      const result = await runOrFail(ctx, executable, ['model', 'list', '--json'], { what: '`auggie model list --json`', env });
      const { rows, registryAvailable, defaultModelId } = parseAuggieModelList(result.stdout);
      return {
        cliVersion: version,
        versionSource: 'npm package',
        models: rows,
        sourceEvidence: compactEvidence({ defaultModelId }),
        ...(registryAvailable === false
          ? { status: 'degraded', reason: 'non-account-source', message: 'Auggie reported registryAvailable: false; the list may be a local fallback.' }
          : {}),
      };
    },
  },
  {
    ...SCOPE('junie'),
    sourceClass: 'static-artifact',
    command: 'installed Junie JAR model enum (junie-model-ids.mjs)',
    coverage: { membership: 'superset', label: true },
    async probe(ctx) {
      const dataDir = defaultJunieDataDir(ctx.env());
      const currentFile = join(dataDir, 'current');
      if (!existsSync(currentFile)) throw new SourceFailure('unavailable', 'not-installed', `No Junie install at ${dataDir}.`);
      const build = readFileSync(currentFile, 'utf8').split(/\r?\n/)[0].trim();
      let ids;
      try {
        ids = readJunieModelIds({ dataDir });
      } catch (error) {
        throw new SourceFailure('error', 'parse', sanitize(error.message));
      }
      return {
        cliVersion: build,
        versionSource: 'Junie build number (the catalog records the release version)',
        versionKind: 'build',
        models: ids.models.map((row) => withEvidence({ id: row.settingId, label: row.displayName }, { enumName: str(row.enumName) })),
        sourceEvidence: compactEvidence({ aliases: ids.aliases }),
      };
    },
  },
  {
    ...SCOPE('kiro'),
    sourceClass: 'machine-readable',
    command: 'kiro-cli chat --list-models --format json-pretty',
    coverage: { membership: 'complete' },
    async probe(ctx) {
      const extra = ctx.env().LOCALAPPDATA ? [join(ctx.env().LOCALAPPDATA, 'Kiro-Cli')] : [];
      const executable = locate(ctx, 'kiro-cli', extra);
      const env = ctx.env({ dropPrefixes: ['KIRO_', 'JSC_'], drop: ['AWS_EXECUTION_ENV'] });
      const result = await runOrFail(ctx, executable, ['chat', '--list-models', '--format', 'json-pretty'], { what: '`kiro-cli chat --list-models`', env });
      return { cliVersion: await versionFromFlag(ctx, executable, ['--version'], env), versionSource: '--version', models: parseKiroListModels(result.stdout) };
    },
  },
  {
    ...SCOPE('cline'),
    sourceClass: 'static-artifact',
    command: 'installed @cline/llms dist/models.js provider block (read, never executed)',
    coverage: { membership: 'superset' },
    async probe(ctx) {
      const executable = locate(ctx, 'cline');
      const packageDir = npmPackageDir(executable, 'cline');
      if (!packageDir) throw new SourceFailure('unavailable', 'not-installed', 'The npm-installed cline package was not found.');
      const candidates = [
        join(packageDir, 'node_modules', '@cline', 'llms', 'dist', 'models.js'),
        join(dirname(packageDir), '@cline', 'llms', 'dist', 'models.js'),
      ];
      const modelsFile = candidates.find((candidate) => existsSync(candidate));
      if (!modelsFile) throw new SourceFailure('error', 'parse', 'The bundled @cline/llms dist/models.js was not found.');
      const channel = scopeChannel(ctx);
      return {
        cliVersion: readPackageVersion(packageDir),
        versionSource: 'npm package',
        models: parseClineProviderBlock(readFileSync(modelsFile, 'utf8'), channel),
      };
    },
  },
  {
    ...SCOPE('devin', 'agent', 'acp_stdio'),
    sourceClass: 'machine-readable',
    command: 'devin models list --format json',
    coverage: { membership: 'complete' },
    async probe(ctx) {
      const extra = ctx.env().LOCALAPPDATA ? [join(ctx.env().LOCALAPPDATA, 'devin', 'cli', 'bin')] : [];
      const executable = locate(ctx, 'devin', extra);
      const result = await runOrFail(ctx, executable, ['models', 'list', '--format', 'json'], { what: '`devin models list`' });
      return { cliVersion: await versionFromFlag(ctx, executable), versionSource: '--version', models: parseDevinModelsList(result.stdout) };
    },
  },
];

/** Runs one source and always returns a snapshot entry, never throws. */
export async function runSource(source, { scope, env = process.env, timeoutMs = 60000, home = homedir(), find } = {}) {
  const workDir = mkdtempSync(join(tmpdir(), 'cats-catalog-probe-'));
  const ctx = {
    scope,
    home,
    timeoutMs,
    workDir,
    env: (options = {}) => cleanEnv(env, options),
    find: find ?? ((name, extraDirs) => findExecutable(name, { env, extraDirs })),
  };
  const base = {
    provider: source.provider,
    backend: source.backend,
    transport: source.transport,
    sourceClass: source.sourceClass,
    command: source.command,
    coverage: source.coverage,
  };
  const startedAt = Date.now();
  try {
    const { status, reason, message, ...rest } = await source.probe(ctx);
    return { ...base, status: status ?? 'ok', ...(reason ? { reason } : {}), ...(message ? { message } : {}), ...rest, durationMs: Date.now() - startedAt };
  } catch (error) {
    const failure = error instanceof SourceFailure ? error : new SourceFailure('error', 'internal', sanitize(error?.message ?? error));
    return { ...base, status: failure.status, reason: failure.reason, message: failure.message, models: [], durationMs: Date.now() - startedAt };
  } finally {
    removeQuietly(workDir);
  }
}
