#!/usr/bin/env node

// Answers one question per catalog CLI: can it be used right now, or does it need a sign-in?
// Read-only: it never logs in, sends a prompt, opens a session or prints a credential. Where a CLI
// has an account-scoped read (a model list), the check reaches its server; otherwise it runs the
// CLI's own status command or only checks that its credential file holds a refresh token.
// Cline, Junie, Pi and Goose are never launched.

import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cleanEnv, findExecutable, launchSpec, npmPackageDir, runCommand } from './catalog-probe/process.mjs';
import { museModelList } from './catalog-probe/sources.mjs';
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

const hasText = (value) => typeof value === 'string' && value.length > 0;
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

/** Checks that only read a credential file still report a CLI that is not installed. */
function ifInstalled(ctx, name, extraDirs, check) {
  return ctx.find(name, extraDirs) ? check() : ['not-installed', ''];
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
    method: 'MSP `model/list` answers from providerCatalog',
    async check(ctx) {
      const binary = museBinary(ctx);
      if (!binary) return ctx.find('muse') ? ['unknown', 'no muse-bin named by .muse-version'] : ['not-installed', ''];
      try {
        const reply = await ctx.museModelList({ binary, env: ctx.cleanEnv(), timeoutMs: ctx.timeoutMs });
        if (reply?.source === 'providerCatalog') return ['verified', `model/list answered for the account (${reply.models?.length ?? 0} models)`];
        return ['unknown', `model/list answered from ${reply?.source ?? 'an unknown source'}, not the account; muse login may be needed`];
      } catch (error) {
        return [error?.reason === 'not-authenticated' ? 'signed-out' : 'unknown', firstLine(error?.message ?? error)];
      }
    },
  },
  {
    // Defender has blocked an agent-launched Junie while it reads these, so only check presence.
    provider: 'junie',
    method: 'DPAPI credential files (Windows), never launched',
    check: async (ctx) => ifInstalled(ctx, 'junie', [join(ctx.home, '.local', 'bin')], () => {
      // The token variable named in src/core/provider-install/knowledge.ts.
      if (hasText(ctx.env.JUNIE_API_KEY)) return ['local', 'JUNIE_API_KEY is set'];
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
    provider: 'pi',
    method: '`~/.pi/agent/auth.json` openai-codex refresh token, never launched',
    check: async (ctx) => ifInstalled(ctx, 'pi', [], () => {
      const auth = parseJson(ctx.readText(join(ctx.home, '.pi', 'agent', 'auth.json')))?.['openai-codex'];
      return hasText(auth?.refresh)
        ? ['local', 'auth.json holds an openai-codex refresh token']
        : ['signed-out', 'auth.json has no openai-codex sign-in (/login in pi)'];
    }),
  },
  {
    provider: 'goose',
    method: '`chatgpt_codex/tokens.json` refresh token, never launched',
    check: async (ctx) => ifInstalled(ctx, 'goose', [join(ctx.home, '.local', 'bin')], () => {
      const configDir = ctx.platform === 'win32'
        ? join(ctx.env.APPDATA ?? join(ctx.home, 'AppData', 'Roaming'), 'Block', 'goose', 'config')
        : join(ctx.home, '.config', 'goose');
      const tokens = parseJson(ctx.readText(join(configDir, 'chatgpt_codex', 'tokens.json')));
      return hasText(tokens?.refresh_token)
        ? ['local', 'chatgpt_codex/tokens.json holds a refresh token']
        : ['signed-out', 'no chatgpt_codex token (sign in again with goose configure)'];
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
    // Never executed: Cline's informational flags have started npm updates.
    provider: 'cline',
    method: '`~/.cline/data/settings/providers.json` cline-pass refresh token, never launched',
    check: async (ctx) => ifInstalled(ctx, 'cline', [], () => {
      const pass = parseJson(ctx.readText(join(ctx.home, '.cline', 'data', 'settings', 'providers.json')))?.providers?.['cline-pass'];
      return hasText(pass?.settings?.auth?.refreshToken)
        ? ['local', 'providers.json holds a cline-pass refresh token']
        : ['signed-out', 'providers.json has no cline-pass sign-in (cline auth)'];
    }),
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
    `"${STATES.local}": a status command or credential file shows a sign-in, but no server was asked;`,
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
    'or prints a credential; Cline, Junie, Pi and Goose are only checked through their credential files.',
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
