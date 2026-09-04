import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';

/**
 * Resolve an npm-style Windows `.cmd` shim to the node invocation it performs,
 * so the runtime can spawn that directly instead of going through `cmd.exe`.
 *
 * Why this exists: the runtime runs inside the packaged desktop host, which is
 * a GUI process with no console of its own. Spawning `cmd.exe` from there
 * creates a console, and on Windows 11 the console is handed off to whichever
 * app is set as the default terminal. Windows Terminal -- the default when the
 * setting is left on "Let Windows decide" -- opens a real window for that
 * handoff and does not honour the `CREATE_NO_WINDOW` flag that
 * `windowsHide: true` sets, so a terminal window flashes up on every provider
 * launch. Providers whose command resolves to a real `.exe` are spawned
 * directly and never do this; only the ones behind an npm shim were affected.
 *
 * Bypassing the shim also takes `cmd.exe` out of the argument path, so
 * arguments carrying quotes -- `-c model="gpt-5.6-sol"` and friends -- no
 * longer have to survive cmd's quote stripping.
 *
 * The parse is deliberately narrow. Anything that does not look exactly like
 * the shim npm writes returns `null` and the caller keeps the cmd proxy.
 */

export interface WindowsNodeShimTarget {
  /** The node executable the shim would have run. */
  command: string;
  /** Leading arguments -- the script path the shim passes to node. */
  args: string[];
}

/**
 * The tail of an npm `.cmd` shim, e.g.
 *
 *     ... & "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
 *
 * `%dp0%` already ends in a separator, so the shim's own `\` after it is
 * optional here rather than required.
 */
const NPM_SHIM_LAUNCH = /"%_prog%"\s+"%dp0%[\\/]?([^"]+\.[cm]?js)"/u;

/** Shims npm may have written; `.bat` is what much older npm versions emit. */
const SHIM_EXTENSIONS = ['.cmd', '.bat'];

export function resolveWindowsNodeShim(commandPath: string): WindowsNodeShimTarget | null {
  const shimPath = findShimFile(commandPath);
  if (!shimPath) {
    return null;
  }

  let contents: string;
  try {
    contents = readFileSync(shimPath, 'utf-8');
  } catch {
    return null;
  }

  const launch = NPM_SHIM_LAUNCH.exec(contents);
  if (!launch) {
    return null;
  }

  const shimDir = dirname(resolve(shimPath));
  // The shim spells its script path with backslashes. `join` only reads those
  // as separators on Windows, so normalize before joining -- otherwise the
  // whole thing is taken for one filename and never resolves.
  const script = join(shimDir, ...launch[1].split(/[\\/]+/u).filter(Boolean));
  if (!isExistingFile(script)) {
    return null;
  }

  const nodeCommand = resolveNodeForShim(shimDir);
  if (!nodeCommand) {
    return null;
  }

  return { command: nodeCommand, args: [script] };
}

/**
 * A configured provider path can be extensionless (`...\.npm-global\codex`),
 * which is what `cmd.exe` would have resolved through `PATHEXT`. Do that
 * resolution here instead, but only against siblings of the configured path --
 * a bare command name is left to the caller's own PATH resolution.
 */
function findShimFile(commandPath: string): string | null {
  const extension = extname(commandPath).toLowerCase();
  if (extension) {
    return SHIM_EXTENSIONS.includes(extension) && isExistingFile(commandPath)
      ? commandPath
      : null;
  }

  for (const candidate of SHIM_EXTENSIONS) {
    const withExtension = `${commandPath}${candidate}`;
    if (isExistingFile(withExtension)) {
      return withExtension;
    }
  }
  return null;
}

/**
 * npm's shim prefers a `node.exe` sitting beside it and otherwise falls back to
 * `node` on PATH. Mirror that, but resolve the PATH case to a real file: the
 * caller spawns without a shell, so an unresolvable `node` would fail at spawn
 * time rather than fall back to anything.
 */
function resolveNodeForShim(shimDir: string): string | null {
  const bundled = join(shimDir, 'node.exe');
  if (isExistingFile(bundled)) {
    return bundled;
  }

  for (const dir of (process.env.PATH || '').split(delimiter)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const candidate = isAbsolute(trimmed)
      ? join(trimmed, 'node.exe')
      : join(resolve(trimmed), 'node.exe');
    if (isExistingFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isExistingFile(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}
