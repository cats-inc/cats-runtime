import {
  listProviderInstances,
  type BackendKind,
  type CliRuntimeConfig,
  type ProviderDefaultTarget,
  type ProviderInstanceConfig,
  type RemoteProviderInstanceConfig,
} from '../backends/cli/config.js';
import {
  KNOWN_PROVIDERS as CLI_PROVIDER_NAMES,
  type ProviderName as CliProviderName,
} from '../backends/cli/providers/types.js';

const PROVIDER_ORDER = [
  'openclaw',
  'claude',
  'codex',
  'gemini',
  'pi',
  'goose',
  'junie',
  'ollama',
  'copilot',
  'cursor',
  'kiro',
  'auggie',
  'opencode',
] as const;

export interface ProviderTargetDescriptor {
  providerName: string;
  backend: BackendKind;
  instanceId: string;
  defaultTarget: boolean;
  cliInstance?: ProviderInstanceConfig;
  remoteInstance?: RemoteProviderInstanceConfig;
}

export interface ProviderCatalogEntry {
  defaultTarget?: ProviderDefaultTarget;
  instances: ProviderTargetDescriptor[];
}

export type ProviderTargetResolutionCode =
  | 'provider_not_configured'
  | 'multiple_targets_configured'
  | 'unknown_target'
  | 'ambiguous_instance'
  | 'unknown_instance';

export class ProviderTargetResolutionError extends Error {
  constructor(
    readonly code: ProviderTargetResolutionCode,
    message: string,
  ) {
    super(message);
    // Keep stringified route errors backward-compatible with existing "Error: ..."
    this.name = 'Error';
  }
}

export function isProviderTargetResolutionError(
  error: unknown,
): error is ProviderTargetResolutionError {
  return error instanceof ProviderTargetResolutionError;
}

function isCliProviderName(providerName: string): providerName is CliProviderName {
  return (CLI_PROVIDER_NAMES as readonly string[]).includes(providerName);
}

function preferredProviderIndex(providerName: string): number {
  const index = (PROVIDER_ORDER as readonly string[]).indexOf(providerName);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function parseQualifiedTarget(
  value: string,
): ProviderDefaultTarget | undefined {
  const separator = value.indexOf('/');
  if (separator <= 0 || separator >= value.length - 1) {
    return undefined;
  }

  const backend = value.slice(0, separator);
  const instance = value.slice(separator + 1);
  if (backend !== 'cli' && backend !== 'api' && backend !== 'local' && backend !== 'agent') {
    return undefined;
  }
  if (!instance) {
    return undefined;
  }

  return {
    backend,
    instance,
  };
}

export function getProviderDefaultTarget(
  config: Pick<
    CliRuntimeConfig,
    | 'providerDefaultTargets'
    | 'providerDefaultInstances'
    | 'providerInstances'
    | 'providerCommands'
    | 'auggieSessionsDir'
    | 'claudeProjectsDir'
    | 'codexSessionsDir'
    | 'copilotSessionsDir'
    | 'cursorChatsDir'
    | 'geminiSessionsDir'
    | 'kiroDbPath'
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
    | 'piSessionsDir'
    | 'remoteProviderCatalog'
  >,
  providerName: string,
): ProviderDefaultTarget | undefined {
  const explicit = config.providerDefaultTargets?.[providerName];
  if (explicit) {
    if (explicit.backend !== 'cli') {
      return explicit;
    }

    if (isCliProviderName(providerName)) {
      const configuredInstances = listProviderInstances(config, providerName).map((instance) => instance.id);
      if (configuredInstances.includes(explicit.instance)) {
        return explicit;
      }
    }
  }

  if (isCliProviderName(providerName)) {
    const instances = listProviderInstances(config, providerName);
    if (instances.length > 0) {
      const preferredInstanceId = config.providerDefaultInstances?.[providerName];
      const resolvedInstanceId = instances.some((instance) => instance.id === preferredInstanceId)
        ? preferredInstanceId!
        : instances[0].id;
      return {
        backend: 'cli',
        instance: resolvedInstanceId,
      };
    }
  }

  const remoteApiInstances = config.remoteProviderCatalog?.api?.[providerName];
  if (remoteApiInstances) {
    const first = Object.values(remoteApiInstances)[0];
    if (first) {
      return {
        backend: 'api',
        instance: first.id,
      };
    }
  }

  const remoteLocalInstances = config.remoteProviderCatalog?.local?.[providerName];
  if (remoteLocalInstances) {
    const first = Object.values(remoteLocalInstances)[0];
    if (first) {
      return {
        backend: 'local',
        instance: first.id,
      };
    }
  }

  const remoteAgentInstances = config.remoteProviderCatalog?.agent?.[providerName];
  if (remoteAgentInstances) {
    const first = Object.values(remoteAgentInstances)[0];
    if (first) {
      return {
        backend: 'agent',
        instance: first.id,
      };
    }
  }

  return undefined;
}

export function listConfiguredProviders(
  config: Pick<
    CliRuntimeConfig,
    | 'providerDefaultTargets'
    | 'providerInstances'
    | 'providerCommands'
    | 'providerDefaultInstances'
    | 'auggieSessionsDir'
    | 'claudeProjectsDir'
    | 'codexSessionsDir'
    | 'copilotSessionsDir'
    | 'cursorChatsDir'
    | 'geminiSessionsDir'
    | 'kiroDbPath'
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
    | 'piSessionsDir'
    | 'remoteProviderCatalog'
  >,
): string[] {
  const names = new Set<string>(Object.keys(config.providerDefaultTargets || {}));

  for (const providerName of Object.keys(config.remoteProviderCatalog?.api || {})) {
    names.add(providerName);
  }
  for (const providerName of Object.keys(config.remoteProviderCatalog?.local || {})) {
    names.add(providerName);
  }
  for (const providerName of Object.keys(config.remoteProviderCatalog?.agent || {})) {
    names.add(providerName);
  }

  for (const providerName of CLI_PROVIDER_NAMES) {
    if (listProviderInstances(config, providerName).length > 0) {
      names.add(providerName);
    }
  }

  return Array.from(names).sort((left, right) => {
    const byOrder = preferredProviderIndex(left) - preferredProviderIndex(right);
    return byOrder !== 0 ? byOrder : left.localeCompare(right);
  });
}

export function listProviderCatalog(
  config: Pick<
    CliRuntimeConfig,
    | 'providerDefaultTargets'
    | 'providerInstances'
    | 'providerCommands'
    | 'providerDefaultInstances'
    | 'auggieSessionsDir'
    | 'claudeProjectsDir'
    | 'codexSessionsDir'
    | 'copilotSessionsDir'
    | 'cursorChatsDir'
    | 'geminiSessionsDir'
    | 'kiroDbPath'
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
    | 'piSessionsDir'
    | 'remoteProviderCatalog'
  >,
): Record<string, ProviderCatalogEntry> {
  const catalog: Record<string, ProviderCatalogEntry> = {};

  for (const providerName of listConfiguredProviders(config)) {
    const defaultTarget = getProviderDefaultTarget(config, providerName);
    const instances: ProviderTargetDescriptor[] = [];

    if (isCliProviderName(providerName)) {
      for (const instance of listProviderInstances(config, providerName)) {
        instances.push({
          providerName,
          backend: 'cli',
          instanceId: instance.id,
          defaultTarget: defaultTarget?.backend === 'cli'
            && defaultTarget.instance === instance.id,
          cliInstance: instance,
        });
      }
    }

    for (const [backend, providers] of Object.entries({
      api: config.remoteProviderCatalog?.api || {},
      local: config.remoteProviderCatalog?.local || {},
      agent: config.remoteProviderCatalog?.agent || {},
    }) as Array<[Exclude<BackendKind, 'cli'>, Record<string, Record<string, RemoteProviderInstanceConfig>>]>) {
      const remoteInstances = providers[providerName];
      if (!remoteInstances) {
        continue;
      }

      for (const instance of Object.values(remoteInstances)) {
        instances.push({
          providerName,
          backend,
          instanceId: instance.id,
          defaultTarget: defaultTarget?.backend === backend
            && defaultTarget.instance === instance.id,
          remoteInstance: instance,
        });
      }
    }

    catalog[providerName] = {
      defaultTarget,
      instances: instances.sort((left, right) => {
        if (left.defaultTarget && !right.defaultTarget) return -1;
        if (!left.defaultTarget && right.defaultTarget) return 1;
        if (left.backend !== right.backend) return left.backend.localeCompare(right.backend);
        return left.instanceId.localeCompare(right.instanceId);
      }),
    };
  }

  return catalog;
}

export function resolveProviderTarget(
  config: Pick<
    CliRuntimeConfig,
    | 'providerDefaultTargets'
    | 'providerInstances'
    | 'providerCommands'
    | 'providerDefaultInstances'
    | 'auggieSessionsDir'
    | 'claudeProjectsDir'
    | 'codexSessionsDir'
    | 'copilotSessionsDir'
    | 'cursorChatsDir'
    | 'geminiSessionsDir'
    | 'kiroDbPath'
    | 'opencodeServerHost'
    | 'opencodeServerPort'
    | 'opencodeServerStartupTimeoutMs'
    | 'piSessionsDir'
    | 'remoteProviderCatalog'
  >,
  providerName: string,
  requestedInstance?: string,
): ProviderTargetDescriptor {
  const providerCatalog = listProviderCatalog(config)[providerName];
  if (!providerCatalog || providerCatalog.instances.length === 0) {
    throw new ProviderTargetResolutionError(
      'provider_not_configured',
      `Provider '${providerName}' is not configured`,
    );
  }

  if (!requestedInstance || requestedInstance === 'default') {
    const defaultTarget = providerCatalog.defaultTarget;
    if (defaultTarget) {
      const matched = providerCatalog.instances.find((instance) =>
        instance.backend === defaultTarget.backend && instance.instanceId === defaultTarget.instance,
      );
      if (matched) {
        return matched;
      }
    }

    if (providerCatalog.instances.length === 1) {
      return providerCatalog.instances[0];
    }

    throw new ProviderTargetResolutionError(
      'multiple_targets_configured',
      `Provider '${providerName}' has multiple backend targets configured. `
      + `Specify instance as '<backend>/<instance>' or choose one of: `
      + providerCatalog.instances.map((instance) => `${instance.backend}/${instance.instanceId}`).join(', '),
    );
  }

  const qualified = parseQualifiedTarget(requestedInstance);
  if (qualified) {
    const matched = providerCatalog.instances.find((instance) =>
      instance.backend === qualified.backend && instance.instanceId === qualified.instance,
    );
    if (!matched) {
      throw new ProviderTargetResolutionError(
        'unknown_target',
        `Unknown ${providerName} target '${requestedInstance}'. Valid: `
        + providerCatalog.instances.map((instance) => `${instance.backend}/${instance.instanceId}`).join(', '),
      );
    }
    return matched;
  }

  const bareMatches = providerCatalog.instances.filter((instance) =>
    instance.instanceId === requestedInstance,
  );
  if (bareMatches.length === 1) {
    return bareMatches[0];
  }
  if (bareMatches.length > 1) {
    throw new ProviderTargetResolutionError(
      'ambiguous_instance',
      `Ambiguous ${providerName} instance '${requestedInstance}'. Use one of: `
      + bareMatches.map((instance) => `${instance.backend}/${instance.instanceId}`).join(', '),
    );
  }

  throw new ProviderTargetResolutionError(
    'unknown_instance',
    `Unknown ${providerName} instance '${requestedInstance}'. Valid: `
    + providerCatalog.instances.map((instance) => `${instance.backend}/${instance.instanceId}`).join(', '),
  );
}
