import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

/**
 * Resolve Meta Muse's Windows `muse.cmd` launcher to the agent binary it would
 * have run, so the runtime spawns that directly instead of going through
 * `cmd.exe` and Windows PowerShell 5.1.
 *
 * What the muse installer places on PATH is not the agent. `muse.cmd` is a
 * one-line shim that runs `.muse-launcher.ps1` beside it; the launcher checks
 * for updates, records the active build in `.muse-version`, and finally does
 * `& $binary @args` against `muse-bin-<version>.exe` in the same directory.
 *
 * Going through that chain from the runtime has the same cost as an npm shim
 * had before `windowsNodeShim.ts`: the packaged desktop host is a GUI process
 * with no console, so spawning `cmd.exe` hands a console to the default
 * terminal app and Windows Terminal flashes a window on every provider launch.
 * It also adds the launcher's own startup to every spawn -- measured at ~4s on
 * 1.0.3 for a bare `--version` -- and puts PowerShell in the stdout path.
 *
 * Bypassing it means the runtime does not trigger the launcher's background
 * update check. That is the one behaviour lost, and it is a fair trade: the
 * user's own `muse` runs still update, and drift is reported rather than gated
 * (ADR-035). The one thing the launcher hands the binary is
 * `MUSE_RELEASE_INFO`, read from `.muse-release-info.json`; that is mirrored so
 * the binary sees exactly what it would have seen.
 *
 * The parse is deliberately narrow. Anything that does not look exactly like
 * the shim the installer writes, or that has no recorded version with a
 * matching binary beside it, returns `null` and the caller keeps its existing
 * path -- which is also what a half-finished install (launcher present, binary
 * not yet downloaded) falls back to.
 */

export interface WindowsMuseLauncherTarget {
  /** The agent binary the launcher would have run. */
  command: string;
  /** Environment the launcher would have set for the binary. */
  env?: Record<string, string>;
}

/**
 * The line the installer writes into `muse.cmd`:
 *
 *     "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile
 *       -ExecutionPolicy Bypass -File "%~dp0.muse-launcher.ps1" %*
 *
 * Only the `-File "%~dp0<launcher>"` part identifies it; the rest is not
 * load-bearing and is left unchecked so a reordered flag does not break it.
 */
const MUSE_SHIM_LAUNCH = /-File\s+"%~dp0([^"\\/]+\.ps1)"/iu;

const MUSE_VERSION_FILE = '.muse-version';
const MUSE_RELEASE_INFO_FILE = '.muse-release-info.json';
const MUSE_SHIM_EXTENSIONS = ['.cmd', '.bat'];

export function resolveWindowsMuseLauncher(commandPath: string): WindowsMuseLauncherTarget | null {
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

  const launch = MUSE_SHIM_LAUNCH.exec(contents);
  if (!launch) {
    return null;
  }

  const shimDir = dirname(resolve(shimPath));
  if (!isExistingFile(join(shimDir, launch[1]))) {
    return null;
  }

  // The version is read, never asked for: running the launcher to find out
  // what it would run is the round trip this resolver exists to avoid, and a
  // flag the binary does not know opens the interactive TUI instead of failing.
  const version = readTrimmed(join(shimDir, MUSE_VERSION_FILE));
  if (!version || /[\\/]/u.test(version)) {
    return null;
  }

  const binary = join(shimDir, `muse-bin-${version}.exe`);
  if (!isExistingFile(binary)) {
    return null;
  }

  const releaseInfo = readTrimmed(join(shimDir, MUSE_RELEASE_INFO_FILE));
  return {
    command: binary,
    ...(releaseInfo ? { env: { MUSE_RELEASE_INFO: releaseInfo } } : {}),
  };
}

/**
 * A configured provider path can be extensionless (`...\Programs\muse\muse`),
 * which is what `cmd.exe` would have resolved through `PATHEXT`. Do that here
 * against siblings of the configured path only; a bare command name is left to
 * the caller's own PATH resolution.
 */
function findShimFile(commandPath: string): string | null {
  const extension = extname(commandPath).toLowerCase();
  if (extension) {
    return MUSE_SHIM_EXTENSIONS.includes(extension) && isExistingFile(commandPath)
      ? commandPath
      : null;
  }

  for (const candidate of MUSE_SHIM_EXTENSIONS) {
    const withExtension = `${commandPath}${candidate}`;
    if (isExistingFile(withExtension)) {
      return withExtension;
    }
  }
  return null;
}

function readTrimmed(filePath: string): string | null {
  try {
    const value = readFileSync(filePath, 'utf-8').trim();
    return value || null;
  } catch {
    return null;
  }
}

function isExistingFile(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}
