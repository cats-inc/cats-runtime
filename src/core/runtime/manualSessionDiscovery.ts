import {
  listProviderInstances,
  type CliRuntimeConfig,
} from '../../backends/cli/config.js';
import type { SessionRegistry } from '../../backends/cli/pool/SessionRegistry.js';
import {
  syncNativeSessions,
  type NativeSessionSummary,
} from '../../backends/cli/discovery/nativeDiscovery.js';
import { listConfiguredProviders } from '../providerCatalog.js';

const MANUAL_SESSION_DISCOVERY_PROVIDERS = [
  'cursor',
  'goose',
  'kiro',
  'opencode',
  'kilo',
] as const;

export type ManualSessionDiscoveryProviderName =
  typeof MANUAL_SESSION_DISCOVERY_PROVIDERS[number];

export interface ManualSessionDiscoveryTarget {
  provider: ManualSessionDiscoveryProviderName;
  instanceId: string;
  runtime: {
    mode: 'wsl' | 'docker';
    distro?: string;
    container?: string;
  };
}

export interface ManualSessionDiscoveryTargetResult {
  provider: ManualSessionDiscoveryProviderName;
  instanceId: string;
  runtime: ManualSessionDiscoveryTarget['runtime'];
  status: 'scanned' | 'failed';
  discoveredCount: number;
  importedCount: number;
  syncedCount: number;
  message: string;
}

export interface ManualSessionDiscoverySummary {
  status: 'idle' | 'completed' | 'completed_with_errors' | 'failed';
  totalTargets: number;
  scannedTargets: number;
  failedTargets: number;
  discoveredCount: number;
  importedCount: number;
  syncedCount: number;
}

export interface ManualSessionDiscoveryResult {
  summary: ManualSessionDiscoverySummary;
  targets: ManualSessionDiscoveryTargetResult[];
}

export interface ManualSessionDiscoveryRunner {
  listSessions(target: ManualSessionDiscoveryTarget): Promise<NativeSessionSummary[]>;
}

type ManualSessionDiscoveryConfig = Pick<
  CliRuntimeConfig,
  | 'providerDefaultTargets'
  | 'providerCommands'
  | 'providerDefaultInstances'
  | 'providerInstances'
  | 'auggieSessionsDir'
  | 'claudeProjectsDir'
  | 'codexSessionsDir'
  | 'copilotSessionsDir'
  | 'cursorChatsDir'
  | 'kiroDbPath'
  | 'kiloServerHost'
  | 'kiloServerPort'
  | 'kiloServerStartupTimeoutMs'
  | 'opencodeServerHost'
  | 'opencodeServerPort'
  | 'opencodeServerStartupTimeoutMs'
  | 'piSessionsDir'
  | 'remoteProviderCatalog'
>;

export function listManualSessionDiscoveryTargets(
  config: ManualSessionDiscoveryConfig,
): ManualSessionDiscoveryTarget[] {
  const configuredProviders = new Set(listConfiguredProviders(config));
  return MANUAL_SESSION_DISCOVERY_PROVIDERS
    .filter((provider) => configuredProviders.has(provider))
    .flatMap((provider) => (
      listProviderInstances(config, provider).flatMap((instance) => {
        const mode = instance.commandConfig.runtime.mode;
        if (mode !== 'wsl' && mode !== 'docker') {
          return [];
        }

        return [{
          provider,
          instanceId: instance.id,
          runtime: {
            mode,
            ...(instance.commandConfig.runtime.distro
              ? { distro: instance.commandConfig.runtime.distro }
              : {}),
            ...(instance.commandConfig.runtime.container
              ? { container: instance.commandConfig.runtime.container }
              : {}),
          },
        }];
      })
    ));
}

export async function runManualSessionDiscovery(input: {
  config: ManualSessionDiscoveryConfig;
  registry: SessionRegistry;
  runner: ManualSessionDiscoveryRunner;
}): Promise<ManualSessionDiscoveryResult> {
  const targets = listManualSessionDiscoveryTargets(input.config);
  const results: ManualSessionDiscoveryTargetResult[] = [];

  for (const target of targets) {
    try {
      const sessions = await input.runner.listSessions(target);
      const sync = syncNativeSessions(
        input.registry,
        target.provider,
        sessions,
        target.instanceId,
      );
      results.push({
        ...target,
        status: 'scanned',
        discoveredCount: sessions.length,
        importedCount: sync.newCount,
        syncedCount: sync.syncedCount,
        message: sessions.length > 0
          ? `Scanned ${sessions.length} session(s).`
          : 'Scanned 0 sessions.',
      });
    } catch (error) {
      results.push({
        ...target,
        status: 'failed',
        discoveredCount: 0,
        importedCount: 0,
        syncedCount: 0,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const scannedTargets = results.filter((result) => result.status === 'scanned').length;
  const failedTargets = results.filter((result) => result.status === 'failed').length;
  const discoveredCount = results.reduce((sum, result) => sum + result.discoveredCount, 0);
  const importedCount = results.reduce((sum, result) => sum + result.importedCount, 0);
  const syncedCount = results.reduce((sum, result) => sum + result.syncedCount, 0);

  return {
    summary: {
      status: targets.length === 0
        ? 'idle'
        : failedTargets === 0
          ? 'completed'
          : scannedTargets > 0
            ? 'completed_with_errors'
            : 'failed',
      totalTargets: targets.length,
      scannedTargets,
      failedTargets,
      discoveredCount,
      importedCount,
      syncedCount,
    },
    targets: results,
  };
}
