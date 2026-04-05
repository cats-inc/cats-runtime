import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { resolveConfigPath } from '../backends/cli/config.js';

export interface ConfigInspection {
  configPath: string;
  fileExists: boolean;
  parseError: string | null;
  parsedProviderCount: number;
  hasUsableTargets: boolean;
}

interface ParsedProviderEntry {
  command?: string;
  instances?: Record<string, unknown>;
}

function countProviderEntries(
  providers: unknown,
): number {
  if (!providers || typeof providers !== 'object') {
    return 0;
  }
  let count = 0;
  for (const [, value] of Object.entries(providers as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const entry = value as ParsedProviderEntry;
    if (entry.command || (entry.instances && Object.keys(entry.instances).length > 0)) {
      count += 1;
    }
  }
  return count;
}

function countRemoteEntries(
  backend: unknown,
): number {
  if (!backend || typeof backend !== 'object') {
    return 0;
  }
  let count = 0;
  for (const [, instances] of Object.entries(backend as Record<string, unknown>)) {
    if (instances && typeof instances === 'object' && Object.keys(instances).length > 0) {
      count += Object.keys(instances).length;
    }
  }
  return count;
}

function countUsableTargets(parsed: unknown): { count: number; usable: boolean } {
  if (!parsed || typeof parsed !== 'object') {
    return { count: 0, usable: false };
  }

  const root = parsed as Record<string, unknown>;
  let count = 0;

  // Legacy top-level providers
  count += countProviderEntries(root.providers);

  // New format: backends.cli.providers
  const backends = root.backends;
  if (backends && typeof backends === 'object') {
    const b = backends as Record<string, unknown>;
    const cli = b.cli;
    if (cli && typeof cli === 'object') {
      count += countProviderEntries((cli as Record<string, unknown>).providers);
    }
    // Remote backends under backends.api, backends.local, backends.agent
    for (const key of ['api', 'local', 'agent'] as const) {
      count += countRemoteEntries(b[key]);
    }
  }

  // Legacy top-level remote backends
  for (const key of ['api', 'local', 'agent'] as const) {
    count += countRemoteEntries(root[key]);
  }

  return { count, usable: count > 0 };
}

export function inspectRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConfigInspection {
  const configPath = resolveConfigPath(
    env.CATS_RUNTIME_CONFIG_PATH,
    env.HOME || env.USERPROFILE || '',
    env,
  );
  const fileExists = existsSync(configPath);

  if (!fileExists) {
    return {
      configPath,
      fileExists: false,
      parseError: null,
      parsedProviderCount: 0,
      hasUsableTargets: false,
    };
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed: unknown = parse(raw);
    const { count, usable } = countUsableTargets(parsed);
    return {
      configPath,
      fileExists: true,
      parseError: null,
      parsedProviderCount: count,
      hasUsableTargets: usable,
    };
  } catch (error) {
    return {
      configPath,
      fileExists: true,
      parseError: error instanceof Error ? error.message : String(error),
      parsedProviderCount: 0,
      hasUsableTargets: false,
    };
  }
}

export function shouldEnterBootstrapMode(
  inspection: ConfigInspection,
  forceBootstrap: boolean,
): boolean {
  if (forceBootstrap) {
    return true;
  }
  if (!inspection.fileExists) {
    return true;
  }
  if (inspection.parseError) {
    return true;
  }
  if (!inspection.hasUsableTargets) {
    return true;
  }
  return false;
}
