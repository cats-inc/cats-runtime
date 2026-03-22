import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { RuntimeConfig } from '../core/config.js';
import { RuntimeSessionManager } from '../core/runtime/RuntimeSessionManager.js';
import type { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { ApiBackendManager } from '../backends/api/runtime/ApiBackendManager.js';
import type { AgentBackendManager } from '../backends/agent/runtime/AgentBackendManager.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { GooseNativeSessionService } from '../backends/cli/goose/GooseNativeSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import type { WslDiscoveryStatusStore } from '../backends/cli/discovery/wslDiscovery.js';
import type { ProviderModelCatalogService } from '../core/models/providerModelCatalog.js';
import { ProviderCompatibilityService } from '../core/compatibility/ProviderCompatibilityService.js';
import { RuntimeDeliveryService } from '../core/runtime/RuntimeDeliveryService.js';
import { RuntimeMeteringService } from '../core/usage/RuntimeMeteringService.js';
import type { RuntimeWakeupService } from '../core/wakeup/RuntimeWakeupService.js';
import { bearerAuth } from './auth.js';
import { injectRuntimeDashboardHealthOverlay } from './dashboardHealthOverlay.js';
import { discoveryRoutes } from './routes/discovery.js';
import { deliveryRoutes } from './routes/delivery.js';
import { diagnosticsRoutes } from './routes/diagnostics.js';
import { healthRoutes } from './routes/health.js';
import { sessionRoutes } from './routes/sessions.js';
import { messageRoutes } from './routes/messages.js';
import { poolRoutes } from './routes/pool.js';
import { historyRoutes } from './routes/history.js';
import { browseRoutes } from './routes/browse.js';
import { observeRoutes } from './routes/observe.js';
import { codexRoutes } from './routes/codex.js';
import { cursorRoutes } from './routes/cursor.js';
import { kiroRoutes } from './routes/kiro.js';
import { auggieRoutes } from './routes/auggie.js';
import { opencodeRoutes } from './routes/opencode.js';
import { providerRoutes } from './routes/providers.js';
import { wakeupRoutes } from './routes/wakeup.js';
import type { RuntimeStartupState } from '../startup.js';

export interface AppContext {
  config: RuntimeConfig;
  startup: RuntimeStartupState;
  registry: SessionRegistry;
  pool: WorkerPool;
  apiBackend?: ApiBackendManager;
  agentBackend?: AgentBackendManager;
  runtime?: RuntimeSessionManager;
  cursorNative: CursorNativeSessionService;
  gooseNative: GooseNativeSessionService;
  kiroNative: KiroNativeSessionService;
  auggieSessions: AuggieSessionService;
  opencodeNative: OpencodeNativeSessionService;
  wslDiscoveryStatus?: WslDiscoveryStatusStore;
  providerModelCatalog: ProviderModelCatalogService;
  compatibility?: ProviderCompatibilityService;
  delivery?: RuntimeDeliveryService;
  metering?: RuntimeMeteringService;
  wakeup?: RuntimeWakeupService;
  resolveCursorNative?: (instanceId?: string) => CursorNativeSessionService;
  resolveGooseNative?: (instanceId?: string) => GooseNativeSessionService;
  resolveKiroNative?: (instanceId?: string) => KiroNativeSessionService;
  resolveAuggieSessions?: (instanceId?: string) => AuggieSessionService;
  resolveOpencodeNative?: (instanceId?: string) => OpencodeNativeSessionService;
}

export function getRuntimeSessionManager(ctx: AppContext): RuntimeSessionManager {
  if (!ctx.runtime) {
    ctx.runtime = new RuntimeSessionManager(ctx.config, ctx.pool, ctx.apiBackend, ctx.agentBackend);
  }
  return ctx.runtime;
}

export function getRuntimeMeteringService(ctx: AppContext): RuntimeMeteringService {
  if (!ctx.metering) {
    throw new Error('RuntimeMeteringService is not initialized');
  }
  return ctx.metering;
}

export function getProviderCompatibilityService(ctx: AppContext): ProviderCompatibilityService {
  if (!ctx.compatibility) {
    ctx.compatibility = new ProviderCompatibilityService(
      ctx.config,
      process.env.VITEST
        ? {
            runner: {
              run: async () => ({
                exitCode: null,
                stdout: '',
                stderr: '',
                timedOut: false,
                durationMs: 0,
                error: 'Compatibility probing disabled for auto-initialized test app context.',
              }),
            },
          }
        : undefined,
    );
  }
  return ctx.compatibility;
}

export function getRuntimeDeliveryService(ctx: AppContext): RuntimeDeliveryService {
  if (!ctx.delivery) {
    ctx.delivery = new RuntimeDeliveryService({
      registry: ctx.registry,
    });
  }
  return ctx.delivery;
}

export function createRuntimeApp(ctx: AppContext) {
  ctx.runtime = getRuntimeSessionManager(ctx);
  ctx.metering ??= new RuntimeMeteringService(ctx.config.metering);
  ctx.compatibility = getProviderCompatibilityService(ctx);
  const app = new Hono<{ Variables: { ctx: AppContext } }>();
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Serve the embedded dashboard UI without auth.
  app.get('/', (c) => {
    const htmlPath = resolve(__dirname, '../../public/index.html');
    const html = injectRuntimeDashboardHealthOverlay(readFileSync(htmlPath, 'utf-8'));
    return c.html(html);
  });

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/'
      || path === '/sessions'
      || path === '/health'
      || path === '/diagnostics/health'
      || path === '/diagnostics/runtime'
      || path === '/diagnostics/providers'
      || path === '/pool/status'
      || path === '/discovery/status'
      || path === '/providers/config'
    ) {
      return await next();
    }
    return logger()(c, next);
  });
  app.use('*', bearerAuth(ctx.config));

  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    await next();
  });

  app.route('/', healthRoutes);
  app.route('/', diagnosticsRoutes);
  app.route('/', discoveryRoutes);
  app.route('/', deliveryRoutes);
  app.route('/', sessionRoutes);
  app.route('/', messageRoutes);
  app.route('/', historyRoutes);
  app.route('/', poolRoutes);
  app.route('/', browseRoutes);
  app.route('/', observeRoutes);
  app.route('/', codexRoutes);
  app.route('/', cursorRoutes);
  app.route('/', kiroRoutes);
  app.route('/', auggieRoutes);
  app.route('/', opencodeRoutes);
  app.route('/', providerRoutes);
  app.route('/', wakeupRoutes);

  return app;
}
