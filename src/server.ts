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
import { WorkerPool } from './backends/cli/pool/WorkerPool.js';
import { createRuntimeApp, type AppContext } from './http/app.js';

interface DiscoveryController {
  start(): void;
  stop(): void;
}

interface RuntimeServerOptions {
  wslDistroInspector?: WslDistroInspector;
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

function getDefaultInstanceId(
  config: RuntimeConfig,
  provider: Parameters<typeof getProviderDefaultInstanceId>[1],
): string {
  return getProviderDefaultInstanceId(config, provider);
}

function createDiscoveryController(
  ctx: AppContext,
  options: RuntimeServerOptions = {},
): DiscoveryController {
  const watcherEntries = [
    ...listProviderInstances(ctx.config, 'auggie').map((instance) => ({
      name: instance.id === getDefaultInstanceId(ctx.config, 'auggie')
        ? 'auggie'
        : `auggie@${instance.id}`,
      watcher: new FileWatcher(
        instance.auggieSessionsDir || ctx.config.auggieSessionsDir,
        new AuggieSessionScanner(ctx.resolveAuggieSessions!(instance.id)),
        'auggie',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'claude').map((instance) => ({
      name: instance.id === getDefaultInstanceId(ctx.config, 'claude')
        ? 'claude'
        : `claude@${instance.id}`,
      watcher: new FileWatcher(
        instance.claudeProjectsDir || ctx.config.claudeProjectsDir,
        new SessionScanner(instance.claudeProjectsDir || ctx.config.claudeProjectsDir),
        'claude',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'codex').map((instance) => ({
      name: instance.id === getDefaultInstanceId(ctx.config, 'codex')
        ? 'codex'
        : `codex@${instance.id}`,
      watcher: new FileWatcher(
        instance.codexSessionsDir || ctx.config.codexSessionsDir,
        new CodexSessionScanner(instance.codexSessionsDir || ctx.config.codexSessionsDir),
        'codex',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'copilot').map((instance) => ({
      name: instance.id === getDefaultInstanceId(ctx.config, 'copilot')
        ? 'copilot'
        : `copilot@${instance.id}`,
      watcher: new FileWatcher(
        instance.copilotSessionsDir || ctx.config.copilotSessionsDir,
        new CopilotSessionScanner(instance.copilotSessionsDir || ctx.config.copilotSessionsDir),
        'copilot',
        ctx.registry,
        instance.id,
      ),
    })),
    ...listProviderInstances(ctx.config, 'gemini').map((instance) => ({
      name: instance.id === getDefaultInstanceId(ctx.config, 'gemini')
        ? 'gemini'
        : `gemini@${instance.id}`,
      watcher: new FileWatcher(
        instance.geminiSessionsDir || ctx.config.geminiSessionsDir,
        new GeminiSessionScanner(instance.geminiSessionsDir || ctx.config.geminiSessionsDir),
        'gemini',
        ctx.registry,
        instance.id,
      ),
    })),
  ];

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
    const discoveryLabel = instanceId === getDefaultInstanceId(ctx.config, name)
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
              statusStore: ctx.wslDiscoveryStatus!,
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
          () => ctx.resolveCursorNative!(instance.id).listAllSessions(),
        );
        if (timer) timers.push(timer);
      }

      for (const instance of listProviderInstances(ctx.config, 'kiro')) {
        const timer = startNativeDiscovery(
          'kiro',
          instance.id,
          () => ctx.resolveKiroNative!(instance.id).listAllSessions(),
        );
        if (timer) timers.push(timer);
      }

      for (const instance of listProviderInstances(ctx.config, 'opencode')) {
        const timer = startNativeDiscovery(
          'opencode',
          instance.id,
          () => ctx.resolveOpencodeNative!(instance.id).listAllSessions({ startIfNeeded: false }),
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
  const registry = new SessionRegistry(dataDir, config.sessionBaseDir);
  const wslDiscoveryStatus = new WslDiscoveryStatusStore(config);
  const auggieSessionsByInstance = new Map(
    listProviderInstances(config, 'auggie').map((instance) => [
      instance.id,
      new AuggieSessionService(instance.auggieSessionsDir || config.auggieSessionsDir),
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
    auggieSessionsByInstance.get(resolveProviderInstance(config, 'auggie', instanceId).id)
    || auggieSessionsByInstance.values().next().value
    || new AuggieSessionService(config.auggieSessionsDir);
  const resolveCursorNative = (instanceId?: string): CursorNativeSessionService =>
    cursorNativeByInstance.get(resolveProviderInstance(config, 'cursor', instanceId).id)
    || cursorNativeByInstance.values().next().value
    || new CursorNativeSessionService({
      command: config.cursorPath,
      chatsDir: config.cursorChatsDir,
      runtime: createRuntimeAdapter(config.cursorRuntime),
    });
  const resolveKiroNative = (instanceId?: string): KiroNativeSessionService =>
    kiroNativeByInstance.get(resolveProviderInstance(config, 'kiro', instanceId).id)
    || kiroNativeByInstance.values().next().value
    || new KiroNativeSessionService({
      command: config.kiroPath,
      dbPath: config.kiroDbPath,
      runtime: createRuntimeAdapter(config.kiroRuntime),
    });
  const resolveOpencodeNative = (instanceId?: string): OpencodeNativeSessionService =>
    opencodeNativeByInstance.get(resolveProviderInstance(config, 'opencode', instanceId).id)
    || opencodeNativeByInstance.values().next().value
    || new OpencodeNativeSessionService({
      command: config.opencodePath,
      commandConfig: config.providerCommands.opencode,
      hostname: config.opencodeServerHost,
      port: config.opencodeServerPort,
      startupTimeoutMs: config.opencodeServerStartupTimeoutMs,
    });

  const auggieSessions = resolveAuggieSessions(getDefaultInstanceId(config, 'auggie'));
  const cursorNative = resolveCursorNative(getDefaultInstanceId(config, 'cursor'));
  const kiroNative = resolveKiroNative(getDefaultInstanceId(config, 'kiro'));
  const opencodeNative = resolveOpencodeNative(getDefaultInstanceId(config, 'opencode'));
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
  const context: AppContext = {
    config,
    registry,
    pool,
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
