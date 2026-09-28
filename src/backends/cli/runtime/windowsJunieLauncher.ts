import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/**
 * Resolve JetBrains' Windows `junie.bat` shim to the `junie.exe` it would have
 * run, so the runtime spawns that directly instead of going through `cmd.exe`.
 *
 * Going through `cmd.exe` rewrites arguments -- it once cut a multi-line prompt,
 * which Junie now reads from stdin, down to `Instructions:` -- so skipping the
 * shim keeps them verbatim. It also removes the console handoff that makes
 * Windows Terminal flash a window on every launch; see `windowsNodeShim.ts`.
 *
 * Bypassing it means a Cats launch does not apply an update Junie has staged
 * under `updates\`. Cats already starts Junie with `--skip-update-check`
 * (`providerProcessPolicy.ts`), so updates belong to the user's own `junie`
 * runs, which still apply them. What the shim hands the binary on its normal
 * path -- `EJ_RUNNER_PWD`, `JUNIE_DATA` and `JUNIE_SHIM_PATH` -- is mirrored.
 *
 * The parse is deliberately narrow. Anything without the shim's
 * `JUNIE_MANAGED_SHIM` marker, or without a recorded version whose binary
 * exists, returns `null` and the caller keeps its existing path.
 */

export interface WindowsJunieLauncherTarget {
  /** The binary the shim would have run. */
  command: string;
  /** Environment the shim would have set for the binary. */
  env: Record<string, string>;
}

/** The marker line the installer writes near the top of `junie.bat`. */
const JUNIE_SHIM_MARKER = /^::\s*JUNIE_MANAGED_SHIM\s*$/mu;

const JUNIE_SHIM_EXTENSIONS = ['.bat', '.cmd'];

export function resolveWindowsJunieLauncher(
  commandPath: string,
  cwd: string,
): WindowsJunieLauncherTarget | null {
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
  if (!JUNIE_SHIM_MARKER.test(contents)) {
    return null;
  }

  // The shim ignores an inherited JUNIE_DATA; only JUNIE_DATA_DIR moves it.
  const home = process.env.USERPROFILE;
  const junieData = process.env.JUNIE_DATA_DIR
    || (home ? join(home, '.local', 'share', 'junie') : null);
  if (!junieData) {
    return null;
  }

  // Same order as the shim: JUNIE_VERSION, then the `current` pointer file.
  const version = process.env.JUNIE_VERSION?.trim() || readFirstLine(join(junieData, 'current'));
  if (!version || /[\\/]|^\.\.?$/u.test(version)) {
    return null;
  }

  const binary = join(junieData, 'versions', version, 'junie', 'junie.exe');
  if (!isExistingFile(binary)) {
    return null;
  }

  return {
    command: binary,
    env: {
      EJ_RUNNER_PWD: cwd,
      JUNIE_DATA: junieData,
      JUNIE_SHIM_PATH: resolve(shimPath),
    },
  };
}

/**
 * A configured provider path can be extensionless (`...\.local\bin\junie`),
 * which is what `cmd.exe` would have resolved through `PATHEXT`. Do that here
 * against siblings of the configured path only.
 */
function findShimFile(commandPath: string): string | null {
  const extension = extname(commandPath).toLowerCase();
  if (extension) {
    return JUNIE_SHIM_EXTENSIONS.includes(extension) && isExistingFile(commandPath)
      ? commandPath
      : null;
  }

  for (const candidate of JUNIE_SHIM_EXTENSIONS) {
    const withExtension = `${commandPath}${candidate}`;
    if (isExistingFile(withExtension)) {
      return withExtension;
    }
  }
  return null;
}

/** `set /p` reads the first line of the pointer file. */
function readFirstLine(filePath: string): string | null {
  try {
    const value = readFileSync(filePath, 'utf-8').split(/\r?\n/u, 1)[0].trim();
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
