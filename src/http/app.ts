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
import { bearerAuth } from './auth.js';
import { discoveryRoutes } from './routes/discovery.js';
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

export interface AppContext {
  config: RuntimeConfig;
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

export function createRuntimeApp(ctx: AppContext) {
  ctx.runtime = getRuntimeSessionManager(ctx);
  const app = new Hono();
  const __dirname = dirname(fileURLToPath(import.meta.url));

  // Serve the embedded dashboard UI without auth.
  app.get('/', (c) => {
    const htmlPath = resolve(__dirname, '../../public/index.html');
    const html = readFileSync(htmlPath, 'utf-8');
    return c.html(html);
  });

  app.use('*', async (c, next) => {
    const path = c.req.path;
    if (
      path === '/'
      || path === '/sessions'
      || path === '/health'
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
    c.set('ctx' as never, ctx);
    await next();
  });

  app.route('/', healthRoutes);
  app.route('/', discoveryRoutes);
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

  return app;
}
