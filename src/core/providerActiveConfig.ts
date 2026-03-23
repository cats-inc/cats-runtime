import { existsSync, readFileSync } from 'node:fs';
import { resolveHostFilesystemPath } from '../backends/cli/hostPaths.js';
import type { ProviderTargetDescriptor } from './providerCatalog.js';

export interface ProviderActiveConfigView {
  source: 'goose_config';
  state: 'detected' | 'partial' | 'missing' | 'invalid';
  configuredPath: string;
  resolvedPath: string | null;
  provider: string | null;
  model: string | null;
  error?: string;
}

interface InspectProviderActiveConfigOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

const DEFAULT_GOOSE_CONFIG_PATH = '~/.config/goose/config.yaml';

export function inspectProviderActiveConfig(
  target: Pick<ProviderTargetDescriptor, 'providerName' | 'cliInstance'>,
  options: InspectProviderActiveConfigOptions = {},
): ProviderActiveConfigView | null {
  if (target.providerName !== 'goose' || !target.cliInstance) {
    return null;
  }

  const env = options.env || process.env;
  const configuredPath = (env.GOOSE_CONFIG_PATH || DEFAULT_GOOSE_CONFIG_PATH).trim()
    || DEFAULT_GOOSE_CONFIG_PATH;

  let resolvedPath: string;
  try {
    resolvedPath = resolveHostFilesystemPath(configuredPath, {
      runtime: target.cliInstance.commandConfig.runtime,
      label: 'Goose config path',
      platform: options.platform,
      homeDir: env.HOME || env.USERPROFILE,
    });
  } catch (error) {
    return {
      source: 'goose_config',
      state: 'invalid',
      configuredPath,
      resolvedPath: null,
      provider: null,
      model: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!existsSync(resolvedPath)) {
    return {
      source: 'goose_config',
      state: 'missing',
      configuredPath,
      resolvedPath,
      provider: null,
      model: null,
    };
  }

  try {
    const raw = readFileSync(resolvedPath, 'utf-8');
    const values = parseSimpleTopLevelConfig(raw);
    let provider = values.GOOSE_PROVIDER?.trim() || null;
    let model = values.GOOSE_MODEL?.trim() || null;

    if (model?.includes('/')) {
      provider = provider || model.split('/', 1)[0] || null;
    } else if (model && provider) {
      model = `${provider}/${model}`;
    }

    const detected = Boolean(model && provider);
    const partial = Boolean(provider || model);
    return {
      source: 'goose_config',
      state: detected ? 'detected' : partial ? 'partial' : 'missing',
      configuredPath,
      resolvedPath,
      provider,
      model,
    };
  } catch (error) {
    return {
      source: 'goose_config',
      state: 'invalid',
      configuredPath,
      resolvedPath,
      provider: null,
      model: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseSimpleTopLevelConfig(raw: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    if (!line || line[0]?.trim() === '') {
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf(':');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    if (!key) {
      continue;
    }

    values[key] = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }

  return values;
}
