import type { CliRuntimeConfig, ProviderInstanceConfig } from '../../src/backends/cli/config.js';
import type { ProviderName } from '../../src/backends/cli/providers/types.js';

/** Explicit selection for mocked execution fixtures; never probes or reads config. */
export function withSelectedCliProviders<T>(input: T): T {
  const config = input as T & CliRuntimeConfig;
  const providerInstances = { ...config.providerInstances };
  const paths = ['auggieSessionsDir', 'claudeProjectsDir', 'codexSessionsDir',
    'copilotSessionsDir', 'cursorChatsDir', 'kiroDbPath', 'kiloServerHost',
    'kiloServerPort', 'kiloServerStartupTimeoutMs', 'opencodeServerHost',
    'opencodeServerPort', 'opencodeServerStartupTimeoutMs', 'piSessionsDir',
    'clineSessionsDir', 'grokSessionsDir', 'antigravitySessionsDir'] as const;
  for (const [name, commandConfig] of Object.entries(config.providerCommands)) {
    const provider = name as ProviderName;
    if (providerInstances[provider] !== undefined) continue;
    const id = config.providerDefaultInstances?.[provider] ?? 'native';
    const instance: ProviderInstanceConfig = { id, providerName: provider, commandConfig };
    for (const key of paths) {
      if (key.startsWith(provider) && config[key] !== undefined) Object.assign(instance, { [key]: config[key] });
    }
    providerInstances[provider] = { [id]: instance };
  }
  return { ...input, providerInstances };
}
