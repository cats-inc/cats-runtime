#!/usr/bin/env node

// Answers one question per catalog CLI: can it be used right now, or does it need a sign-in?
// Read-only: it never logs in, sends a prompt, opens a session, opens a credential file or reads a
// key's value (ADR-038). Where a CLI has an account-scoped read (a model list), the check reaches
// its server; otherwise it runs the CLI's own status command. Junie, Pi, Kimi, Goose and Cline are
// never launched: their checks see only whether a credential file exists or a key variable is set.

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cleanEnv, findExecutable, launchSpec, npmPackageDir, runCommand } from './catalog-probe/process.mjs';
import { museModelList, readMuseAccountCache } from './catalog-probe/sources.mjs';
import { listCopilotModels } from './list-copilot-models.mjs';
import { redactVisibleText, stripTerminalPresentation } from './normalize-picker-paste.mjs';

export const STATES = {
  verified: 'ready, verified online',
  local: 'ready, local credentials',
  'signed-out': 'signed out or expired',
  'not-installed': 'not installed',
  unknown: 'unknown',
};

// The catalog probe's pattern for a CLI that refuses to answer without a sign-in.
const AUTH_PATTERN = /not (?:logged|signed) in|not authenticated|unauthori[sz]ed|please (?:log|sign) ?in|\blogin required|authentication (?:required|failed)|\b401\b/i;
const DEFAULT_TIMEOUT_MS = 60000;

function firstLine(text, limit = 120) {
  const line = stripTerminalPresentation(String(text ?? '')).split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  const { text: redacted } = redactVisibleText(line);
  return redacted.length > limit ? `${redacted.slice(0, limit)}...` : redacted;
}

function parseJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

const loggedIn = (text) => /logged in/i.test(text) && !/not logged in/i.test(text);

/** The real environment. Tests pass their own object with the same members. */
export function createContext({ env = process.env, home = homedir(), platform = process.platform, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const workDir = mkdtempSync(join(tmpdir(), 'cli-login-status-'));
  return {
    env,
    home,
    platform,
    timeoutMs,
    workDir,
    find: (name, extraDirs = []) => findExecutable(name, { env, extraDirs, platform }),
    async run(executable, args, envOptions = {}) {
      const result = await runCommand(launchSpec(executable, args, { platform }), { env: cleanEnv(env, envOptions), cwd: workDir, timeoutMs });
      return { ...result, text: `${result.stdout}\n${result.stderr}` };
    },
    readText(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    listFiles(dir) {
      try {
        return readdirSync(dir).map((name) => ({ name, size: statSync(join(dir, name)).size }));
      } catch {
        return [];
      }
    },
    realpath(path) {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    },
    cleanEnv: (options = {}) => cleanEnv(env, options),
    npmPackageDir: (executable, packageName) => npmPackageDir(executable, packageName, { platform }),
    museModelList,
    listCopilotModels,
    dispose() {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // A CLI that left a helper running can hold the directory; OS temp cleanup removes it.
      }
    },
  };
}

async function runCli(ctx, name, args, { extraDirs = [], env } = {}) {
  const executable = ctx.find(name, extraDirs);
  if (!executable) return { missing: true };
  return ctx.run(executable, args, env);
}

/** A status command: exit 0 plus `ok` is ready; an auth message is signed out; anything else is unknown. */
function judge(ctx, result, ok, state = 'local') {
  if (result.missing) return ['not-installed', ''];
  if (result.timedOut) return ['unknown', `no answer within ${ctx.timeoutMs} ms`];
  if (result.error) return ['unknown', `could not start: ${firstLine(result.error)}`];
  if (result.exitCode === 0 && ok(result.text)) return [state, firstLine(result.text)];
  if (AUTH_PATTERN.test(result.text)) return ['signed-out', firstLine(result.text)];
  return ['unknown', `exit ${result.exitCode}: ${firstLine(result.text) || 'no output'}`];
}

const failed = (result) => result.missing || result.timedOut || result.error || result.exitCode !== 0;

/**
 * Junie, Pi, Kimi, Goose and Cline are never launched, and only their credential files or a key
 * variable show a sign-in. Cats never opens a CLI credential or reads a key's value (ADR-038). By
 * the owner's 2026-11-16 decision a check may still see whether a credential file exists or a key
 * variable is set; where only the content would tell, the CLI is unknown.
 */
function ifInstalled(ctx, name, extraDirs, check) {
  return ctx.find(name, extraDirs) ? check() : ['not-installed', ''];
}

const isSet = (value) => typeof value === 'string' && value.length > 0;

/** Whether a non-empty file exists, from the directory listing; the file is never opened. */
function hasFile(ctx, dir, name) {
  return ctx.listFiles(dir).some((file) => file.name === name && file.size > 0);
}

/**
 * Kimi Code keeps each OAuth sign-in in `<KIMI_CODE_HOME>/credentials/<name>.json`, and logout
 * deletes it; `credentials/mcp/` holds MCP server sign-ins, not the CLI's. KIMI_MODEL_API_KEY is
 * the one shell variable Kimi reads directly (environment-bootstrap 4108ac8). config.toml, which
 * can hold API keys of providers a user added, is never opened; those are outside the catalog.
 * The one file read is the non-secret `region` marker, the sign-in's region token that Runtime
 * matches against `basis.region.id` to detect a catalog basis (SPEC-045 FR-6).
 */
function kimiSignIn(ctx) {
  if (isSet(ctx.env.KIMI_MODEL_API_KEY)) return ['local', 'KIMI_MODEL_API_KEY is set'];
  const kimiHome = ctx.env.KIMI_CODE_HOME || join(ctx.home, '.kimi-code');
  const files = ctx.listFiles(join(kimiHome, 'credentials')).filter((file) => file.name.endsWith('.json') && file.size > 0);
  if (files.length === 0) return ['signed-out', 'no Kimi Code OAuth credential file (run kimi login)'];
  const region = kimiRegion(ctx, kimiHome);
  return ['local', `credentials/${files[0].name} is present${region ? `; detected basis: region ${region}` : ''}`];
}

function kimiRegion(ctx, kimiHome) {
  const region = ctx.readText(join(kimiHome, 'region'))?.trim() ?? '';
  return /^[a-z0-9][a-z0-9._-]*$/.test(region) ? region : null;
}

// The versioned binary named by .muse-version, never the self-updating launcher.
function museBinary(ctx) {
  const dirs = [];
  if (ctx.env.LOCALAPPDATA) dirs.push(join(ctx.env.LOCALAPPDATA, 'Programs', 'muse'));
  const launcher = ctx.find('muse');
  if (launcher) dirs.push(dirname(ctx.realpath(launcher)));
  for (const dir of dirs) {
    const version = ctx.readText(join(dir, '.muse-version'))?.trim();
    if (!version) continue;
    const files = new Set(ctx.listFiles(dir).map((file) => file.name));
    const binary = [`muse-bin-${version}.exe`, `muse-bin-${version}`].find((name) => files.has(name));
    if (binary) return join(dir, binary);
  }
  return null;
}

/** Catalog CLIs in the skill's order, keyed by their probe provider names. */
export const CHECKS = [
  {
    provider: 'codex',
    method: '`codex login status`',
    check: async (ctx) => judge(ctx, await runCli(ctx, 'codex', ['login', 'status']), loggedIn),
  },
  {
    provider: 'claude',
    method: '`claude auth status` JSON loggedIn',
    async check(ctx) {
      // Signed out, it can exit non-zero with the same JSON.
      const result = await runCli(ctx, 'claude', ['auth', 'status']);
      if (result.missing || result.timedOut || result.error) return judge(ctx, result, () => false);
      const status = parseJson(result.stdout);
      if (status?.loggedIn === true) return ['local', `loggedIn (${status.authMethod ?? 'unknown method'})`];
      if (status?.loggedIn === false) return ['signed-out', 'loggedIn: false'];
      return judge(ctx, result, () => false);
    },
  },
  {
    provider: 'antigravity',
    method: '`agy models` lists rows',
    async check(ctx) {
      const extraDirs = ctx.env.LOCALAPPDATA ? [join(ctx.env.LOCALAPPDATA, 'agy', 'bin')] : [];
      const result = await runCli(ctx, 'agy', ['models'], { extraDirs });
      const rows = String(result.stdout ?? '').split(/\r?\n/).filter((line) => /^\S+\t\S/.test(line)).length;
      const [state, detail] = judge(ctx, result, () => rows > 0, 'verified');
      return [state, state === 'verified' ? `agy models listed ${rows} models` : detail];
    },
  },
  {
    // A call can refresh an expired sign-in and still print "not authenticated"; the next one
    // answers for the account (2026-10-03 and 2026-10-19), so one retry decides.
    provider: 'grok',
    method: '`grok models` sign-in line, retried once',
    async check(ctx) {
      const options = { extraDirs: [join(ctx.home, '.grok', 'bin')] };
      const ok = (text) => /you are logged in/i.test(text);
      const [state, detail] = judge(ctx, await runCli(ctx, 'grok', ['models'], options), ok, 'verified');
      if (state === 'verified' || state === 'not-installed') return [state, detail];
      const [retryState, retryDetail] = judge(ctx, await runCli(ctx, 'grok', ['models'], options), ok, 'verified');
      return [retryState, retryState === 'verified' ? `${retryDetail} (the first call refreshed the sign-in)` : retryDetail];
    },
  },
  {
    provider: 'muse',
    method: 'MSP `model/list` answers from providerCatalog, else the CLI account cache matches its profile',
    async check(ctx) {
      const binary = museBinary(ctx);
      if (!binary) return ctx.find('muse') ? ['unknown', 'no muse-bin named by .muse-version'] : ['not-installed', ''];
      try {
        const reply = await ctx.museModelList({ binary, env: ctx.cleanEnv(), timeoutMs: ctx.timeoutMs });
        if (reply?.source === 'providerCatalog') return ['verified', `model/list answered for the account (${reply.models?.length ?? 0} models)`];
        // muse-bin 1.4.20 answered from bundledCatalog while signed in; the account cache it
        // wrote at sign-in shows the sign-in without asking the server.
        const cached = readMuseAccountCache(
          { museHome: reply?.museHome, providerId: reply?.providerId, profileId: reply?.profileId },
          { list: (dir) => ctx.listFiles(dir).map((entry) => entry.name), read: (path) => ctx.readText(path), modified: () => null },
        );
        if (cached) {
          return ['local', `model/list answered from ${reply?.source ?? 'an unknown source'}; the CLI account cache lists ${cached.cache.rows.length} models`];
        }
        return ['unknown', `model/list answered from ${reply?.source ?? 'an unknown source'}, not the account, and no account cache matched; muse login may be needed`];
      } catch (error) {
        return [error?.reason === 'not-authenticated' ? 'signed-out' : 'unknown', firstLine(error?.message ?? error)];
      }
    },
  },
  {
    // Never executed: Defender has blocked an agent-launched Junie.
    provider: 'junie',
    method: 'DPAPI credential files are present (Windows), never opened or launched',
    check: async (ctx) => ifInstalled(ctx, 'junie', [join(ctx.home, '.local', 'bin')], () => {
      // The token variable named in src/core/provider-install/knowledge.ts; only whether it is set.
      if (isSet(ctx.env.JUNIE_API_KEY)) return ['local', 'JUNIE_API_KEY is set'];
      if (ctx.platform !== 'win32') return ['unknown', 'Junie credential storage is known only on Windows'];
      const files = ctx.listFiles(join(ctx.home, '.junie', 'dpapi_credentials')).filter((file) => file.name.endsWith('.dpapi') && file.size > 0);
      return files.length > 0
        ? ['local', `${files.length} DPAPI credential files; expiry cannot be read without starting Junie`]
        : ['signed-out', 'no DPAPI credential files'];
    }),
  },
  {
    provider: 'kiro',
    method: '`kiro-cli whoami`',
    check: async (ctx) => judge(ctx, await runCli(ctx, 'kiro-cli', ['whoami'], {
      extraDirs: ctx.env.LOCALAPPDATA ? [join(ctx.env.LOCALAPPDATA, 'Kiro-Cli')] : [],
      env: { dropPrefixes: ['KIRO_', 'JSC_'], drop: ['AWS_EXECUTION_ENV'] },
    }), loggedIn),
  },
  {
    provider: 'auggie',
    method: '`auggie model list --json` registryAvailable',
    async check(ctx) {
      const result = await runCli(ctx, 'auggie', ['model', 'list', '--json'], { env: { dropPrefixes: ['AUGMENT_', 'AUGGIE_'] } });
      if (failed(result)) return judge(ctx, result, () => false);
      const list = parseJson(result.stdout);
      if (list?.registryAvailable === true) return ['verified', `registryAvailable: true (${list.models?.length ?? 0} models)`];
      if (list?.registryAvailable === false) return ['unknown', 'registryAvailable: false; signed out or offline'];
      return judge(ctx, result, () => false);
    },
  },
  {
    provider: 'copilot',
    method: 'headless `models.list`',
    async check(ctx) {
      const executable = ctx.find('copilot');
      if (!executable) return ['not-installed', ''];
      const packageDir = ctx.npmPackageDir(executable, '@github/copilot');
      if (!packageDir) return ['unknown', 'the npm-installed @github/copilot package was not found'];
      try {
        const reply = await ctx.listCopilotModels({ loader: join(packageDir, 'npm-loader.js'), timeoutMs: ctx.timeoutMs, cwd: ctx.workDir, env: ctx.cleanEnv() });
        return ['verified', `models.list returned ${reply.models.length} models`];
      } catch (error) {
        const message = error?.message ?? String(error);
        return [AUTH_PATTERN.test(message) ? 'signed-out' : 'unknown', firstLine(message)];
      }
    },
  },
  {
    // auth.json holds every Pi provider, so only its content would show the openai-codex sign-in.
    provider: 'pi',
    method: '`~/.pi/agent/auth.json` is present, never opened or launched',
    check: async (ctx) => ifInstalled(ctx, 'pi', [], () => (hasFile(ctx, join(ctx.home, '.pi', 'agent'), 'auth.json')
      ? ['unknown', 'auth.json is present; only its content, which Cats never reads, shows an openai-codex sign-in']
      : ['signed-out', 'no auth.json (/login in pi)'])),
  },
  {
    // Never executed: each launch of the 160 MB binary takes seconds and can apply a staged update.
    provider: 'kimi',
    method: 'a `<KIMI_CODE_HOME>/credentials/*.json` file is present or KIMI_MODEL_API_KEY is set, never opened or launched',
    check: async (ctx) => {
      const installDir = ctx.env.KIMI_INSTALL_DIR || join(ctx.home, '.kimi-code');
      return ifInstalled(ctx, 'kimi', [join(installDir, 'bin')], () => kimiSignIn(ctx));
    },
  },
  {
    provider: 'goose',
    method: '`chatgpt_codex/tokens.json` is present, never opened or launched',
    check: async (ctx) => ifInstalled(ctx, 'goose', [join(ctx.home, '.local', 'bin')], () => {
      const configDir = ctx.platform === 'win32'
        ? join(ctx.env.APPDATA ?? join(ctx.home, 'AppData', 'Roaming'), 'Block', 'goose', 'config')
        : join(ctx.home, '.config', 'goose');
      return hasFile(ctx, join(configDir, 'chatgpt_codex'), 'tokens.json')
        ? ['local', 'chatgpt_codex/tokens.json is present']
        : ['signed-out', 'no chatgpt_codex token file (sign in again with goose configure)'];
    }),
  },
  {
    provider: 'cursor',
    method: '`cursor-agent status`',
    check: async (ctx) => judge(ctx, await runCli(ctx, 'cursor-agent', ['status'], {
      extraDirs: ctx.env.LOCALAPPDATA ? [join(ctx.env.LOCALAPPDATA, 'cursor-agent')] : [],
    }), (text) => /logged in as/i.test(text)),
  },
  {
    provider: 'devin',
    method: '`devin auth status`',
    check: async (ctx) => judge(ctx, await runCli(ctx, 'devin', ['auth', 'status'], {
      extraDirs: ctx.env.LOCALAPPDATA ? [join(ctx.env.LOCALAPPDATA, 'devin', 'cli', 'bin')] : [],
    }), loggedIn),
  },
  {
    provider: 'opencode',
    method: '`opencode auth list` has OpenCode Go',
    check: async (ctx) => channelCredential(ctx, 'opencode', 'OpenCode Go', { set: { OPENCODE_DISABLE_AUTOUPDATE: 'true' } }),
  },
  {
    provider: 'kilo',
    method: '`kilo auth list` has Kilo Gateway',
    check: async (ctx) => channelCredential(ctx, 'kilo', 'Kilo Gateway'),
  },
  {
    // Never executed: Cline's informational flags have started npm updates. providers.json holds
    // every Cline provider, so only its content would show the cline-pass sign-in.
    provider: 'cline',
    method: '`~/.cline/data/settings/providers.json` is present, never opened or launched',
    check: async (ctx) => ifInstalled(ctx, 'cline', [], () => (hasFile(ctx, join(ctx.home, '.cline', 'data', 'settings'), 'providers.json')
      ? ['unknown', 'providers.json is present; only its content, which Cats never reads, shows a cline-pass sign-in']
      : ['signed-out', 'no providers.json (cline auth)'])),
  },
];

/** OpenCode and Kilo list stored credentials by provider name; the scope's channel must be there. */
async function channelCredential(ctx, name, channel, env) {
  const result = await runCli(ctx, name, ['auth', 'list'], { env });
  const listed = (text) => text.toLowerCase().includes(channel.toLowerCase());
  const [state, detail] = judge(ctx, result, listed);
  if (state === 'local') return [state, `auth list has a credential for ${channel}`];
  if (state === 'unknown' && result.exitCode === 0) return ['signed-out', `auth list has no credential for ${channel}`];
  return [state, detail];
}

function providerList(value) {
  if (!value) return null;
  const names = value.split(',').map((name) => name.trim()).filter(Boolean);
  const unknown = names.filter((name) => !CHECKS.some((entry) => entry.provider === name));
  if (unknown.length) {
    throw new Error(`Unknown provider ${unknown.join(', ')}. Known: ${CHECKS.map((entry) => entry.provider).join(', ')}.`);
  }
  return names;
}

/** --providers keeps only the named CLIs; --skip drops CLIs this machine does not use. */
export function selectChecks({ providers, skip } = {}) {
  const wanted = providerList(providers);
  const skipped = providerList(skip) ?? [];
  return CHECKS.filter((entry) => (!wanted || wanted.includes(entry.provider)) && !skipped.includes(entry.provider));
}

/** Runs the checks concurrently; one that throws is reported as unknown, never fatal. */
export async function checkLoginStatus(ctx, checks = CHECKS) {
  return Promise.all(checks.map(async ({ provider, method, check }) => {
    try {
      const [state, detail] = await check(ctx);
      return { provider, state, detail, method };
    } catch (error) {
      return { provider, state: 'unknown', detail: `check failed: ${firstLine(error?.message ?? error)}`, method };
    }
  }));
}

export function renderStatus(results) {
  const nameWidth = Math.max(...results.map((result) => result.provider.length)) + 2;
  const stateWidth = Math.max(...Object.values(STATES).map((label) => label.length)) + 2;
  return [
    ...results.map((result) => `  ${result.provider.padEnd(nameWidth)}${STATES[result.state].padEnd(stateWidth)}${result.detail}`.trimEnd()),
    '',
    `"${STATES.verified}": an account-scoped read reached the server just now.`,
    `"${STATES.local}": a status command or a present credential file shows a sign-in, but no server was asked;`,
    '  a revoked sign-in shows up only on first use.',
  ].join('\n');
}

export const exitCodeFor = (results) => (results.some((result) => result.state === 'signed-out') ? 2 : 0);

function usage() {
  return [
    'Usage:',
    '  cli-login-status.mjs [--providers codex,grok | --skip muse,cursor] [--timeout <ms>] [--json]',
    '',
    'Reports for each catalog CLI whether it can be used now: ready (verified online or from local',
    'credentials), signed out or expired, not installed, or unknown. It never logs in, sends a prompt',
    'or opens a credential; Junie, Pi, Kimi, Goose and Cline are checked only by whether a credential',
    'file exists or a key variable is set.',
    `--timeout bounds each CLI (default ${DEFAULT_TIMEOUT_MS} ms). --json prints the results as JSON.`,
    'Exit codes: 0 nothing needs a sign-in, 2 at least one CLI is signed out or expired, 1 the tool failed.',
  ].join('\n');
}

async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      providers: { type: 'string' },
      skip: { type: 'string' },
      timeout: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const timeoutMs = values.timeout ? Number(values.timeout) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new Error('--timeout must be an integer of at least 1000 ms.');
  const checks = selectChecks({ providers: values.providers, skip: values.skip });
  const ctx = createContext({ timeoutMs });
  // Muse's MSP host takes no cwd, so every child starts in the private directory.
  const cwd = process.cwd();
  process.chdir(ctx.workDir);
  let results;
  try {
    results = await checkLoginStatus(ctx, checks);
  } finally {
    process.chdir(cwd);
    ctx.dispose();
  }
  process.stdout.write(values.json ? `${JSON.stringify(results, null, 2)}\n` : `${renderStatus(results)}\n`);
  return exitCodeFor(results);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
