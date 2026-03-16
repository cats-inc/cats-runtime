import type { CliRuntimeConfig, ProviderInstanceConfig } from './config.js';
import { resolveProviderInstance } from './config.js';
import type { ProviderName } from './providers/types.js';
import {
  normalizeHostFilesystemPath,
  resolveHostFilesystemPath,
} from './hostPaths.js';

type FileBackedProviderName = Extract<
  ProviderName,
  'auggie' | 'claude' | 'codex' | 'copilot' | 'gemini' | 'pi'
>;

type FileBackedInstancePathField = Extract<
  keyof ProviderInstanceConfig,
  | 'auggieSessionsDir'
  | 'claudeProjectsDir'
  | 'codexSessionsDir'
  | 'copilotSessionsDir'
  | 'geminiSessionsDir'
  | 'piSessionsDir'
>;

type FileBackedConfigPathField = Extract<
  keyof CliRuntimeConfig,
  | 'auggieSessionsDir'
  | 'claudeProjectsDir'
  | 'codexSessionsDir'
  | 'copilotSessionsDir'
  | 'geminiSessionsDir'
  | 'piSessionsDir'
>;

const FILE_BACKED_PROVIDER_PATHS = {
  auggie: {
    instanceField: 'auggieSessionsDir',
    configField: 'auggieSessionsDir',
    configKey: 'sessions_dir',
  },
  claude: {
    instanceField: 'claudeProjectsDir',
    configField: 'claudeProjectsDir',
    configKey: 'projects_dir',
  },
  codex: {
    instanceField: 'codexSessionsDir',
    configField: 'codexSessionsDir',
    configKey: 'sessions_dir',
  },
  copilot: {
    instanceField: 'copilotSessionsDir',
    configField: 'copilotSessionsDir',
    configKey: 'sessions_dir',
  },
  gemini: {
    instanceField: 'geminiSessionsDir',
    configField: 'geminiSessionsDir',
    configKey: 'sessions_dir',
  },
  pi: {
    instanceField: 'piSessionsDir',
    configField: 'piSessionsDir',
    configKey: 'sessions_dir',
  },
} satisfies Record<FileBackedProviderName, {
  instanceField: FileBackedInstancePathField;
  configField: FileBackedConfigPathField;
  configKey: string;
}>;

export function resolveFileBackedProviderPath(
  config: CliRuntimeConfig,
  provider: FileBackedProviderName,
  instanceId?: string,
): string {
  const instance = resolveProviderInstance(config, provider, instanceId);
  return resolveHostFilesystemPath(
    getRawFileBackedProviderPath(config, provider, instance),
    {
      runtime: instance.commandConfig.runtime,
      label: `${provider}.instances.${instance.id}.${FILE_BACKED_PROVIDER_PATHS[provider].configKey}`,
    },
  );
}

export function normalizeFileBackedProviderPath(
  config: CliRuntimeConfig,
  provider: FileBackedProviderName,
  instanceId?: string,
): string {
  const instance = resolveProviderInstance(config, provider, instanceId);
  return normalizeHostFilesystemPath(
    getRawFileBackedProviderPath(config, provider, instance),
    {
      runtime: instance.commandConfig.runtime,
      label: `${provider}.instances.${instance.id}.${FILE_BACKED_PROVIDER_PATHS[provider].configKey}`,
    },
  );
}

function getRawFileBackedProviderPath(
  config: CliRuntimeConfig,
  provider: FileBackedProviderName,
  instance: ProviderInstanceConfig,
): string {
  const pathConfig = FILE_BACKED_PROVIDER_PATHS[provider];
  return instance[pathConfig.instanceField] || config[pathConfig.configField];
}
