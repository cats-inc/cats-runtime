// Process helpers for the catalog probe: a cleaned environment, PATH lookup, npm shim resolution
// without cmd.exe, and bounded runs that stop the whole process tree on timeout.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';

// Terminal and host-agent variables that can make a CLI refuse a non-interactive run or change
// what it reads. Provider sources add their own prefixes (COPILOT_, KIRO_, ...).
const DROP_ENV = new Set([
  'TERM', 'CI', 'NO_COLOR', 'FORCE_COLOR', 'PAGER', 'GIT_PAGER', 'GIT_TERMINAL_PROMPT', 'GIT_ASKPASS',
  'CLAUDECODE', 'CLAUDE_PID',
]);
const DROP_PREFIXES = ['CLAUDE_CODE_'];
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** Includes nested helpers that preserve errno only in their error message. */
export function isPermissionDenied(error) {
  return ['EPERM', 'EACCES'].includes(error?.code)
    || /\b(?:EPERM|EACCES)\b/.test(String(error?.message ?? error));
}

export function cleanEnv(base = process.env, { dropPrefixes = [], drop = [], set = {} } = {}) {
  const env = {};
  const prefixes = [...DROP_PREFIXES, ...dropPrefixes];
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (DROP_ENV.has(key) || drop.includes(key)) continue;
    if (prefixes.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  return { ...env, ...set };
}

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function pathEntries(env) {
  const raw = env.PATH ?? env.Path ?? '';
  return raw.split(delimiter).map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Finds a command on PATH, then in the extra directories a source knows about. On Windows,
 * `.exe` wins over an npm `.cmd` shim in the same directory.
 */
export function findExecutable(name, { env = process.env, extraDirs = [], platform = process.platform } = {}) {
  const dirs = [...pathEntries(env), ...extraDirs.filter(Boolean)];
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = join(isAbsolute(dir) ? dir : resolve(dir), `${name}${extension}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

// The tail of an npm `.cmd` shim: `"%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*`.
const NPM_SHIM_LAUNCH = /"%_prog%"\s+"%dp0%[\\/]?([^"]+)"/;
const NPM_SHIM_NODE_PROGRAM = /SET "_prog=node"/i;
const NODE_SCRIPT = /\.[cm]?js$/i;

/** Resolves an npm `.cmd` shim to the node script it runs, or null for any other wrapper. */
export function resolveNpmShimScript(shimPath, readText = (path) => readFileSync(path, 'utf8')) {
  let contents;
  try {
    contents = readText(shimPath);
  } catch {
    return null;
  }
  const launch = NPM_SHIM_LAUNCH.exec(contents);
  if (!launch) return null;
  if (!NODE_SCRIPT.test(launch[1]) && !NPM_SHIM_NODE_PROGRAM.test(contents)) return null;
  return join(dirname(resolve(shimPath)), ...launch[1].split(/[\\/]+/).filter(Boolean));
}

/**
 * Turns a located executable into a spawnable command. A Windows npm shim runs its script with
 * this Node; any other `.cmd`/`.bat` goes through `cmd.exe` because Node refuses to spawn batch
 * files directly. Arguments are fixed by the probe, never operator input.
 */
export function launchSpec(executable, args, { platform = process.platform } = {}) {
  const extension = extname(executable).toLowerCase();
  if (platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    const script = resolveNpmShimScript(executable);
    if (script && isFile(script)) return { command: process.execPath, args: [script, ...args] };
    const line = [`"${executable}"`, ...args.map((arg) => (/[\s"]/.test(arg) ? `"${arg}"` : arg))].join(' ');
    return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
  }
  return { command: executable, args };
}

/** The directory of an installed npm package that provides `executable`, when there is one. */
export function npmPackageDir(executable, packageName, { platform = process.platform } = {}) {
  if (!executable) return null;
  const segments = packageName.split('/');
  if (platform === 'win32') {
    const candidate = join(dirname(executable), 'node_modules', ...segments);
    return existsSync(join(candidate, 'package.json')) ? candidate : null;
  }
  let current;
  try {
    current = dirname(realpathSync(executable));
  } catch {
    return null;
  }
  for (let depth = 0; depth < 6; depth += 1) {
    const manifest = join(current, 'package.json');
    if (isFile(manifest)) {
      try {
        if (JSON.parse(readFileSync(manifest, 'utf8')).name === packageName) return current;
      } catch {
        // Keep walking; an unreadable manifest is not this package.
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function readPackageVersion(packageDir) {
  if (!packageDir) return null;
  try {
    const version = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

function stopTree(child, platform = process.platform) {
  if (!child.pid) return;
  if (platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * Runs one command with stdin closed (or fed `input`) and a hard timeout. Never throws for a
 * failed command; the result says what happened.
 */
export function runCommand(spec, { env, cwd, timeoutMs = 60000, input } = {}) {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(spec.command, spec.args, {
        env,
        cwd,
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: Boolean(spec.verbatim),
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      resolvePromise({ exitCode: null, stdout: '', stderr: '', timedOut: false, error: String(error?.message ?? error), durationMs: 0 });
      return;
    }
    const stdout = [];
    const stderr = [];
    let size = 0;
    let timedOut = false;
    let settled = false;
    const collect = (chunks) => (chunk) => {
      size += chunk.length;
      if (size <= MAX_OUTPUT_BYTES) chunks.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child);
    }, timeoutMs);
    const finish = (exitCode, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        ...(error ? { error } : {}),
        ...(size > MAX_OUTPUT_BYTES ? { truncated: true } : {}),
        durationMs: Date.now() - startedAt,
      });
    };
    child.on('error', (error) => finish(null, String(error?.message ?? error)));
    child.on('close', (code) => finish(code));
    if (input !== undefined) child.stdin.end(input);
  });
}
