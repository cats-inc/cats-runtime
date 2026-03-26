import type { ProviderInstanceConfig } from '../config.js';
import { buildProcessSpawnConfig } from '../runtime/runtime.js';
import {
  runSpawnedCommand,
  type RuntimeCheckCommandResult,
} from '../../../core/provider-install/ProviderInstallCheckRunner.js';
import { parsePiModel } from './parser.js';

const DEFAULT_PI_MODEL_DISCOVERY_TIMEOUT_MS = 20_000;

export interface PiModelCatalogEntry {
  id: string;
  label: string;
}

export interface PiModelDiscoveryRunner {
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

function comparePiModelEntries(left: PiModelCatalogEntry, right: PiModelCatalogEntry): number {
  return left.id.localeCompare(right.id, 'en', { numeric: true, sensitivity: 'base' });
}

function dedupePiModelEntries(entries: PiModelCatalogEntry[]): PiModelCatalogEntry[] {
  const seen = new Set<string>();
  const deduped: PiModelCatalogEntry[] = [];

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

  return deduped.sort(comparePiModelEntries);
}

function parsePiModelToken(token: string): PiModelCatalogEntry | null {
  try {
    const parsed = parsePiModel(token);
    const id = `${parsed.provider}/${parsed.modelId}`;
    return { id, label: id };
  } catch {
    return null;
  }
}

export function parsePiModelListOutput(stdout: string): PiModelCatalogEntry[] {
  const parsed: PiModelCatalogEntry[] = [];
  const lines = stdout.split(/\r?\n/);

  let startIndex = 0;
  if (lines.length > 0) {
    const firstLine = lines[0]?.trim().toLowerCase() || '';
    if (firstLine.includes('provider') && firstLine.includes('model')) {
      startIndex = 1;
    }
  }

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]?.trim() || '';
    if (!line) {
      continue;
    }

    const directToken = parsePiModelToken(line);
    if (directToken) {
      parsed.push(directToken);
      continue;
    }

    const parts = line
      .split(/\s{2,}/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    const provider = parts[0];
    const modelId = parts[1];
    if (!provider || !modelId) {
      continue;
    }
    if (provider.toLowerCase() === 'provider' && modelId.toLowerCase() === 'model') {
      continue;
    }

    parsed.push({
      id: `${provider}/${modelId}`,
      label: `${provider}/${modelId}`,
    });
  }

  return dedupePiModelEntries(parsed);
}

export const defaultPiModelDiscoveryRunner: PiModelDiscoveryRunner = {
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
      timeoutMs: DEFAULT_PI_MODEL_DISCOVERY_TIMEOUT_MS,
    });
  },
};

export async function discoverPiModels(
  instance: ProviderInstanceConfig,
  options: {
    cwd: string;
    runner?: PiModelDiscoveryRunner;
  },
): Promise<PiModelCatalogEntry[]> {
  const runner = options.runner || defaultPiModelDiscoveryRunner;
  const result = await runner.run(instance, ['--list-models'], options.cwd);

  if (result.timedOut) {
    throw new Error('`pi --list-models` timed out.');
  }
  if ((result.exitCode ?? 1) !== 0) {
    const detail = firstNonEmptyLine(result.stderr)
      || firstNonEmptyLine(result.stdout)
      || result.error
      || '';
    throw new Error(detail ? `\`pi --list-models\` failed: ${detail}` : '`pi --list-models` failed.');
  }

  return parsePiModelListOutput(result.stdout);
}
