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
import type { AgentAdapterSessionCatalog } from '../../backends/agent/types.js';

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

export interface AgentSessionDiscoveryTarget {
  provider: string;
  instanceId: string;
}

export interface AgentSessionDiscoveryTargetResult extends AgentSessionDiscoveryTarget {
  /**
   * `unsupported` is a normal outcome, not a failure: session enumeration is an
   * optional agent capability, so an agent without it must not turn a whole
   * scan red.
   */
  status: 'scanned' | 'unsupported' | 'failed';
  discoveredCount: number;
  importedCount: number;
  message: string;
}

export interface ManualSessionDiscoveryResult {
  summary: ManualSessionDiscoverySummary;
  targets: ManualSessionDiscoveryTargetResult[];
  agentTargets: AgentSessionDiscoveryTargetResult[];
}

export interface ManualSessionDiscoveryRunner {
  listSessions(target: ManualSessionDiscoveryTarget): Promise<NativeSessionSummary[]>;
}

export interface AgentSessionDiscoveryRunner {
  listTargets(): AgentSessionDiscoveryTarget[];
  listSessions(target: AgentSessionDiscoveryTarget): Promise<AgentAdapterSessionCatalog>;
}

/**
 * Registers sessions an agent reported as already its own.
 *
 * Shared by the manual scan and the single-target discovery route so both write
 * the same registry shape; a second mapping would drift from this one.
 */
export function importAgentSessions(
  registry: SessionRegistry,
  target: AgentSessionDiscoveryTarget,
  sessions: AgentAdapterSessionCatalog['sessions'],
  group?: string,
): number {
  const known = new Set(
    registry.list({ provider: target.provider })
      .filter((session) => (
        session.providerBackend === 'agent'
        && (session.providerInstanceId || 'default') === (target.instanceId || 'default')
      ))
      .map((session) => session.providerSessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );
  const newlyImported = new Set<string>();

  for (const session of sessions) {
    const tracked = registry.upsertDiscovered(session.providerSessionId, {
      providerName: target.provider,
      providerBackend: 'agent',
      providerInstanceId: target.instanceId,
      cwd: session.cwd || '',
      ...(group ? { group } : {}),
      ...(session.summary ? { summary: session.summary } : {}),
      ...(session.lastActivity ? { lastActivity: session.lastActivity } : {}),
    });
    if (tracked && !known.has(session.providerSessionId)) {
      newlyImported.add(session.providerSessionId);
    }
  }

  registry.pruneMissingDiscovered(
    target.provider,
    sessions.map((session) => session.providerSessionId),
    'agent',
    target.instanceId,
  );

  return newlyImported.size;
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
  | 'clineSessionsDir'
  | 'grokSessionsDir'
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

async function runAgentSessionDiscovery(
  registry: SessionRegistry,
  runner: AgentSessionDiscoveryRunner | undefined,
): Promise<AgentSessionDiscoveryTargetResult[]> {
  if (!runner) {
    return [];
  }

  const results: AgentSessionDiscoveryTargetResult[] = [];
  for (const target of runner.listTargets()) {
    try {
      const catalog = await runner.listSessions(target);
      if (!catalog.supported) {
        results.push({
          ...target,
          status: 'unsupported',
          discoveredCount: 0,
          importedCount: 0,
          message: catalog.summary,
        });
        continue;
      }

      results.push({
        ...target,
        status: 'scanned',
        discoveredCount: catalog.sessions.length,
        importedCount: importAgentSessions(registry, target, catalog.sessions),
        message: catalog.summary,
      });
    } catch (error) {
      results.push({
        ...target,
        status: 'failed',
        discoveredCount: 0,
        importedCount: 0,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export async function runManualSessionDiscovery(input: {
  config: ManualSessionDiscoveryConfig;
  registry: SessionRegistry;
  runner: ManualSessionDiscoveryRunner;
  agentRunner?: AgentSessionDiscoveryRunner;
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

  const agentResults = await runAgentSessionDiscovery(input.registry, input.agentRunner);

  // An agent that does not advertise enumeration counts as a scanned target
  // rather than a failed one, so a mixed scan still reads as completed.
  const scannedTargets = results.filter((result) => result.status === 'scanned').length
    + agentResults.filter((result) => result.status !== 'failed').length;
  const failedTargets = results.filter((result) => result.status === 'failed').length
    + agentResults.filter((result) => result.status === 'failed').length;
  const totalTargets = targets.length + agentResults.length;
  const discoveredCount = results.reduce((sum, result) => sum + result.discoveredCount, 0)
    + agentResults.reduce((sum, result) => sum + result.discoveredCount, 0);
  const importedCount = results.reduce((sum, result) => sum + result.importedCount, 0)
    + agentResults.reduce((sum, result) => sum + result.importedCount, 0);
  const syncedCount = results.reduce((sum, result) => sum + result.syncedCount, 0);

  return {
    summary: {
      status: totalTargets === 0
        ? 'idle'
        : failedTargets === 0
          ? 'completed'
          : scannedTargets > 0
            ? 'completed_with_errors'
            : 'failed',
      totalTargets,
      scannedTargets,
      failedTargets,
      discoveredCount,
      importedCount,
      syncedCount,
    },
    targets: results,
    agentTargets: agentResults,
  };
}
