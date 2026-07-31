import { spawn } from 'node:child_process';

/**
 * Windows copies the environment block into a process when it is created, and
 * never updates it afterwards. A CLI installed while this runtime is running is
 * therefore invisible to every lookup we spawn: its installer appends a new
 * directory to the user PATH in the registry, but we still hold the PATH we
 * booted with. The setup scan re-reads the registry so a freshly installed CLI
 * is found without restarting the runtime.
 *
 * The registry value is merged into the current PATH rather than replacing it.
 * Our PATH may legitimately carry entries that were never persisted — the
 * desktop host injects some into this sidecar — and dropping those would break
 * lookups that work today.
 */

const USER_ENVIRONMENT_KEY = 'HKCU\\Environment';
const MACHINE_ENVIRONMENT_KEY =
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';

const REG_QUERY_TIMEOUT_MS = 5_000;

/**
 * `reg query <key> /v Path` prints the value on its own indented line:
 *
 *     HKEY_CURRENT_USER\Environment
 *         Path    REG_EXPAND_SZ    C:\Users\me\.local\bin;C:\tools
 *
 * PATHEXT does not match: the name must be followed by whitespace.
 */
const REG_QUERY_PATH_LINE = /^[ \t]+Path[ \t]+REG_(?:EXPAND_)?SZ[ \t]+(.*)$/im;

export function parseRegQueryPathValue(stdout: string): string | null {
  const match = REG_QUERY_PATH_LINE.exec(stdout);
  if (!match) {
    return null;
  }
  const value = match[1]?.trim();
  return value ? value : null;
}

/**
 * The user PATH is usually REG_EXPAND_SZ, so it stores `%USERPROFILE%\...`
 * rather than an absolute path. Unknown placeholders are left untouched — an
 * unexpanded directory simply never matches anything, which is preferable to
 * dropping an entry we failed to understand.
 */
export function expandWindowsEnvironmentPlaceholders(
  value: string,
  env: NodeJS.ProcessEnv,
): string {
  const lookup = new Map<string, string>();
  for (const [key, entry] of Object.entries(env)) {
    if (typeof entry === 'string') {
      lookup.set(key.toLowerCase(), entry);
    }
  }
  return value.replace(/%([^%]+)%/gu, (original, name: string) => {
    const replacement = lookup.get(name.toLowerCase());
    return replacement === undefined ? original : replacement;
  });
}

export function splitWindowsPath(value: string): string[] {
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Windows paths are case-insensitive, and the registry and the live PATH
 * disagree about trailing separators often enough to matter.
 */
function normalizePathEntry(entry: string): string {
  return entry.replace(/[\\/]+$/u, '').toLowerCase();
}

export function mergePathEntries(current: string[], discovered: string[]): string[] {
  const merged = [...current];
  const seen = new Set(current.map(normalizePathEntry));
  for (const entry of discovered) {
    const key = normalizePathEntry(entry);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

async function runRegQuery(key: string, timeoutMs: number): Promise<string | null> {
  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('reg.exe', ['query', key, '/v', 'Path'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }

    let stdout = '';
    let settled = false;

    const finish = (result: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore cleanup failures; the timeout is what matters.
      }
      finish(null);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      // reg.exe writes in the console OEM code page, not UTF-8, so a PATH entry
      // containing non-ASCII characters decodes to mojibake here. That entry
      // then resolves to nothing and is simply never used — acceptable, because
      // this function only ever appends: a garbled entry cannot cost us a
      // lookup that works today.
      stdout += chunk.toString('utf8');
    });
    // stderr is drained but ignored: a missing key is a normal outcome.
    child.stderr?.on('data', () => {});
    child.once('error', () => finish(null));
    child.once('close', (code) => finish(code === 0 ? stdout : null));
  });
}

export interface RefreshWindowsProcessPathOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  /** Injectable for tests; defaults to shelling out to reg.exe. */
  readRegistryPath?: (key: string) => Promise<string | null>;
}

export interface RefreshWindowsProcessPathResult {
  refreshed: boolean;
  added: string[];
}

/**
 * Merges the persisted user and machine PATH into `env.PATH` in place. Returns
 * what was added so callers can log it. Never throws: a scan that cannot read
 * the registry must still scan with the PATH it already has.
 */
export async function refreshWindowsProcessPath(
  options: RefreshWindowsProcessPathOptions = {},
): Promise<RefreshWindowsProcessPathResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return { refreshed: false, added: [] };
  }

  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? REG_QUERY_TIMEOUT_MS;
  const readRegistryPath = options.readRegistryPath
    ?? ((key: string) => runRegQuery(key, timeoutMs));

  const [machineRaw, userRaw] = await Promise.all([
    readRegistryPath(MACHINE_ENVIRONMENT_KEY).catch(() => null),
    readRegistryPath(USER_ENVIRONMENT_KEY).catch(() => null),
  ]);

  const discovered: string[] = [];
  // Machine first, then user: the order Windows itself composes them in.
  for (const raw of [machineRaw, userRaw]) {
    if (!raw) {
      continue;
    }
    const value = parseRegQueryPathValue(raw);
    if (!value) {
      continue;
    }
    discovered.push(...splitWindowsPath(expandWindowsEnvironmentPlaceholders(value, env)));
  }

  if (discovered.length === 0) {
    return { refreshed: false, added: [] };
  }

  const current = splitWindowsPath(env.PATH ?? env.Path ?? '');
  const merged = mergePathEntries(current, discovered);
  const added = merged.slice(current.length);
  if (added.length === 0) {
    return { refreshed: false, added: [] };
  }

  // Windows env lookups are case-insensitive but Node's process.env object is
  // not, so assign through whichever key is already populated.
  const pathKey = env.PATH !== undefined ? 'PATH' : env.Path !== undefined ? 'Path' : 'PATH';
  env[pathKey] = merged.join(';');
  return { refreshed: true, added };
}
