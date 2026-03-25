import { join } from 'node:path';
import {
  loadConfig as loadCliConfig,
  type CliRuntimeConfig,
  type LoadConfigOptions,
} from '../backends/cli/config.js';

const RUNTIME_CONFIG_ENV_SYMBOL = Symbol('cats-runtime-config-env');
const RUNTIME_CONFIG_ENV = new WeakMap<CliRuntimeConfig, NodeJS.ProcessEnv>();

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): CliRuntimeConfig {
  const config = loadCliConfig(env, options);
  setRuntimeConfigEnv(config, env);
  return config;
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

export function getRuntimeConfigEnv(
  config: CliRuntimeConfig,
): Readonly<NodeJS.ProcessEnv> {
  const attached = (
    config as CliRuntimeConfig & { [RUNTIME_CONFIG_ENV_SYMBOL]?: NodeJS.ProcessEnv }
  )[RUNTIME_CONFIG_ENV_SYMBOL];
  return attached || RUNTIME_CONFIG_ENV.get(config) || process.env;
}

export function copyRuntimeConfigEnv(
  target: CliRuntimeConfig,
  source: CliRuntimeConfig | NodeJS.ProcessEnv,
): void {
  if (isRuntimeConfig(source)) {
    setRuntimeConfigEnv(target, getRuntimeConfigEnv(source));
    return;
  }

  setRuntimeConfigEnv(target, source);
}

function isRuntimeConfig(
  value: CliRuntimeConfig | NodeJS.ProcessEnv,
): value is CliRuntimeConfig {
  return 'sessionBaseDir' in value && 'providerCommands' in value;
}

function setRuntimeConfigEnv(
  target: CliRuntimeConfig,
  env: NodeJS.ProcessEnv,
): void {
  const clonedEnv = {
    ...env,
  };
  RUNTIME_CONFIG_ENV.set(target, clonedEnv);
  (
    target as CliRuntimeConfig & { [RUNTIME_CONFIG_ENV_SYMBOL]?: NodeJS.ProcessEnv }
  )[RUNTIME_CONFIG_ENV_SYMBOL] = clonedEnv;
}

export type {
  LoadConfigOptions,
  CliRuntimeConfig as RuntimeConfig,
  ProviderRuntimeConfig,
  ProviderCommandConfig,
  RunnerMode,
  RuntimeMode,
} from '../backends/cli/config.js';
