import { once } from 'node:events';
import type { Server } from 'node:http';
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
import { syncNativeSessions } from './backends/cli/discovery/nativeDiscovery.js';
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
import { WorkerPool } from './backends/cli/pool/WorkerPool.js';
import { RuntimeSessionManager } from './core/runtime/RuntimeSessionManager.js';
import { createRuntimeApp, type AppContext } from './http/app.js';
import type { ProviderName } from './backends/cli/providers/types.js';
import type { ApiBackendOptions } from './backends/api/types.js';
import {
  normalizeFileBackedProviderPath,
  resolveFileBackedProviderPath,
} from './backends/cli/providerPaths.js';

interface DiscoveryController {
  start(): void;
  stop(): void;
}

interface RuntimeServerOptions {
  wslDistroInspector?: WslDistroInspector;
  apiBackend?: ApiBackendOptions;
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
    ...listProviderInstances(ctx.config, 'auggie').map((instance) => ({
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
    ...listProviderInstances(ctx.config, 'claude').map((instance) => ({
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
    ...listProviderInstances(ctx.config, 'codex').map((instance) => ({
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
    ...listProviderInstances(ctx.config, 'copilot').map((instance) => ({
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
    ...listProviderInstances(ctx.config, 'gemini').map((instance) => ({
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
  ]);

  const timers: Array<ReturnType<typeof setInterval>> = [];
  let started = false;
  const wslDistroInspector = options.wslDistroInspector || isWslDistroRunning;
  const wslDiscoveryPolicy = ctx.config.wslDiscoveryPolicy ?? 'always';

  const shouldSkipBackgroundWslDiscovery = (
    provider: 'cursor' | 'kiro' | 'opencode',
    instanceId: string,
  ): boolean => {
    if (provider === 'opencode' || wslDiscoveryPolicy !== 'manual_only') {
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
    name: 'cursor' | 'kiro' | 'opencode',
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
  const dataDir = config.dataDir || join(config.sessionBaseDir, '..', 'data');
  const registry = new SessionRegistry(
    dataDir,
    config.sessionBaseDir,
    config.providerDefaultInstances,
    config.providerDefaultTargets,
  );
  const apiBackend = new ApiBackendManager(config, registry, options.apiBackend);
  const wslDiscoveryStatus = new WslDiscoveryStatusStore(config);
  const auggieSessionsByInstance = new Map(
    listProviderInstances(config, 'auggie').map((instance) => [
      instance.id,
      new AuggieSessionService(resolveFileBackedProviderPath(config, 'auggie', instance.id)),
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
    kiroNative,
    auggieSessions,
    opencodeNative,
    {
      getAuggieSessions: resolveAuggieSessions,
      getKiroNative: resolveKiroNative,
      getOpencodeNative: resolveOpencodeNative,
    },
  );
  const runtime = new RuntimeSessionManager(config, pool, apiBackend);
  const context: AppContext = {
    config,
    registry,
    pool,
    apiBackend,
    runtime,
    cursorNative,
    kiroNative,
    auggieSessions,
    opencodeNative,
    wslDiscoveryStatus,
    resolveCursorNative,
    resolveKiroNative,
    resolveAuggieSessions,
    resolveOpencodeNative,
  };
  const app = createRuntimeApp(context);
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  const discovery = createDiscoveryController(context, options);

  return {
    server,
    app,
    context,
    async start() {
      discovery.start();

      if (!server.listening) {
        if (config.host) {
          server.listen(config.port, config.host);
        } else {
          server.listen(config.port);
        }
        await once(server, 'listening');
      }

      const address = server.address();
      if (!address || typeof address === 'string') {
        return { host: config.host || '0.0.0.0', port: config.port };
      }

      return { host: address.address, port: address.port };
    },
    async close() {
      discovery.stop();
      apiBackend.killAll();
      pool.killAll();
      registry.flush();
      for (const service of new Set(opencodeNativeByInstance.values())) {
        await service.close();
      }

      if (!server.listening) {
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
    },
  };
}
