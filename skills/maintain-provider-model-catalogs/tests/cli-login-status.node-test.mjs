import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHECKS,
  STATES,
  checkLoginStatus,
  exitCodeFor,
  renderStatus,
  selectChecks,
} from '../scripts/cli-login-status.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../scripts/cli-login-status.mjs');
const HOME = join('fake', 'home');
const LOCALAPPDATA = join(HOME, 'AppData', 'Local');
const APPDATA = join(HOME, 'AppData', 'Roaming');

/**
 * Stands in for createContext: `runs` maps "<command> <args>" to one result or a queue of
 * results. Every launch and every opened file is recorded, so a test can prove a CLI was never
 * started and a credential file was never opened.
 */
function fakeContext({ installed = [], runs = {}, files = {}, dirs = {}, env = {}, platform = 'win32', packageDirs = {}, muse, copilot } = {}) {
  const calls = [];
  const opened = [];
  const pending = Object.fromEntries(Object.entries(runs).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]));
  const answer = (value) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
  return {
    calls,
    opened,
    env: { LOCALAPPDATA, APPDATA, ...env },
    home: HOME,
    platform,
    timeoutMs: 5000,
    workDir: join(HOME, 'work'),
    find: (name) => (installed.includes(name) ? join('bin', name) : null),
    async run(executable, args) {
      const key = [basename(executable), ...args].join(' ');
      calls.push(key);
      const next = pending[key]?.shift();
      if (!next) throw new Error(`unexpected launch: ${key}`);
      const result = { exitCode: 0, stdout: '', stderr: '', timedOut: false, ...next };
      return { ...result, text: `${result.stdout}\n${result.stderr}` };
    },
    readText: (path) => {
      opened.push(path);
      return files[path] ?? null;
    },
    listFiles: (dir) => dirs[dir] ?? [],
    realpath: (path) => path,
    cleanEnv: () => ({}),
    npmPackageDir: (executable, packageName) => packageDirs[packageName] ?? null,
    museModelList(options) {
      calls.push(`muse model/list ${options.binary}`);
      return answer(muse);
    },
    listCopilotModels(options) {
      calls.push(`copilot models.list ${options.loader}`);
      return answer(copilot);
    },
  };
}

async function checkOne(provider, context) {
  const [result] = await checkLoginStatus(context, selectChecks({ providers: provider }));
  return result;
}

test('lists the seventeen catalog CLIs in the skill order', () => {
  assert.deepEqual(CHECKS.map((entry) => entry.provider), [
    'codex', 'claude', 'antigravity', 'grok', 'muse', 'junie', 'kiro', 'auggie',
    'copilot', 'pi', 'kimi', 'goose', 'cursor', 'devin', 'opencode', 'kilo', 'cline',
  ]);
  for (const entry of CHECKS) assert.ok(entry.method, `${entry.provider} documents its method`);
});

test('reads status commands as local sign-ins and auth messages as signed out', async () => {
  const context = fakeContext({
    installed: ['codex', 'kiro-cli', 'devin', 'cursor-agent'],
    runs: {
      'codex login status': [{ stderr: 'Logged in using ChatGPT\n' }, { exitCode: 1, stderr: 'Not logged in\n' }],
      'kiro-cli whoami': { stdout: 'Logged in with Google\nEmail: someone@example.com\n' },
      'devin auth status': { exitCode: 1, stdout: 'Not logged in. Run devin auth login.\n' },
      'cursor-agent status': { stdout: 'Logged in as someone@example.com\n' },
    },
  });

  assert.deepEqual(await checkOne('codex', context), {
    provider: 'codex', state: 'local', detail: 'Logged in using ChatGPT', method: '`codex login status`',
  });
  assert.equal((await checkOne('codex', context)).state, 'signed-out');
  assert.equal((await checkOne('kiro', context)).state, 'local');
  assert.equal((await checkOne('devin', context)).state, 'signed-out');
  const cursor = await checkOne('cursor', context);
  assert.equal(cursor.state, 'local');
  assert.doesNotMatch(cursor.detail, /@/, 'emails are redacted');
});

test('reads Claude auth status JSON, including a signed-out non-zero exit', async () => {
  const context = fakeContext({
    installed: ['claude'],
    runs: {
      'claude auth status': [
        { stdout: '{"loggedIn": true, "authMethod": "claude.ai"}\n' },
        { exitCode: 1, stdout: '{"loggedIn": false}\n' },
        { stdout: 'unexpected\n' },
      ],
    },
  });

  assert.deepEqual(
    [await checkOne('claude', context), await checkOne('claude', context), await checkOne('claude', context)].map(({ state, detail }) => [state, detail]),
    [['local', 'loggedIn (claude.ai)'], ['signed-out', 'loggedIn: false'], ['unknown', 'exit 0: unexpected']],
  );
});

test('treats a listed account read as verified online', async () => {
  const context = fakeContext({
    installed: ['agy', 'auggie'],
    runs: {
      'agy models': [
        { stdout: 'Fetching available models...\nmodel-a-low\tModel A (Low)\nmodel-a-high\tModel A (High)\n' },
        { exitCode: 1, stderr: 'Please sign in first.\n' },
      ],
      'auggie model list --json': [
        { stdout: '{"registryAvailable": true, "models": [{"id": "a"}, {"id": "b"}]}' },
        { stdout: '{"registryAvailable": false, "models": []}' },
      ],
    },
  });

  assert.deepEqual(await checkOne('antigravity', context), {
    provider: 'antigravity', state: 'verified', detail: 'agy models listed 2 models', method: '`agy models` lists rows',
  });
  assert.equal((await checkOne('antigravity', context)).state, 'signed-out');
  assert.equal((await checkOne('auggie', context)).detail, 'registryAvailable: true (2 models)');
  assert.equal((await checkOne('auggie', context)).state, 'unknown');
});

test('retries grok once because the first call can only refresh the sign-in', async () => {
  const refreshed = fakeContext({
    installed: ['grok'],
    runs: { 'grok models': [{ stdout: 'You are not authenticated.\n' }, { stdout: 'You are logged in with grok.com.\n' }] },
  });
  const result = await checkOne('grok', refreshed);
  assert.equal(result.state, 'verified');
  assert.match(result.detail, /first call refreshed/);
  assert.equal(refreshed.calls.length, 2);

  const signedOut = fakeContext({
    installed: ['grok'],
    runs: { 'grok models': [{ stdout: 'You are not authenticated.\n' }, { stdout: 'You are not authenticated.\n' }] },
  });
  assert.equal((await checkOne('grok', signedOut)).state, 'signed-out');

  const once = fakeContext({ installed: ['grok'], runs: { 'grok models': { stdout: 'You are logged in with grok.com.\n' } } });
  await checkOne('grok', once);
  assert.equal(once.calls.length, 1, 'a signed-in first answer is not repeated');
});

test('asks the versioned Muse binary and accepts only the account catalog', async () => {
  const dir = join(LOCALAPPDATA, 'Programs', 'muse');
  const setup = (muse) => fakeContext({
    installed: ['muse'],
    files: { [join(dir, '.muse-version')]: '1.4.10-R1\r\n' },
    dirs: { [dir]: [{ name: 'muse.cmd', size: 1 }, { name: 'muse-bin-1.4.10-R1.exe', size: 1 }] },
    muse,
  });

  const signedIn = setup({ source: 'providerCatalog', models: [{}, {}, {}] });
  assert.equal((await checkOne('muse', signedIn)).state, 'verified');
  assert.deepEqual(signedIn.calls, [`muse model/list ${join(dir, 'muse-bin-1.4.10-R1.exe')}`]);

  assert.equal((await checkOne('muse', setup({ source: 'bundledCatalog', models: [] }))).state, 'unknown');
  const refused = Object.assign(new Error('MSP model/list failed: not authenticated'), { reason: 'not-authenticated' });
  assert.equal((await checkOne('muse', setup(refused))).state, 'signed-out');

  const noVersion = fakeContext({ installed: ['muse'] });
  assert.deepEqual([(await checkOne('muse', noVersion)).state, noVersion.calls], ['unknown', []]);
});

test('accepts the Muse account cache when MSP answers from bundledCatalog', async () => {
  const dir = join(LOCALAPPDATA, 'Programs', 'muse');
  const museHome = join(HOME, '.local', 'share', 'muse');
  const cacheDir = join(museHome, 'model-catalog');
  const setup = (profileId) => fakeContext({
    installed: ['muse'],
    files: {
      [join(dir, '.muse-version')]: '1.4.20-R1\r\n',
      [join(cacheDir, 'a__p01.json')]: JSON.stringify({ source: 'provider_catalog', provider_id: 'meta', profile_id: 'x', rows: [{}, {}, {}] }),
    },
    dirs: { [dir]: [{ name: 'muse-bin-1.4.20-R1.exe', size: 1 }], [cacheDir]: [{ name: 'a__p01.json', size: 1 }] },
    muse: { source: 'bundledCatalog', providerId: 'meta', profileId, museHome, models: [] },
  });
  const cached = await checkOne('muse', setup('x'));
  assert.deepEqual([cached.state, cached.detail], ['local', 'model/list answered from bundledCatalog; the CLI account cache lists 3 models']);
  assert.equal((await checkOne('muse', setup('another-profile'))).state, 'unknown');
});

test('reads Copilot models.list from the npm package loader', async () => {
  const packageDirs = { '@github/copilot': join('npm', 'node_modules', '@github', 'copilot') };
  const ready = fakeContext({ installed: ['copilot'], packageDirs, copilot: { models: [{}, {}] } });
  assert.equal((await checkOne('copilot', ready)).detail, 'models.list returned 2 models');
  assert.deepEqual(ready.calls, [`copilot models.list ${join(packageDirs['@github/copilot'], 'npm-loader.js')}`]);

  const refused = fakeContext({ installed: ['copilot'], packageDirs, copilot: new Error('models.list failed: Not authenticated') });
  assert.equal((await checkOne('copilot', refused)).state, 'signed-out');
  assert.equal((await checkOne('copilot', fakeContext({ installed: ['copilot'] }))).state, 'unknown');
});

test('requires the scope channel in OpenCode and Kilo stored credentials', async () => {
  const context = fakeContext({
    installed: ['opencode', 'kilo'],
    runs: {
      'opencode auth list': [{ stdout: '●  OpenCode Go api\n└  1 credentials\n' }, { stdout: '●  Anthropic oauth\n' }],
      'kilo auth list': { stdout: '●  Kilo Gateway oauth\n' },
    },
  });

  assert.equal((await checkOne('opencode', context)).detail, 'auth list has a credential for OpenCode Go');
  assert.deepEqual(
    Object.values(await checkOne('opencode', context)).slice(1, 3),
    ['signed-out', 'auth list has no credential for OpenCode Go'],
  );
  assert.equal((await checkOne('kilo', context)).state, 'local');
});

test('checks Junie, Pi, Kimi, Goose and Cline by file presence and set variables, never opening a credential file', async () => {
  const kimiHome = join(HOME, '.kimi-code');
  const gooseDir = join(APPDATA, 'Block', 'goose', 'config', 'chatgpt_codex');
  const signedIn = fakeContext({
    installed: ['junie', 'pi', 'kimi', 'goose', 'cline'],
    // Contents exist only to prove they are never opened.
    files: {
      [join(HOME, '.pi', 'agent', 'auth.json')]: '{"openai-codex": {"refresh": "r"}}',
      [join(gooseDir, 'tokens.json')]: '{"refresh_token": "r"}',
      [join(HOME, '.cline', 'data', 'settings', 'providers.json')]: '{"providers": {"cline-pass": {}}}',
      [join(kimiHome, 'credentials', 'kimi-code.json')]: '{"refresh_token": "r"}',
      // The sign-in region marker, the one non-secret file read (SPEC-045 FR-6).
      [join(kimiHome, 'region')]: ['global', ''].join('\n'),
    },
    dirs: {
      [join(HOME, '.junie', 'dpapi_credentials')]: [{ name: 'a.dpapi', size: 352 }, { name: 'empty.dpapi', size: 0 }, { name: 'note.txt', size: 9 }],
      [join(HOME, '.pi', 'agent')]: [{ name: 'auth.json', size: 120 }],
      [join(kimiHome, 'credentials')]: [{ name: 'mcp', size: 0 }, { name: 'kimi-code.json', size: 900 }],
      [gooseDir]: [{ name: 'tokens.json', size: 300 }],
      [join(HOME, '.cline', 'data', 'settings')]: [{ name: 'providers.json', size: 800 }],
    },
  });
  const results = await checkLoginStatus(signedIn, selectChecks({ providers: 'junie,pi,kimi,goose,cline' }));
  assert.deepEqual(results.map(({ provider, state, detail }) => [provider, state, detail]), [
    ['junie', 'local', '1 DPAPI credential files; expiry cannot be read without starting Junie'],
    ['pi', 'unknown', 'auth.json is present; only its content, which Cats never reads, shows an openai-codex sign-in'],
    ['kimi', 'local', 'credentials/kimi-code.json is present; detected basis: region global'],
    ['goose', 'local', 'chatgpt_codex/tokens.json is present'],
    ['cline', 'unknown', 'providers.json is present; only its content, which Cats never reads, shows a cline-pass sign-in'],
  ]);
  assert.deepEqual(signedIn.opened, [join(kimiHome, 'region')], 'only the region marker was opened, no credential file');

  const signedOut = fakeContext({
    installed: ['junie', 'pi', 'kimi', 'goose', 'cline'],
    files: { [join(kimiHome, 'config.toml')]: 'api_key = "sk-x"' },
    dirs: { [join(kimiHome, 'credentials')]: [{ name: 'mcp', size: 0 }, { name: 'empty.json', size: 0 }] },
  });
  const outcomes = await checkLoginStatus(signedOut, selectChecks({ providers: 'junie,pi,kimi,goose,cline' }));
  assert.deepEqual(outcomes.map((result) => result.state), Array(5).fill('signed-out'));
  assert.deepEqual(signedOut.opened, [], 'config.toml, which can hold API keys, was not opened either');
  assert.deepEqual([...signedIn.calls, ...signedOut.calls], [], 'none of them was launched');

  // Only whether a key variable is set counts; its value is never shown.
  const keys = fakeContext({ installed: ['junie', 'kimi'], platform: 'linux', env: { JUNIE_API_KEY: 'secret-k', KIMI_MODEL_API_KEY: 'secret-k' } });
  const keyed = await checkLoginStatus(keys, selectChecks({ providers: 'junie,kimi' }));
  assert.deepEqual(keyed.map(({ state, detail }) => [state, detail]), [['local', 'JUNIE_API_KEY is set'], ['local', 'KIMI_MODEL_API_KEY is set']]);
  assert.equal((await checkOne('junie', fakeContext({ installed: ['junie'], platform: 'linux' }))).state, 'unknown');
  const linuxGoose = fakeContext({ installed: ['goose'], platform: 'linux', dirs: { [join(HOME, '.config', 'goose', 'chatgpt_codex')]: [{ name: 'tokens.json', size: 9 }] } });
  assert.equal((await checkOne('goose', linuxGoose)).state, 'local');
  const moved = fakeContext({ installed: ['kimi'], env: { KIMI_CODE_HOME: join(HOME, 'alt') }, dirs: { [join(HOME, 'alt', 'credentials')]: [{ name: 'a.json', size: 9 }] } });
  assert.equal((await checkOne('kimi', moved)).state, 'local');
  assert.equal((await checkOne('kimi', fakeContext())).state, 'not-installed');
});

test('reports missing CLIs, timeouts and failing checks without stopping the run', async () => {
  const none = await checkLoginStatus(fakeContext());
  assert.equal(none.length, 17);
  assert.ok(none.every((result) => result.state === 'not-installed' && result.detail === ''), JSON.stringify(none));

  const context = fakeContext({
    installed: ['codex', 'kiro-cli'],
    runs: { 'codex login status': { exitCode: null, timedOut: true } },
  });
  const [codex, kiro] = await checkLoginStatus(context, selectChecks({ providers: 'codex,kiro' }));
  assert.deepEqual([codex.state, codex.detail], ['unknown', 'no answer within 5000 ms']);
  assert.deepEqual([kiro.state, kiro.detail], ['unknown', 'check failed: unexpected launch: kiro-cli whoami']);
});

test('selects CLIs like the catalog probe and rejects unknown names', () => {
  assert.deepEqual(selectChecks({ providers: 'grok, codex' }).map((entry) => entry.provider), ['codex', 'grok']);
  assert.equal(selectChecks({ skip: 'muse,cursor' }).length, 15);
  assert.throws(() => selectChecks({ providers: 'codex,nope' }), /Unknown provider nope\. Known: codex, claude/);
});

test('renders one aligned line per CLI and exits 2 only for a needed sign-in', () => {
  const results = [
    { provider: 'codex', state: 'local', detail: 'Logged in using ChatGPT' },
    { provider: 'antigravity', state: 'verified', detail: 'agy models listed 13 models' },
    { provider: 'kilo', state: 'not-installed', detail: '' },
  ];
  const lines = renderStatus(results).split('\n');
  assert.equal(lines[0], '  codex        ready, local credentials  Logged in using ChatGPT');
  assert.ok(lines.at(-3).includes(STATES.verified));
  assert.equal(lines[2], '  kilo         not installed');
  assert.equal(lines[1].indexOf('agy models'), lines[0].indexOf('Logged in'));
  assert.equal(exitCodeFor(results), 0);
  assert.equal(exitCodeFor([...results, { provider: 'pi', state: 'unknown', detail: '' }]), 0);
  assert.equal(exitCodeFor([...results, { provider: 'pi', state: 'signed-out', detail: '' }]), 2);
});

test('the command line prints help and refuses bad arguments before launching anything', () => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--providers codex,grok/);

  const unknown = run('--providers', 'nope');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown provider nope/);
  assert.equal(run('--timeout', '5').status, 1);
});
