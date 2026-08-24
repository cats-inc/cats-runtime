import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOUR_MS = 60 * 60 * 1000;
const PYTHON_TEMP_PREFIX = 'cats-runtime-python-';

export const DEFAULT_STALE_RUNTIME_TEMP_MAX_AGE_HOURS = 12;
export const DEFAULT_STALE_RUNTIME_TEMP_MAX_AGE_MS =
  DEFAULT_STALE_RUNTIME_TEMP_MAX_AGE_HOURS * HOUR_MS;

export const STALE_RUNTIME_TEMP_PREFIXES = [
  PYTHON_TEMP_PREFIX,
  'cats-runtime-peer-',
  'cats-runtime-agent-',
  'cats-runtime-session-',
  'cats-runtime-provider-',
  'cats-runtime-test-',
  'cats-runtime-process-',
  'cats-runtime-worktree-',
  'cats-runtime-browser-',
  'cats-runtime-branch-',
  'cats-runtime-debug-',
  'cats-runtime-health-',
  'cats-runtime-diagnostics-',
  'cats-runtime-mcp-',
  'cats-runtime-api-',
  'cats-runtime-compat-',
  'cats-runtime-delivery-',
  'cats-runtime-message-route-',
  'cats-runtime-tools-',
  'cats-runtime-path-',
  'cats-runtime-wakeup-',
  'cats-runtime-compaction-',
  'cats-runtime-hydration-',
  'cats-runtime-http-skills-',
  'cats-runtime-opencode-',
  'cats-runtime-kilo-',
  'cats-runtime-cli-prompt-',
  'cats-runtime-skill-catalog-',
  'cats-runtime-provider-evolution-',
] as const;

type RuntimeTempPrefix = typeof STALE_RUNTIME_TEMP_PREFIXES[number];

export interface CleanupStaleRuntimeTempDirsOptions {
  rootDir?: string;
  now?: Date;
  maxAgeMs?: number;
  currentPid?: number;
}

export interface RuntimeTempCleanupSummary {
  rootDir: string;
  scannedCount: number;
  candidateCount: number;
  removedCount: number;
  keptCount: number;
  removedByPrefix: Partial<Record<RuntimeTempPrefix, number>>;
  keptByReason: {
    recent: number;
    livePid: number;
    failed: number;
  };
}

export async function cleanupStaleRuntimeTempDirs(
  options: CleanupStaleRuntimeTempDirsOptions = {},
): Promise<RuntimeTempCleanupSummary> {
  const rootDir = options.rootDir ?? tmpdir();
  const nowMs = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_STALE_RUNTIME_TEMP_MAX_AGE_MS;
  const currentPid = options.currentPid ?? process.pid;
  const entries = await readdir(rootDir, { withFileTypes: true });
  const summary: RuntimeTempCleanupSummary = {
    rootDir,
    scannedCount: entries.length,
    candidateCount: 0,
    removedCount: 0,
    keptCount: 0,
    removedByPrefix: {},
    keptByReason: {
      recent: 0,
      livePid: 0,
      failed: 0,
    },
  };

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const prefix = matchRuntimeTempPrefix(entry.name);
    if (!prefix) {
      continue;
    }

    summary.candidateCount += 1;
    const entryPath = join(rootDir, entry.name);

    if (prefix === PYTHON_TEMP_PREFIX) {
      if (shouldKeepPythonTempEntry(entry.name, currentPid)) {
        summary.keptCount += 1;
        summary.keptByReason.livePid += 1;
        continue;
      }

      if (await removeRuntimeTempEntry(entryPath)) {
        summary.removedCount += 1;
        summary.removedByPrefix[prefix] = (summary.removedByPrefix[prefix] ?? 0) + 1;
      } else {
        summary.keptCount += 1;
        summary.keptByReason.failed += 1;
      }
      continue;
    }

    let entryStat;
    try {
      entryStat = await stat(entryPath);
    } catch {
      continue;
    }

    if (nowMs - entryStat.mtimeMs < maxAgeMs) {
      summary.keptCount += 1;
      summary.keptByReason.recent += 1;
      continue;
    }

    if (await removeRuntimeTempEntry(entryPath)) {
      summary.removedCount += 1;
      summary.removedByPrefix[prefix] = (summary.removedByPrefix[prefix] ?? 0) + 1;
    } else {
      summary.keptCount += 1;
      summary.keptByReason.failed += 1;
    }
  }

  return summary;
}

export function formatRuntimeTempCleanupSummary(summary: RuntimeTempCleanupSummary): string {
  const removedByPrefix = Object.entries(summary.removedByPrefix)
    .map(([prefix, count]) => `${prefix}${count}`)
    .join(', ');
  const detail = removedByPrefix ? ` [${removedByPrefix}]` : '';
  return [
    `Cleaned ${summary.removedCount} stale cats-runtime temp director`,
    summary.removedCount === 1 ? 'y' : 'ies',
    ` from ${summary.rootDir}.`,
    ` Kept ${summary.keptCount} candidate director`,
    summary.keptCount === 1 ? 'y' : 'ies',
    ` (${summary.keptByReason.recent} recent, ${summary.keptByReason.livePid} live-pid, ${summary.keptByReason.failed} failed).`,
    detail,
    '\n',
  ].join('');
}

function matchRuntimeTempPrefix(name: string): RuntimeTempPrefix | null {
  for (const prefix of STALE_RUNTIME_TEMP_PREFIXES) {
    if (name.startsWith(prefix)) {
      return prefix;
    }
  }
  return null;
}

function shouldKeepPythonTempEntry(name: string, currentPid: number): boolean {
  const pid = parsePythonTempPid(name);
  if (pid === null) {
    return false;
  }

  if (pid === currentPid) {
    return true;
  }

  return isProcessAlive(pid);
}

function parsePythonTempPid(name: string): number | null {
  const match = /^cats-runtime-python-(\d+)-/.exec(name);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

export async function removeRuntimeTempEntry(entryPath: string): Promise<boolean> {
  try {
    // Windows keeps handles open for a short window after a spawned CLI exits,
    // so an immediate rm races the provider and throws EBUSY. rm retries that
    // class of error itself with a linear backoff when given these options.
    await rm(entryPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    return true;
  } catch {
    return false;
  }
}
