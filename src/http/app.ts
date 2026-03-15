import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { CliRuntimeConfig } from '../backends/cli/config.js';
import type { SessionRegistry } from '../backends/cli/pool/SessionRegistry.js';
import type { WorkerPool } from '../backends/cli/pool/WorkerPool.js';
import type { CursorNativeSessionService } from '../backends/cli/cursor/CursorNativeSessionService.js';
import type { KiroNativeSessionService } from '../backends/cli/kiro/KiroNativeSessionService.js';
import type { AuggieSessionService } from '../backends/cli/auggie/AuggieSessionService.js';
import type { OpencodeNativeSessionService } from '../backends/cli/opencode/OpencodeNativeSessionService.js';
import type { WslDiscoveryStatusStore } from '../backends/cli/discovery/wslDiscovery.js';
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

export interface AppContext {
  config: CliRuntimeConfig;
  registry: SessionRegistry;
  pool: WorkerPool;
  cursorNative: CursorNativeSessionService;
  kiroNative: KiroNativeSessionService;
  auggieSessions: AuggieSessionService;
  opencodeNative: OpencodeNativeSessionService;
  wslDiscoveryStatus?: WslDiscoveryStatusStore;
  resolveCursorNative?: (instanceId?: string) => CursorNativeSessionService;
  resolveKiroNative?: (instanceId?: string) => KiroNativeSessionService;
  resolveAuggieSessions?: (instanceId?: string) => AuggieSessionService;
  resolveOpencodeNative?: (instanceId?: string) => OpencodeNativeSessionService;
}

export function createRuntimeApp(ctx: AppContext) {
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

  return app;
}
