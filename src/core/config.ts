import { join } from 'node:path';
import {
  loadConfig as loadCliConfig,
  type CliRuntimeConfig,
} from '../backends/cli/config.js';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CliRuntimeConfig {
  return loadCliConfig(env);
}

export interface RuntimeResolvedPaths {
  configPath: string | null;
  dataDir: string;
  sessionBaseDir: string;
  compatibilityEvidenceDir: string;
}

export function getRuntimeResolvedPaths(
  config: Pick<CliRuntimeConfig, 'configPath' | 'dataDir' | 'sessionBaseDir'>,
): RuntimeResolvedPaths {
  const dataDir = config.dataDir || join(config.sessionBaseDir, '..', 'data');
  return {
    configPath: config.configPath || null,
    dataDir,
    sessionBaseDir: config.sessionBaseDir,
    compatibilityEvidenceDir: join(dataDir, 'compatibility'),
  };
}

export function getRuntimeListenerConfig(
  config: Pick<CliRuntimeConfig, 'host' | 'port'>,
): { host: string; port: number } {
  return {
    host: config.host || '0.0.0.0',
    port: config.port,
  };
}

export type {
  CliRuntimeConfig as RuntimeConfig,
  ProviderRuntimeConfig,
  ProviderCommandConfig,
  RunnerMode,
  RuntimeMode,
} from '../backends/cli/config.js';
