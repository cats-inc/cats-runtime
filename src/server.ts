import { once } from 'node:events';
import type { Server } from 'node:http';
import os from 'node:os';
import { join } from 'node:path';
import { createAdaptorServer } from '@hono/node-server';
import { AuggieSessionService } from './backends/cli/auggie/AuggieSessionService.js';
import {
  getProviderDefaultInstanceId,
  listProviderInstances,
  resolveProviderInstance,
} from './backends/cli/config.js';
import type { CliRuntimeConfig } from './backends/cli/config.js';
import {
  loadConfig,
  getRuntimeResolvedPaths,
  copyRuntimeConfigEnv,
  getRuntimeConfigEnv,
} from './core/config.js';
import type { RuntimeConfig } from './core/types.js';
import { resolveConfigPath } from './backends/cli/config.js';
import { AuggieSessionScanner } from './backends/cli/discovery/AuggieSessionScanner.js';
import { FileWatcher } from './backends/cli/discovery/FileWatcher.js';
import { SessionScanner } from './backends/cli/discovery/SessionScanner.js';
import { AntigravitySessionScanner } from './backends/cli/discovery/AntigravitySessionScanner.js';
import { ClineSessionScanner } from './backends/cli/discovery/ClineSessionScanner.js';
import { GrokSessionScanner } from './backends/cli/discovery/GrokSessionScanner.js';
import { MuseSessionScanner } from './backends/cli/discovery/MuseSessionScanner.js';
import { CodexSessionScanner } from './backends/cli/discovery/CodexSessionScanner.js';
import { CopilotSessionScanner } from './backends/cli/discovery/CopilotSessionScanner.js';
import { PiSessionScanner } from './backends/cli/discovery/PiSessionScanner.js';
import { GooseNativeSessionService } from './backends/cli/goose/GooseNativeSessionService.js';
import { JunieSessionScanner } from './backends/cli/junie/JunieSessionScanner.js';
import { syncNativeSessions } from './backends/cli/discovery/nativeDiscovery.js';
import { isDockerContainerRunning } from './backends/cli/discovery/dockerDiscovery.js';
import {
  WslDiscoveryStatusStore,
  isWslDistroRunning,
  runWslAwareNativeDiscovery,
  type WslDistroInspector,
} from './backends/cli/discovery/wslDiscovery.js';
import { CursorNativeSessionService } from './backends/cli/cursor/CursorNativeSessionService.js';
import { KiroNativeSessionService } from './backends/cli/kiro/KiroNativeSessionService.js';
import { KiloNativeSessionService } from './backends/cli/kilo/KiloNativeSessionService.js';
import { OpencodeNativeSessionService } from './backends/cli/opencode/OpencodeNativeSessionService.js';
import { createRuntimeAdapter } from './backends/cli/runtime/runtime.js';
import { SessionRegistry } from './backends/cli/pool/SessionRegistry.js';
import { ApiBackendManager } from './backends/api/runtime/ApiBackendManager.js';
import { AgentBackendManager } from './backends/agent/runtime/AgentBackendManager.js';
import { WorkerPool } from './backends/cli/pool/WorkerPool.js';
import { RuntimeSessionManager } from './core/runtime/RuntimeSessionManager.js';
import { resolveProviderTarget } from './core/providerCatalog.js';
import {
  importAgentSessions,
  listAgentSessionDiscoveryTargets,
} from './core/runtime/manualSessionDiscovery.js';
import { ensureSessionAwake } from './core/runtime/sessionWakeup.js';
import { ProviderModelCatalogService } from './core/models/providerModelCatalog.js';
import { BootstrapService } from './core/bootstrap/BootstrapService.js';
import { ProviderSelectionError, providerSelectionKey, type SelectedProviderTarget } from './core/bootstrap/ProviderSelectionService.js';
import { ProviderCompatibilityService } from './core/compatibility/ProviderCompatibilityService.js';
import { RuntimeWakeupService } from './core/wakeup/RuntimeWakeupService.js';
import { RuntimeBrowserService } from './core/browser/RuntimeBrowserService.js';
import { RuntimeBrowserMaintenanceService } from './core/browser/RuntimeBrowserMaintenanceService.js';
import { RuntimeWorktreeMaintenanceService } from './core/workspace/RuntimeWorktreeMaintenanceService.js';
import { loadPeerRuntimeConfig } from './core/peers/config.js';
import { PeerRegistry as RuntimePeerRegistry } from './core/peers/PeerRegistry.js';
import { PeerCapabilitySnapshotService } from './core/peers/PeerCapabilitySnapshotService.js';
import { PeerDiscoveryController } from './core/peers/PeerDiscoveryController.js';
import { PeerTrustService } from './core/peers/PeerTrustService.js';
import { PeerRoutingService } from './core/peers/PeerRoutingService.js';
import { PeerExecutionClient } from './core/peers/PeerExecutionClient.js';
import { PeerExecutionService } from './core/peers/PeerExecutionService.js';
import { PeerExecutionAdmissionService } from './core/peers/PeerExecutionAdmissionService.js';
import { PeerExecutionReplayService } from './core/peers/PeerExecutionReplayService.js';
import { createRuntimeApp, type AppContext } from './http/app.js';
import { RuntimeMeteringService } from './core/usage/RuntimeMeteringService.js';
import { QuotaRefreshService } from './core/usage/QuotaRefreshService.js';
import { readCopilotQuota } from './backends/cli/usage/copilotQuota.js';
import { readClaudeQuota } from './backends/cli/usage/claudeQuota.js';
import { readAntigravityQuota } from './backends/cli/usage/antigravityQuota.js';
import { readCodexQuota } from './backends/cli/usage/codexQuota.js';
import { primeProviderAvailabilityDiagnosticsCache, invalidateProviderAvailabilityDiagnosticsCache } from './http/routes/diagnostics.js';
import { probeSetupNonCliTarget } from './core/bootstrap/setupConnections.js';
import { executeRetainedWorktreeCleanup } from './http/routes/sessions.js';
import type { ProviderName } from './backends/cli/providers/types.js';
import type { ApiBackendOptions } from './backends/api/types.js';
import type { AgentBackendOptions } from './backends/agent/types.js';
import {
  createRuntimeStartupState,
  markRuntimeReady,
  markRuntimeStopped,
  markRuntimeStopping,
  type RuntimeStartupState,
} from './startup.js';
import {
  getConfiguredFileBackedProviderPath,
  normalizeFileBackedProviderPath,
  resolveFileBackedProviderPath,
  supportsHostFileBackedProviderDiscovery,
} from './backends/cli/providerPaths.js';
import { createRuntimeBrowserDrivers } from './backends/browser/createDrivers.js';
import type { RuntimeStartupTrace } from './core/startupTrace.js';

interface DiscoveryController {
  start(): void;
  stop(): void;
}

interface RuntimeServerOptions {
  wslDistroInspector?: WslDistroInspector;
  apiBackend?: ApiBackendOptions;
  agentBackend?: AgentBackendOptions;
  startup?: RuntimeStartupState;
  compatibility?: ProviderCompatibilityService;
  startupTrace?: RuntimeStartupTrace;
}

interface WatcherSpec {
  provider: ProviderName;
  instanceId: string;
  name: string;
  watchDir: string;
  normalizedWatchDir: string;
  createWatcher(): FileWatcher;
}

export interface RuntimeServer {
  server: Server;
  app: ReturnType<typeof createRuntimeApp>;
  context: AppContext;
  start(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

function startWatcher(name: string, watcher: FileWatcher): void {
  watcher.on('discovered', ({ count }) => {
    console.log(`[discovery:${name}] Found ${count} new external session(s)`);
  });
  watcher.on('error', (error) => {
    console.warn(`[discovery:${name}] Watcher error:`, error.message);
  });
  watcher.start().catch((error) => {
    console.warn(`[discovery:${name}] Initial scan failed:`, error.message);
  });
}

function pickPreferredWatcherSpec(
  config: RuntimeConfig,
  left: WatcherSpec,
  right: WatcherSpec,
): WatcherSpec {
  const defaultInstanceId = getProviderDefaultInstanceId(config, left.provider);
  if (left.instanceId === defaultInstanceId && right.instanceId !== defaultInstanceId) {
    return left;
  }
  if (right.instanceId === defaultInstanceId && left.instanceId !== defaultInstanceId) {
    return right;
  }
  return left;
}

function dedupeWatcherSpecs(
  config: RuntimeConfig,
  watcherSpecs: WatcherSpec[],
): Array<{ name: string; watcher: FileWatcher }> {
  const keptByKey = new Map<string, WatcherSpec>();

  for (const spec of watcherSpecs) {
    const key = `${spec.provider}:${spec.normalizedWatchDir}`;
    const existing = keptByKey.get(key);
    if (!existing) {
      keptByKey.set(key, spec);
      continue;
    }

    const kept = pickPreferredWatcherSpec(config, existing, spec);
    const skipped = kept === existing ? spec : existing;
    keptByKey.set(key, kept);

    console.warn(
      `[discovery:${spec.provider}] Instances '${existing.name}' and '${spec.name}' `
      + `share watch dir '${spec.watchDir}'. Keeping '${kept.name}' and skipping `
      + `'${skipped.name}'.`,
    );
  }

  return Array.from(keptByKey.values()).map((spec) => ({
    name: spec.name,
    watcher: spec.createWatcher(),
  }));
}

function resolveContextService<T>(
  config: CliRuntimeConfig,
  provider: ProviderName,
  instanceId: string | undefined,
  resolver: ((instanceId?: string) => T) | undefined,
  fallback: T,
): T {
  if (resolver) {
    return resolver(instanceId);
  }

  const defaultInstanceId = getProviderDefaultInstanceId(config, provider);
  if (!instanceId || instanceId === defaultInstanceId) {
    return fallback;
  }

  resolveProviderInstance(config, provider, instanceId);
  throw new Error(
    `Internal error: ${provider} resolver is unavailable for instance '${instanceId}'`,
  );
}

function resolveServiceForInstance<T>(
  config: CliRuntimeConfig,
  provider: ProviderName,
  instanceId: string | undefined,
  servicesByInstance: Map<string, T>,
): T {
  const resolvedInstanceId = resolveProviderInstance(config, provider, instanceId).id;
  const service = servicesByInstance.get(resolvedInstanceId);
  if (!service) {
    throw new Error(
      `Internal error: ${provider} service for instance '${resolvedInstanceId}' is not initialized`,
    );
  }

  return service;
}

function getDefaultService<T>(
  config: CliRuntimeConfig,
  provider: ProviderName,
  servicesByInstance: Map<string, T>,
  buildFallback: () => T,
): T {
  const defaultInstanceId = getProviderDefaultInstanceId(config, provider);
  return servicesByInstance.get(defaultInstanceId) || buildFallback();
}

function createAuggieSessionService(
  config: CliRuntimeConfig,
  instanceId?: string,
): AuggieSessionService {
  const sessionsDir = supportsHostFileBackedProviderDiscovery(config, 'auggie', instanceId)
    ? resolveFileBackedProviderPath(config, 'auggie', instanceId)
    : getConfiguredFileBackedProviderPath(config, 'auggie', instanceId);
  return new AuggieSessionService(sessionsDir);
}

function listenServer(
  server: Server,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const cleanup = () => {
      server.off('listening', onListening);
      server.off('error', onError);
    };

    const onListening = () => {
      cleanup();
      resolveListen();
    };

    const onError = (error: Error) => {
      cleanup();
      rejectListen(error);
    };

    server.once('listening', onListening);
    server.once('error', onError);

    if (host) {
      server.listen(port, host);
      return;
    }

    server.listen(port);
  });
}

export function createDiscoveryController(
  ctx: AppContext,
  options: RuntimeServerOptions = {},
): DiscoveryController {
  const resolveAuggieSessions = (instanceId?: string): AuggieSessionService =>
    resolveContextService(
      ctx.config,
      'auggie',
      instanceId,
      ctx.resolveAuggieSessions,
      ctx.auggieSessions,
    );
  const resolveCursorNative = (instanceId?: string): CursorNativeSessionService =>
    resolveContextService(
      ctx.config,
      'cursor',
      instanceId,
      ctx.resolveCursorNative,
      ctx.cursorNative,
    );
  const resolveKiroNative = (instanceId?: string): KiroNativeSessionService =>
    resolveContextService(
      ctx.config,
      'kiro',
      instanceId,
      ctx.resolveKiroNative,
      ctx.kiroNative,
    );
  const resolveKiloNative = (instanceId?: string): KiloNativeSessionService =>
    resolveContextService(
      ctx.config,
      'kilo',
      instanceId,
      ctx.resolveKiloNative,
      ctx.kiloNative,
    );
  const resolveOpencodeNative = (instanceId?: string): OpencodeNativeSessionService =>
    resolveContextService(
      ctx.config,
      'opencode',
      instanceId,
      ctx.resolveOpencodeNative,
      ctx.opencodeNative,
    );
  const wslDiscoveryStatus = ctx.wslDiscoveryStatus || new WslDiscoveryStatusStore(ctx.config);

  const watcherEntries = dedupeWatcherSpecs(ctx.config, [
    ...listProviderInstances(ctx.config, 'auggie')
      .filter((instance) => supportsHostFileBackedProviderDiscovery(ctx.config, 'auggie', instance.id))
      .map((instance) => ({
      provider: 'auggie' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'auggie')
        ? 'auggie'
        : `auggie@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'auggie', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'auggie', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'auggie', instance.id),
        new AuggieSessionScanner(resolveAuggieSessions(instance.id)),
        'auggie',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'claude')
      .filter((instance) => supportsHostFileBackedProviderDiscovery(ctx.config, 'claude', instance.id))
      .map((instance) => ({
      provider: 'claude' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'claude')
        ? 'claude'
        : `claude@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'claude', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'claude', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'claude', instance.id),
        new SessionScanner(resolveFileBackedProviderPath(ctx.config, 'claude', instance.id)),
        'claude',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'grok')
      .filter((instance) => supportsHostFileBackedProviderDiscovery(ctx.config, 'grok', instance.id))
      .map((instance) => ({
      provider: 'grok' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'grok')
        ? 'grok'
        : `grok@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'grok', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'grok', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'grok', instance.id),
        new GrokSessionScanner(resolveFileBackedProviderPath(ctx.config, 'grok', instance.id)),
        'grok',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'muse')
      .filter((instance) => supportsHostFileBackedProviderDiscovery(ctx.config, 'muse', instance.id))
      .map((instance) => ({
      provider: 'muse' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'muse')
        ? 'muse'
        : `muse@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'muse', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'muse', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'muse', instance.id),
        new MuseSessionScanner(resolveFileBackedProviderPath(ctx.config, 'muse', instance.id)),
        'muse',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'antigravity')
      .filter((instance) => (
        supportsHostFileBackedProviderDiscovery(ctx.config, 'antigravity', instance.id)
      ))
      .map((instance) => ({
      provider: 'antigravity' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'antigravity')
        ? 'antigravity'
        : `antigravity@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'antigravity', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'antigravity', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'antigravity', instance.id),
        new AntigravitySessionScanner(
          resolveFileBackedProviderPath(ctx.config, 'antigravity', instance.id),
        ),
        'antigravity',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'cline')
      .filter((instance) => supportsHostFileBackedProviderDiscovery(ctx.config, 'cline', instance.id))
      .map((instance) => ({
      provider: 'cline' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'cline')
        ? 'cline'
        : `cline@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'cline', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'cline', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'cline', instance.id),
        new ClineSessionScanner(resolveFileBackedProviderPath(ctx.config, 'cline', instance.id)),
        'cline',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'codex')
      .filter((instance) => supportsHostFileBackedProviderDiscovery(ctx.config, 'codex', instance.id))
      .map((instance) => ({
      provider: 'codex' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'codex')
        ? 'codex'
        : `codex@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'codex', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'codex', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'codex', instance.id),
        new CodexSessionScanner(resolveFileBackedProviderPath(ctx.config, 'codex', instance.id)),
        'codex',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'copilot')
      .filter((instance) => supportsHostFileBackedProviderDiscovery(ctx.config, 'copilot', instance.id))
      .map((instance) => ({
      provider: 'copilot' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'copilot')
        ? 'copilot'
        : `copilot@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'copilot', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'copilot', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'copilot', instance.id),
        new CopilotSessionScanner(
          resolveFileBackedProviderPath(ctx.config, 'copilot', instance.id),
        ),
        'copilot',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'pi')
      .filter((instance) => supportsHostFileBackedProviderDiscovery(ctx.config, 'pi', instance.id))
      .map((instance) => ({
      provider: 'pi' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'pi')
        ? 'pi'
        : `pi@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'pi', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'pi', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'pi', instance.id),
        new PiSessionScanner(
          resolveFileBackedProviderPath(ctx.config, 'pi', instance.id),
        ),
        'pi',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'junie').map((instance) => {
      const junieSessionsDir = join(os.homedir(), '.junie', 'sessions');
      return {
        provider: 'junie' as const,
        instanceId: instance.id,
        name: instance.id === getProviderDefaultInstanceId(ctx.config, 'junie')
          ? 'junie'
          : `junie@${instance.id}`,
        watchDir: junieSessionsDir,
        normalizedWatchDir: junieSessionsDir,
        createWatcher: () => new FileWatcher(
          junieSessionsDir,
          new JunieSessionScanner(junieSessionsDir),
          'junie',
          ctx.registry,
          instance.id,
        ),
      };
    }),
  ]);

  const timers: Array<ReturnType<typeof setInterval>> = [];
  let started = false;
  let generation = 0;
  const wslDistroInspector = options.wslDistroInspector || isWslDistroRunning;
  const wslDiscoveryPolicy = ctx.config.wslDiscoveryPolicy ?? 'always';
  const dockerDiscoveryPolicy = ctx.config.dockerDiscoveryPolicy ?? 'if_running';

  const shouldSkipBackgroundDockerDiscovery = (
    provider: 'cursor' | 'goose' | 'kiro' | 'kilo' | 'opencode',
    instanceId: string,
  ): boolean => {
    if (dockerDiscoveryPolicy !== 'manual_only') {
      return false;
    }
    const runtime = resolveProviderInstance(ctx.config, provider, instanceId)
      .commandConfig.runtime;
    return runtime.mode === 'docker';
  };

  const shouldSkipBackgroundWslDiscovery = (
    provider: 'cursor' | 'goose' | 'kiro' | 'kilo' | 'opencode',
    instanceId: string,
  ): boolean => {
    if (
      provider === 'goose'
      || provider === 'kilo'
      || provider === 'opencode'
      || wslDiscoveryPolicy !== 'manual_only'
    ) {
      return false;
    }

    const runtime = resolveProviderInstance(
      ctx.config,
      provider,
      instanceId,
    ).commandConfig.runtime;
    return runtime.mode === 'wsl';
  };

  const startNativeDiscovery = (
    name: 'cursor' | 'goose' | 'kiro' | 'kilo' | 'opencode',
    instanceId: string,
    listAllSessions: () => Promise<Array<{
      providerSessionId: string;
      cwd: string;
      summary?: string;
      messageCount: number;
      lastActivity?: string;
      model?: string;
    }>>,
  ): ReturnType<typeof setInterval> | null => {
    let running = false;
    const label = name === 'cursor'
      ? 'Cursor'
      : name === 'goose'
        ? 'Goose'
        : name === 'kiro'
          ? 'Kiro'
          : name === 'kilo'
            ? 'Kilo'
            : 'OpenCode';
    const discoveryLabel = instanceId === getProviderDefaultInstanceId(ctx.config, name)
      ? name
      : `${name}@${instanceId}`;

    const scan = async (): Promise<void> => {
      if (running || !started) return;
      running = true;

      try {
        if (name === 'cursor' || name === 'kiro') {
          const runtime = resolveProviderInstance(
            ctx.config,
            name,
            instanceId,
          ).commandConfig.runtime;
          if (runtime.mode === 'wsl') {
            const result = await runWslAwareNativeDiscovery({
              provider: name,
              providerInstanceId: instanceId,
              listAllSessions,
              registry: ctx.registry,
              runtime,
              policy: wslDiscoveryPolicy,
              statusStore: wslDiscoveryStatus,
              inspector: wslDistroInspector,
              isCurrent: () => started,
            });
            if (result.outcome === 'scanned' && result.newCount > 0) {
              console.log(
                `[discovery:${discoveryLabel}] Imported ${result.newCount} native ${label} session(s)`,
              );
            }
            return;
          }
        }

        const instanceRuntime = resolveProviderInstance(
          ctx.config,
          name,
          instanceId,
        ).commandConfig.runtime;
        if (instanceRuntime.mode === 'docker' && dockerDiscoveryPolicy === 'if_running') {
          const container = instanceRuntime.container || 'cats-cli';
          try {
            const containerRunning = await isDockerContainerRunning(container);
            if (!containerRunning) {
              console.warn(
                `[discovery:${discoveryLabel}] Skipping scan: Docker container '${container}' is not running`,
              );
              return;
            }
          } catch {
            console.warn(
              `[discovery:${discoveryLabel}] Skipping scan: could not inspect Docker container '${container}'`,
            );
            return;
          }
        }

        const sessions = await listAllSessions();
        if (!started) return;
        const { newCount } = syncNativeSessions(
          ctx.registry,
          name,
          sessions,
          instanceId,
        );
        if (newCount > 0) {
          console.log(
            `[discovery:${discoveryLabel}] Imported ${newCount} native ${label} session(s)`,
          );
        }
      } catch (error) {
        console.warn(
          `[discovery:${discoveryLabel}] Native scan failed:`,
          (error as Error).message,
        );
      } finally {
        running = false;
      }
    };

    if (ctx.config.nativeDiscoveryIntervalMs <= 0) {
      return null;
    }

    if (shouldSkipBackgroundWslDiscovery(name, instanceId)) {
      return null;
    }

    if (shouldSkipBackgroundDockerDiscovery(name, instanceId)) {
      return null;
    }

    void scan();

    return setInterval(() => {
      void scan();
    }, ctx.config.nativeDiscoveryIntervalMs);
  };

  return {
    start() {
      if (started) return;
      started = true;
      const activeGeneration = ++generation;

      for (const entry of watcherEntries) {
        startWatcher(entry.name, entry.watcher);
      }

      const agentBackend = ctx.agentBackend;
      if (agentBackend && ctx.config.nativeDiscoveryIntervalMs > 0) {
        for (const target of listAgentSessionDiscoveryTargets(ctx.config)) {
          let running = false;
          let unsupported = false;
          const sessionIdentities = () => JSON.stringify(ctx.registry.list({ provider: target.provider })
            .filter((session) => session.providerBackend === 'agent'
              && (session.providerInstanceId || 'default') === target.instanceId)
            .map((session) => [session.id, session.providerSessionId]).sort());
          const scan = async () => {
            if (running || unsupported || !started || generation !== activeGeneration) return;
            running = true;
            const selection = ctx.bootstrapService?.selection;
            let operationId: string | undefined;
            try {
              operationId = selection?.acquireOperation({ provider: target.provider,
                backend: 'agent', instance: target.instanceId }, ctx.config.providerSelectionRevision);
              const before = sessionIdentities();
              const catalog = await agentBackend.listSessions(resolveProviderTarget(
                ctx.config, target.provider, `agent/${target.instanceId}`,
              ));
              if (!started || generation !== activeGeneration) return;
              // A delete or another discovery may finish while the provider is
              // answering. Let the next scan reconcile instead of reviving or
              // pruning sessions using a result older than that local change.
              if (sessionIdentities() !== before) return;
              if (!catalog.supported) {
                unsupported = true;
                return;
              }
              importAgentSessions(ctx.registry, target, catalog.sessions);
            } catch (error) {
              console.warn(
                `[discovery:${target.provider}@${target.instanceId}] Agent scan failed:`,
                error instanceof Error ? error.message : String(error),
              );
            } finally {
              if (operationId) selection?.releaseOperation(operationId);
              running = false;
            }
          };
          void scan();
          timers.push(setInterval(() => { void scan(); }, ctx.config.nativeDiscoveryIntervalMs));
        }
      }

      for (const instance of listProviderInstances(ctx.config, 'cursor')) {
        const timer = startNativeDiscovery(
          'cursor',
          instance.id,
          () => resolveCursorNative(instance.id).listAllSessions(),
        );
        if (timer) timers.push(timer);
      }

      for (const instance of listProviderInstances(ctx.config, 'kiro')) {
        const timer = startNativeDiscovery(
          'kiro',
          instance.id,
          () => resolveKiroNative(instance.id).listAllSessions(),
        );
        if (timer) timers.push(timer);
      }

      for (const instance of listProviderInstances(ctx.config, 'opencode')) {
        const timer = startNativeDiscovery(
          'opencode',
          instance.id,
          () => resolveOpencodeNative(instance.id).listAllSessions({ startIfNeeded: false }),
        );
        if (timer) timers.push(timer);
      }

      for (const instance of listProviderInstances(ctx.config, 'kilo')) {
        const timer = startNativeDiscovery(
          'kilo',
          instance.id,
          () => resolveKiloNative(instance.id).listAllSessions({ startIfNeeded: false }),
        );
        if (timer) timers.push(timer);
      }

      // Goose enumeration executes the provider CLI (including per-session
      // exports). Keep it available through explicit discovery, never timers.
    },
    stop() {
      if (!started) return;
      started = false;
      generation += 1;
      for (const entry of watcherEntries) {
        entry.watcher.stop();
      }
      while (timers.length > 0) {
        clearInterval(timers.pop()!);
      }
    },
  };
}

export function createRuntimeServer(
  config: RuntimeConfig = loadConfig(),
  options: RuntimeServerOptions = {},
): RuntimeServer {
  const startup = options.startup ?? createRuntimeStartupState();
  const startupTrace = options.startupTrace;
  const peerConfig = loadPeerRuntimeConfig(config);
  const dataDir = config.dataDir || join(config.sessionBaseDir, '..', 'data');
  const registry = new SessionRegistry(
    dataDir,
    config.sessionBaseDir,
    config.providerDefaultInstances,
    config.providerDefaultTargets,
  );
  const apiBackend = new ApiBackendManager(config, registry, options.apiBackend);
  const agentBackend = new AgentBackendManager(config, registry, options.agentBackend);
  const wslDiscoveryStatus = new WslDiscoveryStatusStore(config);
  const auggieSessionsByInstance = new Map(
    listProviderInstances(config, 'auggie').map((instance) => [
      instance.id,
      createAuggieSessionService(config, instance.id),
    ]),
  );
  const cursorNativeByInstance = new Map(
    listProviderInstances(config, 'cursor').map((instance) => [
      instance.id,
      new CursorNativeSessionService({
        command: instance.commandConfig.path,
        chatsDir: instance.cursorChatsDir || config.cursorChatsDir,
        runtime: createRuntimeAdapter(instance.commandConfig.runtime),
      }),
    ]),
  );
  const kiroNativeByInstance = new Map(
    listProviderInstances(config, 'kiro').map((instance) => [
      instance.id,
      new KiroNativeSessionService({
        command: instance.commandConfig.path,
        dbPath: instance.kiroDbPath || config.kiroDbPath,
        runtime: createRuntimeAdapter(instance.commandConfig.runtime),
      }),
    ]),
  );
  const gooseNativeByInstance = new Map(
    listProviderInstances(config, 'goose').map((instance) => [
      instance.id,
      new GooseNativeSessionService({
        command: instance.commandConfig.path,
      }),
    ]),
  );
  const kiloNativeByInstance = new Map(
    listProviderInstances(config, 'kilo').map((instance) => [
      instance.id,
      new KiloNativeSessionService({
        command: instance.commandConfig.path,
        commandConfig: instance.commandConfig,
        hostname: instance.kiloServerHost || config.kiloServerHost,
        port: instance.kiloServerPort || config.kiloServerPort,
        startupTimeoutMs: instance.kiloServerStartupTimeoutMs
          || config.kiloServerStartupTimeoutMs,
      }),
    ]),
  );
  const opencodeNativeByInstance = new Map(
    listProviderInstances(config, 'opencode').map((instance) => [
      instance.id,
      new OpencodeNativeSessionService({
        command: instance.commandConfig.path,
        commandConfig: instance.commandConfig,
        hostname: instance.opencodeServerHost || config.opencodeServerHost,
        port: instance.opencodeServerPort || config.opencodeServerPort,
        startupTimeoutMs: instance.opencodeServerStartupTimeoutMs
          || config.opencodeServerStartupTimeoutMs,
      }),
    ]),
  );

  const resolveGooseNative = (instanceId?: string): GooseNativeSessionService =>
    resolveServiceForInstance(config, 'goose', instanceId, gooseNativeByInstance);
  const resolveAuggieSessions = (instanceId?: string): AuggieSessionService =>
    resolveServiceForInstance(config, 'auggie', instanceId, auggieSessionsByInstance);
  const resolveCursorNative = (instanceId?: string): CursorNativeSessionService =>
    resolveServiceForInstance(config, 'cursor', instanceId, cursorNativeByInstance);
  const resolveKiroNative = (instanceId?: string): KiroNativeSessionService =>
    resolveServiceForInstance(config, 'kiro', instanceId, kiroNativeByInstance);
  const resolveKiloNative = (instanceId?: string): KiloNativeSessionService =>
    resolveServiceForInstance(config, 'kilo', instanceId, kiloNativeByInstance);
  const resolveOpencodeNative = (instanceId?: string): OpencodeNativeSessionService =>
    resolveServiceForInstance(config, 'opencode', instanceId, opencodeNativeByInstance);

  const auggieSessions = getDefaultService(
    config,
    'auggie',
    auggieSessionsByInstance,
    () => new AuggieSessionService(config.auggieSessionsDir),
  );
  const cursorNative = getDefaultService(
    config,
    'cursor',
    cursorNativeByInstance,
    () => new CursorNativeSessionService({
      command: config.cursorPath,
      chatsDir: config.cursorChatsDir,
      runtime: createRuntimeAdapter(config.cursorRuntime),
    }),
  );
  const kiroNative = getDefaultService(
    config,
    'kiro',
    kiroNativeByInstance,
    () => new KiroNativeSessionService({
      command: config.kiroPath,
      dbPath: config.kiroDbPath,
      runtime: createRuntimeAdapter(config.kiroRuntime),
    }),
  );
  const gooseNative = getDefaultService(
    config,
    'goose',
    gooseNativeByInstance,
    () => new GooseNativeSessionService({
      command: config.goosePath,
    }),
  );
  const kiloNative = getDefaultService(
    config,
    'kilo',
    kiloNativeByInstance,
    () => new KiloNativeSessionService({
      command: config.kiloPath,
      commandConfig: config.providerCommands.kilo,
      hostname: config.kiloServerHost,
      port: config.kiloServerPort,
      startupTimeoutMs: config.kiloServerStartupTimeoutMs,
    }),
  );
  const opencodeNative = getDefaultService(
    config,
    'opencode',
    opencodeNativeByInstance,
    () => new OpencodeNativeSessionService({
      command: config.opencodePath,
      commandConfig: config.providerCommands.opencode,
      hostname: config.opencodeServerHost,
      port: config.opencodeServerPort,
      startupTimeoutMs: config.opencodeServerStartupTimeoutMs,
    }),
  );
  const compatibility = options.compatibility ?? new ProviderCompatibilityService(config);
  compatibility.setTargetGuard((target) => {
    resolveProviderTarget(config, target.providerName, `${target.backend}/${target.instanceId}`);
  });
  const pool = new WorkerPool(
    config,
    registry,
    gooseNative,
    kiroNative,
    kiloNative,
    auggieSessions,
    opencodeNative,
    compatibility,
    {
      getAuggieSessions: resolveAuggieSessions,
      getGooseNative: resolveGooseNative,
      getKiroNative: resolveKiroNative,
      getKiloNative: resolveKiloNative,
      getOpencodeNative: resolveOpencodeNative,
    },
  );
  const runtime = new RuntimeSessionManager(config, pool, apiBackend, agentBackend);
  const wakeup = new RuntimeWakeupService({
    persistPath: join(dataDir, 'wakeups.json'),
    sessionExists: (sessionId) => registry.get(sessionId) !== undefined,
    wakeSession: async (sessionId) =>
      ensureSessionAwake({
        config,
        registry,
        runtime,
        sessionId,
        getKiroNative: resolveKiroNative,
      }),
  });
  const providerModelCatalog = new ProviderModelCatalogService(config, {
    agentBackend,
    fetch: options.apiBackend?.fetch,
    env: options.apiBackend?.env,
    beginProviderOperation: (target) => {
      const selection = context.bootstrapService!.selection;
      const id = selection.acquireOperation({ provider: target.providerName,
        backend: target.backend, instance: target.instanceId }, config.providerSelectionRevision);
      return () => selection.releaseOperation(id);
    },
  });
  const browser = new RuntimeBrowserService({
    drivers: createRuntimeBrowserDrivers(config),
    sessionExists: (sessionId) => registry.get(sessionId) !== undefined,
    storageFile: join(dataDir, 'browser', 'sessions.json'),
  });
  const browserMaintenance = new RuntimeBrowserMaintenanceService({
    browser,
  });
  const peerRegistry = new RuntimePeerRegistry({
    stalePeerTtlMs: peerConfig.stalePeerTtlMs,
  });
  const peerCapabilities = new PeerCapabilitySnapshotService({
    config,
    peerConfig,
    startup,
    registry,
    pool,
  });
  const peerTrust = new PeerTrustService({
    config: peerConfig,
    localPeerId: peerCapabilities.getLocalPeerId(),
  });
  const peerDiscovery = new PeerDiscoveryController({
    config: peerConfig,
    registry: peerRegistry,
    capabilitySnapshot: peerCapabilities,
    trust: peerTrust,
  });
  const peerRouting = new PeerRoutingService({
    config: peerConfig,
    registry: peerRegistry,
    trust: peerTrust,
    localPeerId: peerCapabilities.getLocalPeerId(),
  });
  const peerExecutionClient = new PeerExecutionClient({
    config: peerConfig,
    localPeerId: peerCapabilities.getLocalPeerId(),
  });
  const peerExecutionAdmission = new PeerExecutionAdmissionService({
    config: peerConfig,
  });
  const peerExecutionReplay = new PeerExecutionReplayService({
    config: peerConfig,
  });
  const context: AppContext = {
    config,
    startup,
    registry,
    pool,
    apiBackend,
    agentBackend,
    runtime,
    cursorNative,
    gooseNative,
    kiroNative,
    kiloNative,
    auggieSessions,
    opencodeNative,
    wslDiscoveryStatus,
    providerModelCatalog,
    compatibility,
    wakeup,
    browser,
    browserMaintenance,
    peerRegistry,
    peerDiscovery,
    peerCapabilities,
    peerTrust,
    peerRouting,
    peerExecutionClient,
    peerExecutionAdmission,
    peerExecutionReplay,
    resolveCursorNative,
    resolveGooseNative,
    resolveKiroNative,
    resolveKiloNative,
    resolveAuggieSessions,
    resolveOpencodeNative,
  };
  context.peerExecutionService = new PeerExecutionService({
    config,
    registry,
    runtime,
    localPeerId: peerCapabilities.getLocalPeerId(),
  });
  const worktreeMaintenance = new RuntimeWorktreeMaintenanceService({
    sessionBaseDir: config.sessionBaseDir,
    registry,
    runtime,
    cleanupExpiredRetainedSession: async (sessionId) => {
      const session = registry.get(sessionId);
      if (!session) {
        return { status: 'deleted' as const };
      }
      const result = await executeRetainedWorktreeCleanup(context, session, {
        worktreeCleanupPolicy: 'discard',
        rehydratePersistedState: false,
      });
      if (result.settledDelete?.status === 'deleted') {
        return { status: 'deleted' as const };
      }
      return { status: result.cleanup.status === 'completed' ? 'completed' as const : 'retained' as const };
    },
  });
  context.worktreeMaintenance = worktreeMaintenance;
  context.metering = new RuntimeMeteringService(config.metering);
  context.quotaRefresh = new QuotaRefreshService({
    collect: async (target, signal) => {
      if (target.backend !== 'cli') return { status: 'unsupported' };
      if (target.provider === 'codex') return readCodexQuota(resolveProviderInstance(config, 'codex', target.instance).commandConfig, signal);
      if (target.provider === 'copilot') return readCopilotQuota(resolveProviderInstance(config, 'copilot', target.instance).commandConfig, signal);
      if (target.provider === 'claude') return readClaudeQuota(resolveProviderInstance(config, 'claude', target.instance).commandConfig, signal);
      if (target.provider === 'antigravity') return readAntigravityQuota(resolveProviderInstance(config, 'antigravity', target.instance).commandConfig, signal);
      return { status: 'unsupported' };
    },
    observe: (observation) => context.metering!.observeQuota(observation),
  });

  let activeDiscovery: ReturnType<typeof createDiscoveryController> | null = null;
  let changedTargets = new Set<string>();
  const sessionTargetKey = (session: ReturnType<SessionRegistry['list']>[number]): string =>
    providerSelectionKey({ provider: session.providerName, backend: session.providerBackend || 'cli',
      instance: session.providerInstanceId || getProviderDefaultInstanceId(config, session.providerName as ProviderName) });

  function reconcileServices<T>(
    provider: ProviderName, services: Map<string, T>,
    create: (instance: ReturnType<typeof listProviderInstances>[number]) => T,
    close?: (service: T) => void,
  ): void {
    const instances = listProviderInstances(config, provider);
    for (const [id, service] of services) {
      if (!instances.some((instance) => instance.id === id)
        || changedTargets.has(providerSelectionKey({ provider, backend: 'cli', instance: id }))) {
        close?.(service);
        services.delete(id);
      }
    }
    for (const instance of instances) {
      if (!services.has(instance.id)) services.set(instance.id, create(instance));
    }
  }

  function activateSelection(): void {
    activeDiscovery?.stop();
    compatibility.invalidate();
    providerModelCatalog.invalidate();
    context.quotaRefresh?.invalidate();
    invalidateProviderAvailabilityDiagnosticsCache(context);
    for (const session of registry.list()) {
      if (changedTargets.has(sessionTargetKey(session))) runtime.kill(session.id);
    }
    for (const request of wakeup.list({ status: 'scheduled' })) {
      const session = registry.get(request.target.sessionId);
      if (session && changedTargets.has(sessionTargetKey(session))) wakeup.cancel(request.id);
    }
    reconcileServices('auggie', auggieSessionsByInstance, (instance) => createAuggieSessionService(config, instance.id));
    reconcileServices('cursor', cursorNativeByInstance, (instance) => new CursorNativeSessionService({
      command: instance.commandConfig.path, chatsDir: instance.cursorChatsDir || config.cursorChatsDir,
      runtime: createRuntimeAdapter(instance.commandConfig.runtime),
    }));
    reconcileServices('kiro', kiroNativeByInstance, (instance) => new KiroNativeSessionService({
      command: instance.commandConfig.path, dbPath: instance.kiroDbPath || config.kiroDbPath,
      runtime: createRuntimeAdapter(instance.commandConfig.runtime),
    }));
    reconcileServices('goose', gooseNativeByInstance, (instance) => new GooseNativeSessionService({
      command: instance.commandConfig.path,
    }));
    reconcileServices('kilo', kiloNativeByInstance, (instance) => new KiloNativeSessionService({
      command: instance.commandConfig.path, commandConfig: instance.commandConfig,
      hostname: instance.kiloServerHost || config.kiloServerHost,
      port: instance.kiloServerPort || config.kiloServerPort,
      startupTimeoutMs: instance.kiloServerStartupTimeoutMs || config.kiloServerStartupTimeoutMs,
    }), (service) => { void service.close().catch(() => undefined); });
    reconcileServices('opencode', opencodeNativeByInstance, (instance) => new OpencodeNativeSessionService({
      command: instance.commandConfig.path, commandConfig: instance.commandConfig,
      hostname: instance.opencodeServerHost || config.opencodeServerHost,
      port: instance.opencodeServerPort || config.opencodeServerPort,
      startupTimeoutMs: instance.opencodeServerStartupTimeoutMs || config.opencodeServerStartupTimeoutMs,
    }), (service) => { void service.close().catch(() => undefined); });
    startup.bootstrapRequired = false;
    activeDiscovery = createDiscoveryController(context, options);
    activeDiscovery.start();
    peerDiscovery.start();
    wakeup.start();
    browserMaintenance.start();
    worktreeMaintenance.start();
    primeProviderAvailabilityDiagnosticsCache(context);
  }

  // Bootstrap service is always created so setup routes can function.
  const paths = getRuntimeResolvedPaths(config);
  const configPathForBootstrap = config.configPath;
  context.bootstrapService = new BootstrapService({
    dataDir: paths.dataDir,
    configPath: configPathForBootstrap,
    config,
    compatibility,
    probeNonCliTarget: (target, probeOptions) => probeSetupNonCliTarget(target, {
      ...probeOptions, env: getRuntimeConfigEnv(config), agentBackend: context.agentBackend,
      fetch: options.apiBackend?.fetch,
    }),
    beforeActivate: (_candidate: RuntimeConfig, changed: SelectedProviderTarget[]) => {
      const keys = new Set(changed.map(providerSelectionKey));
      for (const session of registry.list()) {
        if (keys.has(sessionTargetKey(session)) && (runtime.get(session.id)?.busy
          || session.status === 'initializing' || session.status === 'busy')) {
          throw new ProviderSelectionError('Finish or stop the running session before changing its provider', 409);
        }
      }
      changedTargets = keys;
    },
    activated: activateSelection,
    activationRequired: () => startup.bootstrapRequired,
  });
  const selectionState = context.bootstrapService.getSelection().state;
  if (selectionState === 'missing' || selectionState === 'invalid') startup.bootstrapRequired = true;

  const app = createRuntimeApp(context);
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  activeDiscovery = startup.bootstrapRequired
    ? null
    : createDiscoveryController(context, options);
  let startPromise: Promise<{ host: string; port: number }> | null = null;
  let closePromise: Promise<void> | null = null;

  return {
    server,
    app,
    context,
    async start() {
      if (startPromise) {
        return startPromise;
      }
      if (closePromise) {
        await closePromise;
        throw new Error('cats-runtime is already closing or closed');
      }

      startPromise = (async () => {
        startupTrace?.trace('server.start.begin', {
          bootstrapRequired: startup.bootstrapRequired,
          host: config.host,
          port: config.port,
        });
        try {
          if (startup.phase !== 'starting') {
            throw new Error('cats-runtime closed during startup');
          }

          if (!server.listening) {
            startupTrace?.trace('server.listen.begin', {
              host: config.host,
              port: config.port,
            });
            await listenServer(server, config.host, config.port);
            startupTrace?.trace('server.listen.ready', {
              host: config.host,
              port: config.port,
            });
          }

          if (!startup.bootstrapRequired) {
            peerDiscovery.start();
            wakeup.start();
            browserMaintenance.start();
            worktreeMaintenance.start();
            startupTrace?.trace('server.runtime_services.started');
            // Publish service readiness before scheduling selected-provider I/O.
            setImmediate(() => {
              if (startup.phase !== 'ready' || startup.bootstrapRequired) return;
              activeDiscovery?.start();
              startupTrace?.trace('server.provider_diagnostics_prime.begin');
              primeProviderAvailabilityDiagnosticsCache(context);
              startupTrace?.trace('server.provider_diagnostics_prime.scheduled');
            });
          }

          if (startup.phase !== 'starting') {
            throw new Error('cats-runtime closed during startup');
          }

          const address = server.address();
          if (!address || typeof address === 'string') {
            const fallback = { host: config.host || '0.0.0.0', port: config.port };
            markRuntimeReady(startup, {
              ...fallback,
              healthUrl: `http://${fallback.host}:${fallback.port}/health`,
            });
            startupTrace?.trace('server.mark_ready', {
              host: fallback.host,
              port: fallback.port,
              fallbackAddress: true,
            });
            peerDiscovery.refreshSelf();
            return fallback;
          }

          markRuntimeReady(startup, {
            host: address.address,
            port: address.port,
            healthUrl: `http://${address.address}:${address.port}/health`,
          });
          startupTrace?.trace('server.mark_ready', {
            host: address.address,
            port: address.port,
            fallbackAddress: false,
          });
          peerDiscovery.refreshSelf();

          return { host: address.address, port: address.port };
        } catch (error) {
          startupTrace?.trace('server.start.error', {
            message: error instanceof Error ? error.message : String(error),
          });
          worktreeMaintenance.close();
          browserMaintenance.close();
          wakeup.close();
          peerDiscovery.stop();
          if (activeDiscovery) {
            activeDiscovery.stop();
          }
          throw error;
        }
      })();

      return startPromise;
    },
    async close() {
      if (closePromise) {
        return closePromise;
      }

      closePromise = (async () => {
        markRuntimeStopping(startup, startup.shutdownReason);
        await context.quotaRefresh?.close();
        const pendingStart = startPromise;
        if (pendingStart) {
          await pendingStart.catch(() => undefined);
        }
        worktreeMaintenance.close();
        browserMaintenance.close();
        wakeup.close();
        peerDiscovery.stop();
        if (activeDiscovery) {
          activeDiscovery.stop();
        }
        agentBackend.killAll();
        apiBackend.killAll();
        pool.killAll();
        registry.flush();
        for (const service of new Set(kiloNativeByInstance.values())) {
          await service.close();
        }
        for (const service of new Set(opencodeNativeByInstance.values())) {
          await service.close();
        }

        if (!server.listening) {
          markRuntimeStopped(startup, startup.shutdownReason);
          return;
        }

        if (typeof server.closeIdleConnections === 'function') {
          server.closeIdleConnections();
        }
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }

        server.close();
        await once(server, 'close');
        markRuntimeStopped(startup, startup.shutdownReason);
      })();

      return closePromise;
    },
  };
}
