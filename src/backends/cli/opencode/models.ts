import type { ProviderInstanceConfig } from '../config.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';
import {
  runSpawnedCommand,
  type RuntimeCheckCommandResult,
} from '../../../core/provider-install/ProviderInstallCheckRunner.js';

const DEFAULT_OPENCODE_MODEL_DISCOVERY_TIMEOUT_MS = 20_000;

export interface OpencodeModelCatalogEntry {
  id: string;
  label: string;
}

export interface OpencodeModelDiscoveryRunner {
  run(
    instance: ProviderInstanceConfig,
    args: string[],
    cwd: string,
  ): Promise<RuntimeCheckCommandResult>;
}

function firstNonEmptyLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

function compareOpencodeModelEntries(
  left: OpencodeModelCatalogEntry,
  right: OpencodeModelCatalogEntry,
): number {
  return left.id.localeCompare(right.id, 'en', { numeric: true, sensitivity: 'base' });
}

function dedupeOpencodeModelEntries(
  entries: OpencodeModelCatalogEntry[],
): OpencodeModelCatalogEntry[] {
  const seen = new Set<string>();
  const deduped: OpencodeModelCatalogEntry[] = [];

  for (const entry of entries) {
    const id = entry.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    deduped.push({
      id,
      label: entry.label.trim() || id,
    });
  }

  return deduped.sort(compareOpencodeModelEntries);
}

function parseOpencodeModelToken(token: string): OpencodeModelCatalogEntry | null {
  const match = token.match(/([A-Za-z0-9._-]+\/[^\s]+)/);
  if (!match?.[1] || match[1].toLowerCase() === 'provider/model') {
    return null;
  }

  return {
    id: match[1],
    label: match[1],
  };
}

export function parseOpencodeModelListOutput(stdout: string): OpencodeModelCatalogEntry[] {
  const parsed: OpencodeModelCatalogEntry[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const directToken = parseOpencodeModelToken(line);
    if (directToken) {
      parsed.push(directToken);
      continue;
    }

    const columns = line
      .split(/\s{2,}/)
      .map((value) => value.trim())
      .filter(Boolean);

    for (const column of columns) {
      const columnToken = parseOpencodeModelToken(column);
      if (columnToken) {
        parsed.push(columnToken);
        break;
      }
    }
  }

  return dedupeOpencodeModelEntries(parsed);
}

export const defaultOpencodeModelDiscoveryRunner: OpencodeModelDiscoveryRunner = {
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
      windowsVerbatimArguments: spawnConfig.windowsVerbatimArguments,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeoutMs: DEFAULT_OPENCODE_MODEL_DISCOVERY_TIMEOUT_MS,
    });
  },
};

export async function discoverOpencodeModels(
  instance: ProviderInstanceConfig,
  options: {
    cwd: string;
    refresh?: boolean;
    runner?: OpencodeModelDiscoveryRunner;
  },
): Promise<OpencodeModelCatalogEntry[]> {
  const runner = options.runner || defaultOpencodeModelDiscoveryRunner;
  const args = ['models', ...(options.refresh ? ['--refresh'] : [])];
  const result = await runner.run(instance, args, options.cwd);

  if (result.timedOut) {
    throw new Error('`opencode models` timed out.');
  }
  if ((result.exitCode ?? 1) !== 0) {
    const detail = firstNonEmptyLine(result.stderr)
      || firstNonEmptyLine(result.stdout)
      || result.error
      || '';
    throw new Error(detail ? `\`opencode models\` failed: ${detail}` : '`opencode models` failed.');
  }

  return parseOpencodeModelListOutput(result.stdout);
}
