import type { ProviderInstanceConfig } from '../config.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';
import {
  runSpawnedCommand,
  type RuntimeCheckCommandResult,
} from '../../../core/provider-install/ProviderInstallCheckRunner.js';

const DEFAULT_CURSOR_MODEL_DISCOVERY_TIMEOUT_MS = 20_000;
const ANSI_ESCAPE_RE = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

export interface CursorModelCatalogEntry {
  id: string;
  label: string;
  default?: boolean;
}

export interface CursorModelDiscoveryRunner {
  run(
    instance: ProviderInstanceConfig,
    args: string[],
    cwd: string,
  ): Promise<RuntimeCheckCommandResult>;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

function firstNonEmptyLine(text: string): string {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

function dedupeCursorModelEntries(
  entries: CursorModelCatalogEntry[],
): CursorModelCatalogEntry[] {
  const deduped = new Map<string, CursorModelCatalogEntry>();

  for (const entry of entries) {
    const id = entry.id.trim();
    if (!id) {
      continue;
    }

    const existing = deduped.get(id);
    if (!existing) {
      deduped.set(id, {
        id,
        label: entry.label.trim() || id,
        ...(entry.default === true ? { default: true } : {}),
      });
      continue;
    }

    if (!existing.label && entry.label) {
      existing.label = entry.label.trim() || id;
    }
    if (entry.default === true) {
      existing.default = true;
    }
  }

  return Array.from(deduped.values());
}

function parseCursorModelListLine(line: string): CursorModelCatalogEntry | null {
  const match = line.match(/^([A-Za-z0-9._-]+)\s+-\s+(.+)$/);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  let label = match[2].trim();
  let isDefault = false;

  while (true) {
    const marker = label.match(/\s+\((default|current)\)\s*$/i);
    if (!marker?.[1]) {
      break;
    }
    if (marker[1].toLowerCase() === 'default') {
      isDefault = true;
    }
    label = label.slice(0, marker.index).trim();
  }

  return {
    id: match[1],
    label: label || match[1],
    ...(isDefault ? { default: true } : {}),
  };
}

export function parseCursorModelListOutput(stdout: string): CursorModelCatalogEntry[] {
  const parsed: CursorModelCatalogEntry[] = [];

  for (const rawLine of stripAnsi(stdout).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (
      !line
      || /^loading models/i.test(line)
      || /^available models$/i.test(line)
      || /^tip:/i.test(line)
    ) {
      continue;
    }

    const parsedLine = parseCursorModelListLine(line);
    if (parsedLine) {
      parsed.push(parsedLine);
    }
  }

  return dedupeCursorModelEntries(parsed);
}

export const defaultCursorModelDiscoveryRunner: CursorModelDiscoveryRunner = {
  async run(
    instance: ProviderInstanceConfig,
    args: string[],
    cwd: string,
  ): Promise<RuntimeCheckCommandResult> {
    const spawnConfig = buildProcessSpawnConfig(
      instance.commandConfig,
      instance.providerName,
      args,
      cwd,
    );

    return runSpawnedCommand(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd,
      env: spawnConfig.env,
      shell: spawnConfig.shell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeoutMs: DEFAULT_CURSOR_MODEL_DISCOVERY_TIMEOUT_MS,
    });
  },
};

export async function discoverCursorModels(
  instance: ProviderInstanceConfig,
  options: {
    cwd: string;
    runner?: CursorModelDiscoveryRunner;
  },
): Promise<CursorModelCatalogEntry[]> {
  const runner = options.runner || defaultCursorModelDiscoveryRunner;
  const result = await runner.run(instance, ['--list-models'], options.cwd);

  if (result.timedOut) {
    throw new Error('`cursor-agent --list-models` timed out.');
  }
  if ((result.exitCode ?? 1) !== 0) {
    const detail = firstNonEmptyLine(result.stderr)
      || firstNonEmptyLine(result.stdout)
      || result.error
      || '';
    throw new Error(
      detail
        ? `\`cursor-agent --list-models\` failed: ${detail}`
        : '`cursor-agent --list-models` failed.',
    );
  }

  return parseCursorModelListOutput(result.stdout);
}
