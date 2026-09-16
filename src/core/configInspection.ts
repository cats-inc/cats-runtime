import { existsSync } from 'node:fs';
import { loadConfig, resolveConfigPath } from '../backends/cli/config.js';
import { listProviderCatalog } from './providerCatalog.js';

export interface ConfigInspection {
  configPath: string;
  fileExists: boolean;
  parseError: string | null;
  parsedProviderCount: number;
  hasUsableTargets: boolean;
}

export function inspectRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ConfigInspection {
  const configPath = resolveConfigPath(env.HOME || env.USERPROFILE || '', env);
  const result: ConfigInspection = {
    configPath, fileExists: existsSync(configPath), parseError: null,
    parsedProviderCount: 0, hasUsableTargets: false,
  };
  if (!result.fileExists) return result;
  try {
    const catalog = listProviderCatalog(loadConfig(env));
    result.parsedProviderCount = Object.keys(catalog).length;
    result.hasUsableTargets = Object.values(catalog).some((provider) => provider.instances.length > 0);
  } catch {
    result.parseError = 'Invalid provider configuration';
  }
  return result;
}

export function shouldEnterBootstrapMode(inspection: ConfigInspection, forceBootstrap: boolean): boolean {
  // A deliberately empty, valid YAML is a configured idle runtime.
  return forceBootstrap || !inspection.fileExists || inspection.parseError !== null;
}
