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
import { loadConfig } from './core/config.js';
import type { RuntimeConfig } from './core/types.js';
import { AuggieSessionScanner } from './backends/cli/discovery/AuggieSessionScanner.js';
import { FileWatcher } from './backends/cli/discovery/FileWatcher.js';
import { SessionScanner } from './backends/cli/discovery/SessionScanner.js';
import { CodexSessionScanner } from './backends/cli/discovery/CodexSessionScanner.js';
import { CopilotSessionScanner } from './backends/cli/discovery/CopilotSessionScanner.js';
import { GeminiSessionScanner } from './backends/cli/discovery/GeminiSessionScanner.js';
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
import { OpencodeNativeSessionService } from './backends/cli/opencode/OpencodeNativeSessionService.js';
import { createRuntimeAdapter } from './backends/cli/runtime/runtime.js';
import { SessionRegistry } from './backends/cli/pool/SessionRegistry.js';
import { ApiBackendManager } from './backends/api/runtime/ApiBackendManager.js';
import { AgentBackendManager } from './backends/agent/runtime/AgentBackendManager.js';
import { WorkerPool } from './backends/cli/pool/WorkerPool.js';
import { RuntimeSessionManager } from './core/runtime/RuntimeSessionManager.js';
import { ProviderModelCatalogService } from './core/models/providerModelCatalog.js';
import { createRuntimeApp, type AppContext } from './http/app.js';
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

interface DiscoveryController {
  start(): void;
  stop(): void;
}

interface RuntimeServerOptions {
  wslDistroInspector?: WslDistroInspector;
  apiBackend?: ApiBackendOptions;
  agentBackend?: AgentBackendOptions;
  startup?: RuntimeStartupState;
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
  if (!instanceId || instanceId === 'default' || instanceId === defaultInstanceId) {
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
  const resolveGooseNative = (instanceId?: string): GooseNativeSessionService =>
    resolveContextService(
      ctx.config,
      'goose',
      instanceId,
      ctx.resolveGooseNative,
      ctx.gooseNative,
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
    ...listProviderInstances(ctx.config, 'gemini')
      .filter((instance) => supportsHostFileBackedProviderDiscovery(ctx.config, 'gemini', instance.id))
      .map((instance) => ({
      provider: 'gemini' as const,
      instanceId: instance.id,
      name: instance.id === getProviderDefaultInstanceId(ctx.config, 'gemini')
        ? 'gemini'
        : `gemini@${instance.id}`,
      watchDir: resolveFileBackedProviderPath(ctx.config, 'gemini', instance.id),
      normalizedWatchDir: normalizeFileBackedProviderPath(ctx.config, 'gemini', instance.id),
      createWatcher: () => new FileWatcher(
        resolveFileBackedProviderPath(ctx.config, 'gemini', instance.id),
        new GeminiSessionScanner(
          resolveFileBackedProviderPath(ctx.config, 'gemini', instance.id),
        ),
        'gemini',
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
  const wslDistroInspector = options.wslDistroInspector || isWslDistroRunning;
  const wslDiscoveryPolicy = ctx.config.wslDiscoveryPolicy ?? 'always';
  const dockerDiscoveryPolicy = ctx.config.dockerDiscoveryPolicy ?? 'if_running';

  const shouldSkipBackgroundDockerDiscovery = (
    provider: 'cursor' | 'goose' | 'kiro' | 'opencode',
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
    provider: 'cursor' | 'goose' | 'kiro' | 'opencode',
    instanceId: string,
  ): boolean => {
    if (provider === 'goose' || provider === 'opencode' || wslDiscoveryPolicy !== 'manual_only') {
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
    name: 'cursor' | 'goose' | 'kiro' | 'opencode',
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
          : 'OpenCode';
    const discoveryLabel = instanceId === getProviderDefaultInstanceId(ctx.config, name)
      ? name
      : `${name}@${instanceId}`;

    const scan = async (): Promise<void> => {
      if (running) return;
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

      for (const entry of watcherEntries) {
        startWatcher(entry.name, entry.watcher);
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

      for (const instance of listProviderInstances(ctx.config, 'goose')) {
        const timer = startNativeDiscovery(
          'goose',
          instance.id,
          () => resolveGooseNative(instance.id).listAllSessions(),
        );
        if (timer) timers.push(timer);
      }
    },
    stop() {
      if (!started) return;
      started = false;
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
  const pool = new WorkerPool(
    config,
    registry,
    gooseNative,
    kiroNative,
    auggieSessions,
    opencodeNative,
    {
      getAuggieSessions: resolveAuggieSessions,
      getGooseNative: resolveGooseNative,
      getKiroNative: resolveKiroNative,
      getOpencodeNative: resolveOpencodeNative,
    },
  );
  const runtime = new RuntimeSessionManager(config, pool, apiBackend, agentBackend);
  const providerModelCatalog = new ProviderModelCatalogService(config, {
    agentBackend,
    fetch: options.apiBackend?.fetch,
    env: options.apiBackend?.env,
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
    auggieSessions,
    opencodeNative,
    wslDiscoveryStatus,
    providerModelCatalog,
    resolveCursorNative,
    resolveGooseNative,
    resolveKiroNative,
    resolveAuggieSessions,
    resolveOpencodeNative,
  };
  const app = createRuntimeApp(context);
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  const discovery = createDiscoveryController(context, options);
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
        discovery.start();

        try {
          if (!server.listening) {
            await listenServer(server, config.host, config.port);
          }

          const address = server.address();
          if (!address || typeof address === 'string') {
            const fallback = { host: config.host || '0.0.0.0', port: config.port };
            markRuntimeReady(startup, {
              ...fallback,
              healthUrl: `http://${fallback.host}:${fallback.port}/health`,
            });
            return fallback;
          }

          markRuntimeReady(startup, {
            host: address.address,
            port: address.port,
            healthUrl: `http://${address.address}:${address.port}/health`,
          });

          return { host: address.address, port: address.port };
        } catch (error) {
          discovery.stop();
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
        discovery.stop();
        agentBackend.killAll();
        apiBackend.killAll();
        pool.killAll();
        registry.flush();
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
