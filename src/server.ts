import { once } from 'node:events';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { createAdaptorServer } from '@hono/node-server';
import { AuggieSessionService } from './backends/cli/auggie/AuggieSessionService.js';
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

function createDiscoveryController(
  ctx: AppContext,
  options: RuntimeServerOptions = {},
): DiscoveryController {
  const auggieWatcher = new FileWatcher(
    ctx.config.auggieSessionsDir,
    new AuggieSessionScanner(ctx.auggieSessions),
    'auggie',
    ctx.registry,
  );
  const claudeWatcher = new FileWatcher(
    ctx.config.claudeProjectsDir,
    new SessionScanner(ctx.config.claudeProjectsDir),
    'claude',
    ctx.registry,
  );
  const codexWatcher = new FileWatcher(
    ctx.config.codexSessionsDir,
    new CodexSessionScanner(ctx.config.codexSessionsDir),
    'codex',
    ctx.registry,
  );
  const copilotWatcher = new FileWatcher(
    ctx.config.copilotSessionsDir,
    new CopilotSessionScanner(ctx.config.copilotSessionsDir),
    'copilot',
    ctx.registry,
  );
  const geminiWatcher = new FileWatcher(
    ctx.config.geminiSessionsDir,
    new GeminiSessionScanner(ctx.config.geminiSessionsDir),
    'gemini',
    ctx.registry,
  );

  let cursorTimer: ReturnType<typeof setInterval> | null = null;
  let kiroTimer: ReturnType<typeof setInterval> | null = null;
  let opencodeTimer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  const wslDistroInspector = options.wslDistroInspector || isWslDistroRunning;
  const wslDiscoveryPolicy = ctx.config.wslDiscoveryPolicy ?? 'always';

  const shouldSkipBackgroundWslDiscovery = (
    provider: 'cursor' | 'kiro' | 'opencode',
  ): boolean => {
    if (provider === 'opencode' || wslDiscoveryPolicy !== 'manual_only') {
      return false;
    }

    const runtime = provider === 'cursor'
      ? ctx.config.cursorRuntime
      : ctx.config.kiroRuntime;
    return runtime.mode === 'wsl';
  };

  const startNativeDiscovery = (
    name: 'cursor' | 'kiro' | 'opencode',
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

    const scan = async (): Promise<void> => {
      if (running) return;
      running = true;

      try {
        if (name === 'cursor' || name === 'kiro') {
          const runtime = name === 'cursor' ? ctx.config.cursorRuntime : ctx.config.kiroRuntime;
          if (runtime.mode === 'wsl') {
            const result = await runWslAwareNativeDiscovery({
              provider: name,
              listAllSessions,
              registry: ctx.registry,
              runtime,
              policy: wslDiscoveryPolicy,
              statusStore: ctx.wslDiscoveryStatus!,
              inspector: wslDistroInspector,
            });
            if (result.outcome === 'scanned' && result.newCount > 0) {
              console.log(`[discovery:${name}] Imported ${result.newCount} native ${label} session(s)`);
            }
            return;
          }
        }

        const sessions = await listAllSessions();
        const { newCount } = syncNativeSessions(ctx.registry, name, sessions);
        if (newCount > 0) {
          console.log(`[discovery:${name}] Imported ${newCount} native ${label} session(s)`);
        }
      } catch (error) {
        console.warn(`[discovery:${name}] Native scan failed:`, (error as Error).message);
      } finally {
        running = false;
      }
    };

    if (ctx.config.nativeDiscoveryIntervalMs <= 0) {
      return null;
    }

    if (shouldSkipBackgroundWslDiscovery(name)) {
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

      startWatcher('auggie', auggieWatcher);
      startWatcher('claude', claudeWatcher);
      startWatcher('codex', codexWatcher);
      startWatcher('copilot', copilotWatcher);
      startWatcher('gemini', geminiWatcher);

      cursorTimer = startNativeDiscovery('cursor', () => ctx.cursorNative.listAllSessions());
      kiroTimer = startNativeDiscovery('kiro', () => ctx.kiroNative.listAllSessions());
      opencodeTimer = startNativeDiscovery(
        'opencode',
        () => ctx.opencodeNative.listAllSessions({ startIfNeeded: false }),
      );
    },
    stop() {
      if (!started) return;
      started = false;
      auggieWatcher.stop();
      claudeWatcher.stop();
      codexWatcher.stop();
      copilotWatcher.stop();
      geminiWatcher.stop();
      if (cursorTimer) clearInterval(cursorTimer);
      if (kiroTimer) clearInterval(kiroTimer);
      if (opencodeTimer) clearInterval(opencodeTimer);
      cursorTimer = null;
      kiroTimer = null;
      opencodeTimer = null;
    },
  };
}

export function createRuntimeServer(
  config: RuntimeConfig = loadConfig(),
  options: RuntimeServerOptions = {},
): RuntimeServer {
  const dataDir = config.dataDir || join(config.sessionBaseDir, '..', 'data');
  const registry = new SessionRegistry(dataDir, config.sessionBaseDir);
  const auggieSessions = new AuggieSessionService(config.auggieSessionsDir);
  const wslDiscoveryStatus = new WslDiscoveryStatusStore(config);
  const cursorNative = new CursorNativeSessionService({
    command: config.cursorPath,
    chatsDir: config.cursorChatsDir,
    runtime: createRuntimeAdapter(config.cursorRuntime),
  });
  const kiroNative = new KiroNativeSessionService({
    command: config.kiroPath,
    dbPath: config.kiroDbPath,
    runtime: createRuntimeAdapter(config.kiroRuntime),
  });
  const opencodeNative = new OpencodeNativeSessionService({
    command: config.opencodePath,
    commandConfig: config.providerCommands.opencode,
    hostname: config.opencodeServerHost,
    port: config.opencodeServerPort,
    startupTimeoutMs: config.opencodeServerStartupTimeoutMs,
  });
  const pool = new WorkerPool(config, registry, kiroNative, auggieSessions, opencodeNative);
  const context: AppContext = {
    config,
    registry,
    pool,
    cursorNative,
    kiroNative,
    auggieSessions,
    opencodeNative,
    wslDiscoveryStatus,
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
      await opencodeNative.close();

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
