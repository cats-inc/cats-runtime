import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

/**
 * Resolve Cursor's Windows `cursor-agent.cmd` launcher to the node invocation
 * it would have run, so the runtime spawns that directly instead of going
 * through `cmd.exe` and Windows PowerShell 5.1.
 *
 * The installer puts two layers on PATH. `cursor-agent.cmd` runs
 * `cursor-agent.ps1` beside it with `powershell.exe -File`, and the script
 * picks the newest `versions\<version>\` directory and does
 * `& node.exe index.js $args` from there.
 *
 * Both layers break the prompt Cursor takes as an argument. `cmd.exe` ends an
 * argument at its first newline, so a multi-line prompt reached Cursor as just
 * `Instructions:`; Windows PowerShell 5.1 does not escape embedded quotes when
 * it calls a native program, so a quoted word splits the prompt apart. Neither
 * can be quoted around, which is why this resolver exists. It also removes the
 * console handoff that makes Windows Terminal flash a window on every launch;
 * see `windowsNodeShim.ts`.
 *
 * The parse is deliberately narrow. Anything that does not look like the
 * launcher the installer writes, or has no version directory holding both
 * `node.exe` and `index.js`, returns `null` and the caller keeps its existing
 * path.
 */

export interface WindowsCursorLauncherTarget {
  /** The node executable the launcher would have run. */
  command: string;
  /** Leading arguments -- the `index.js` the launcher passes to node. */
  args: string[];
  /** Environment the launcher would have set for node. */
  env: Record<string, string>;
}

/**
 * The line the installer writes into `cursor-agent.cmd`:
 *
 *     %SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile
 *       -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\cursor-agent.ps1" %*
 *
 * Only the `-File "%SCRIPT_DIR%\<script>"` part identifies it.
 */
const CURSOR_SHIM_LAUNCH = /-File\s+"%SCRIPT_DIR%\\([^"\\/]+\.ps1)"/iu;

/** The version directory names `cursor-agent.ps1` accepts. */
const CURSOR_VERSION_DIR = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/u;

const CURSOR_SHIM_EXTENSIONS = ['.cmd', '.bat'];

export function resolveWindowsCursorLauncher(commandPath: string): WindowsCursorLauncherTarget | null {
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

  const launch = CURSOR_SHIM_LAUNCH.exec(contents);
  if (!launch) {
    return null;
  }

  const shimDir = dirname(resolve(shimPath));
  if (!isExistingFile(join(shimDir, launch[1]))) {
    return null;
  }

  // The script runs a node.exe beside itself when there is one, and otherwise
  // the newest version directory's.
  const runDir = isExistingFile(join(shimDir, 'node.exe'))
    ? shimDir
    : findLatestVersionDir(join(shimDir, 'versions'));
  if (!runDir) {
    return null;
  }

  const command = join(runDir, 'node.exe');
  const script = join(runDir, 'index.js');
  if (!isExistingFile(command) || !isExistingFile(script)) {
    return null;
  }

  // `cursor-agent.cmd` records its own name (`%~nx0`), and the script enables
  // node's compile cache unless one is already configured.
  const env: Record<string, string> = { CURSOR_INVOKED_AS: basename(shimPath) };
  if (!process.env.NODE_COMPILE_CACHE && process.env.LOCALAPPDATA) {
    env.NODE_COMPILE_CACHE = join(process.env.LOCALAPPDATA, 'cursor-compile-cache');
  }

  return { command, args: [script], env };
}

/**
 * The newest version directory by the date in its name, as the script orders
 * them. Builds from the same day go by their `-HH-MM-SS` timestamp, and a
 * legacy name without one counts as the oldest.
 */
function findLatestVersionDir(versionsDir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return null;
  }

  const ranked = entries
    .map((name) => ({ name, match: CURSOR_VERSION_DIR.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .map(({ name, match }) => ({
      name,
      date: Number(`${match[1]}${match[2].padStart(2, '0')}${match[3].padStart(2, '0')}`),
      time: match[4] ?? '',
    }))
    .sort((left, right) => right.date - left.date || right.time.localeCompare(left.time));

  return ranked.length > 0 ? join(versionsDir, ranked[0].name) : null;
}

/**
 * A configured provider path can be extensionless (`...\cursor-agent\cursor-agent`),
 * which is what `cmd.exe` would have resolved through `PATHEXT`. Do that here
 * against siblings of the configured path only.
 */
function findShimFile(commandPath: string): string | null {
  const extension = extname(commandPath).toLowerCase();
  if (extension) {
    return CURSOR_SHIM_EXTENSIONS.includes(extension) && isExistingFile(commandPath)
      ? commandPath
      : null;
  }

  for (const candidate of CURSOR_SHIM_EXTENSIONS) {
    const withExtension = `${commandPath}${candidate}`;
    if (isExistingFile(withExtension)) {
      return withExtension;
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
